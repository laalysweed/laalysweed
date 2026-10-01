import { Deposit, DepositMethod, DepositT } from '../models/finance';
import { Account, AccountT } from '../models/account';
import { env } from '../config/env';
import { AppError, badRequest, notFound } from '../lib/errors';
import { usdToKes } from '../lib/money';
import { createLogger } from '../lib/logger';
import { emitAccounts, postEntry, withTxn } from '../services/ledger.service';
import { getBonusConfig } from '../services/settings.service';
import { grantDepositBonus, isFirstCompletedDeposit, payReferralCommission, publicBonus, rollTradersBox } from '../bonus/bonus.service';
import { toAdmins, toUser } from '../realtime/io';
import { darajaConfigured, mpesaSimulated, normalizeKePhone, stkPush, stkQuery } from './mpesa';
import { PayheroCallback, PayheroStatus, payheroConfigured, payheroStatus, payheroStkPush } from './payhero';
import { stkOutcome } from './mpesa-results';
import { User } from '../models/user';
import { Types } from 'mongoose';
import { CryptoWallet, activeWallets, addressQr, coinAmount } from '../services/crypto-wallets.service';

const log = createLogger('deposits');

export interface MethodInfo {
  id: DepositMethod;
  name: string;
  logo: string;
  minDeposit: number;
  eta: string;
  available: boolean;
  note?: string;
  popular: boolean;
}

export async function listMethods(country: string): Promise<MethodInfo[]> {
  const allowed = new Set(env.DEPOSIT_METHODS.split(',').map((s) => s.trim()).filter(Boolean));
  const { limits } = await getBonusConfig();
  const ke = country.toUpperCase() === 'KE';
  const all: MethodInfo[] = [
    { id: 'mpesa', name: 'M-Pesa', logo: 'mpesa', minDeposit: limits.minDeposit, eta: 'Instant', available: ke, popular: true, note: ke ? undefined : 'Kenya only' },
    // One "Cryptocurrency" option; the coins/wallets come from the admin panel (Crypto wallets).
    { id: 'crypto', name: 'Cryptocurrency', logo: 'crypto', minDeposit: limits.minDeposit, eta: '~10–30 min.', available: (await activeWallets()).length > 0, popular: true },
    { id: 'airtel', name: 'Airtel Money', logo: 'airtel', minDeposit: limits.minDeposit, eta: '~5 min.', available: false, popular: true },
    { id: 'bybit', name: 'ByBit Pay', logo: 'bybit', minDeposit: limits.minDeposit, eta: '~5 min.', available: false, popular: true },
    { id: 'card', name: 'Visa / Mastercard', logo: 'visa', minDeposit: limits.minDeposit, eta: '~1 min.', available: env.SANDBOX_PAYMENTS, popular: true, note: env.SANDBOX_PAYMENTS ? 'Sandbox processor (test mode)' : undefined },
  ];
  // Only methods listed in DEPOSIT_METHODS can be used; everything else is shown locked.
  return all.map((m) => ({ ...m, available: m.available && allowed.has(m.id) }));
}

export const publicDeposit = (d: DepositT, extra: Record<string, unknown> = {}) => ({
  id: String(d._id),
  method: d.method,
  amount: d.amount,
  localAmount: d.localAmount ?? null,
  localCurrency: d.localCurrency ?? null,
  phone: d.phone ?? null,
  status: d.status,
  bonusOffer: d.bonusOffer ?? null,
  tradersBox: d.tradersBox,
  receipt: d.provider?.receipt ?? null,
  txHash: d.provider?.txHash ?? null,
  failureReason: d.failureReason ?? null,
  failureCode: d.failureCode ?? null,
  createdAt: (d as unknown as { createdAt: Date }).createdAt,
  completedAt: d.completedAt ?? null,
  crypto: d.crypto?.address ? { coin: d.crypto.coin, symbol: d.crypto.symbol, network: d.crypto.network, address: d.crypto.address, coinAmount: d.crypto.coinAmount ?? null } : null,
  ...extra,
});

function emitDeposit(d: DepositT, extra: Record<string, unknown> = {}) {
  toUser(d.userId, 'deposit:update', publicDeposit(d, extra));
  // Admins get every deposit change live, with who / how much / result.
  void User.findById(d.userId, { username: 1, email: 1 })
    .lean()
    .then((u) => toAdmins('admin:deposit', publicDeposit(d, { userId: String(d.userId), username: u?.username, email: u?.email })))
    .catch(() => undefined);
}

export interface CreateDepositInput {
  method: DepositMethod;
  amount: number;
  phone?: string;
  bonusOffer?: 'first50' | 'welcome100' | null;
  bonusTermsVersion?: string;
  tradersBox?: boolean;
  coin?: string; // crypto wallet code, e.g. usdt_trc20
}

export async function createDeposit(userId: string, country: string, inp: CreateDepositInput) {
  const cfg = await getBonusConfig();
  const account = await Account.findOne({ userId, type: 'real' }).lean<AccountT>();
  if (!account) throw notFound('Real account not found');
  const method = (await listMethods(country)).find((m) => m.id === inp.method);
  if (!method?.available) throw badRequest('This payment method is not available', 'METHOD_UNAVAILABLE');
  if (inp.amount < method.minDeposit) throw badRequest(`Minimum deposit is $${method.minDeposit / 100}`, 'BELOW_MIN');
  if (inp.amount > cfg.limits.maxDeposit) throw badRequest(`Maximum single deposit is $${(cfg.limits.maxDeposit / 100).toLocaleString('en-US')}`, 'ABOVE_MAX');
  if (inp.bonusOffer && inp.bonusTermsVersion !== cfg.termsVersion)
    throw badRequest('Bonus terms have changed, please review them again', 'TERMS_OUTDATED');

  let phone: string | undefined;
  if (inp.method === 'mpesa') {
    phone = normalizeKePhone(inp.phone ?? '') ?? undefined;
    if (!phone) throw badRequest('Enter a valid Safaricom number, e.g. 0712345678', 'BAD_PHONE');
    const ready = env.MPESA_SIMULATE || (env.MPESA_PROVIDER === 'payhero' ? payheroConfigured() : darajaConfigured());
    if (!ready) throw badRequest('M-Pesa deposits are temporarily unavailable. Please try again shortly.', 'METHOD_UNAVAILABLE');
    await guardStkAbuse(userId, phone);
  }

  let wallet: CryptoWallet | undefined;
  if (inp.method === 'crypto') {
    wallet = (await activeWallets()).find((w) => w.code === inp.coin);
    if (!wallet) throw badRequest('Choose a supported cryptocurrency', 'BAD_COIN');
    // One open crypto deposit per user keeps review simple.
    await Deposit.updateMany({ userId, method: 'crypto', status: 'pending' }, { $set: { status: 'cancelled' } });
  }

  const kes = usdToKes(inp.amount, env.KES_PER_USD);
  const dep = await Deposit.create({
    ...(wallet
      ? { crypto: { coin: wallet.code, symbol: wallet.coin, network: wallet.network, address: wallet.address, coinAmount: coinAmount(wallet, inp.amount) ?? undefined } }
      : {}),
    userId,
    accountId: account._id,
    method: inp.method,
    amount: inp.amount,
    localAmount: inp.method === 'mpesa' ? kes : inp.amount / 100,
    localCurrency: inp.method === 'mpesa' ? 'KES' : 'USD',
    phone,
    bonusOffer: inp.bonusOffer ?? null,
    bonusTermsVersion: inp.bonusOffer ? inp.bonusTermsVersion : undefined,
    tradersBox: !!inp.tradersBox,
  });

  if (inp.method === 'mpesa') {
    try {
      if (!env.MPESA_SIMULATE && env.MPESA_PROVIDER === 'payhero') {
        if (!payheroConfigured()) throw new Error('M-Pesa is not configured (PAYHERO_AUTH_TOKEN / PAYHERO_CHANNEL_ID)');
        const user = await User.findById(userId, { fullName: 1 }).lean();
        const p = await payheroStkPush({ phone: phone!, amountKes: kes, externalReference: `Y2-${String(dep._id)}`, customerName: user?.fullName });
        dep.status = 'processing';
        dep.provider = { ...dep.provider, merchantRequestId: p.reference, checkoutRequestId: p.checkoutRequestId };
        await dep.save();
        const obj = dep.toObject() as DepositT;
        emitDeposit(obj);
        return publicDeposit(obj);
      }
      const r = await stkPush({ phone: phone!, amountKes: kes, reference: `Y2${String(dep._id).slice(-8)}`, description: 'Y2 deposit' });
      dep.status = 'processing';
      dep.provider = { ...dep.provider, merchantRequestId: r.merchantRequestId, checkoutRequestId: r.checkoutRequestId };
      await dep.save();
      if (r.simulated) {
        setTimeout(() => {
          void handleStkCallback({
            Body: {
              stkCallback: {
                MerchantRequestID: r.merchantRequestId,
                CheckoutRequestID: r.checkoutRequestId,
                ResultCode: 0,
                ResultDesc: 'The service request is processed successfully. (simulated)',
                CallbackMetadata: { Item: [{ Name: 'Amount', Value: kes }, { Name: 'MpesaReceiptNumber', Value: `SIM${Date.now().toString(36).toUpperCase()}` }, { Name: 'PhoneNumber', Value: Number(phone) }] },
              },
            },
          });
        }, 6000);
      }
    } catch (e) {
      dep.status = 'failed';
      dep.failureReason = (e as Error).message;
      await dep.save();
    }
  } else if (inp.method === 'card') {
    dep.status = 'processing';
    await dep.save();
    setTimeout(() => void completeDeposit(String(dep._id), { receipt: `CARD-SANDBOX-${Date.now()}` }).catch((e) => log.error('sandbox card', e)), 3000);
  }
  const obj = dep.toObject() as DepositT;
  emitDeposit(obj);
  return publicDeposit(obj, await cryptoPayTo(obj));
}

/** Everything the user needs to pay a crypto deposit: coin, network, address, QR and approximate amount. */
export async function cryptoPayTo(d: DepositT) {
  if (d.method !== 'crypto' || !d.crypto?.address) return {};
  return {
    payTo: {
      coin: d.crypto.symbol,
      network: d.crypto.network,
      address: d.crypto.address,
      coinAmount: d.crypto.coinAmount ?? null,
      qr: await addressQr(d.crypto.address),
    },
  };
}

export async function submitCryptoTx(userId: string, depositId: string, txHash: string) {
  const d = await Deposit.findOneAndUpdate(
    { _id: depositId, userId, method: { $in: ['crypto', 'usdt_trc20', 'usdt_bep20'] }, status: 'pending' },
    { $set: { status: 'awaiting_review', 'provider.txHash': txHash } },
    { new: true },
  ).lean<DepositT>();
  if (!d) throw notFound('Deposit not found or already submitted');
  emitDeposit(d);
  return publicDeposit(d);
}

export async function cancelDeposit(userId: string, depositId: string) {
  const d = await Deposit.findOneAndUpdate({ _id: depositId, userId, status: 'pending' }, { $set: { status: 'cancelled' } }, { new: true }).lean<DepositT>();
  if (!d) throw notFound('Deposit cannot be cancelled');
  emitDeposit(d);
  return publicDeposit(d);
}

/**
 * Credits a deposit exactly once (status transition is the guard), then applies opted-in bonus,
 * Trader's Box and referral commission — all in the same transaction.
 */
export async function completeDeposit(depositId: string, provider: { receipt?: string; raw?: unknown } = {}, reviewedBy?: string) {
  const out = await withTxn(async (session) => {
    const dep = await Deposit.findOneAndUpdate(
      {
        _id: depositId,
        // A deposit we closed as "expired" (no callback in time) can still complete if the gateway later confirms payment.
        $or: [{ status: { $in: ['pending', 'processing', 'awaiting_review'] } }, { status: 'failed', failureCode: 'timeout' }],
      },
      {
        $set: { status: 'completed', completedAt: new Date(), 'provider.receipt': provider.receipt, 'provider.raw': provider.raw, reviewedBy },
        $unset: { failureReason: 1, failureCode: 1 },
      },
      { new: true, session },
    ).lean<DepositT>();
    if (!dep) return null;
    await postEntry(session, { accountId: dep.accountId, type: 'deposit', bucket: 'cash', amount: dep.amount, refKind: 'deposit', refId: dep._id });
    const cfg = await getBonusConfig();
    const first = await isFirstCompletedDeposit(session, dep.userId, dep._id);
    const bonus = await grantDepositBonus(session, dep, cfg, first);
    const box = await rollTradersBox(session, dep, cfg, first);
    const referral = await payReferralCommission(session, dep, cfg);
    return { dep, bonus, box, referral };
  });
  if (!out) return null;
  emitDeposit(out.dep, { tradersBoxResult: out.box });
  if (out.bonus) toUser(out.dep.userId, 'bonus:update', publicBonus(out.bonus.toObject()));
  void emitAccounts(out.dep.userId);
  if (out.referral) {
    void emitAccounts(out.referral.referrerId);
    toUser(out.referral.referrerId, 'toast', { kind: 'success', text: `Referral commission received: $${(out.referral.amount / 100).toFixed(2)}` });
  }
  return out;
}

export async function failDeposit(depositId: string, reason: string, raw?: unknown, opts: { status?: 'failed' | 'cancelled'; code?: string } = {}) {
  const d = await Deposit.findOneAndUpdate(
    { _id: depositId, status: { $in: ['pending', 'processing', 'awaiting_review'] } },
    { $set: { status: opts.status ?? 'failed', failureReason: reason, failureCode: opts.code ?? 'error', 'provider.raw': raw } },
    { new: true },
  ).lean<DepositT>();
  if (d) emitDeposit(d);
  return d;
}

interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: { Name: string; Value?: string | number }[] };
    };
  };
}

export async function handleStkCallback(body: StkCallbackBody) {
  const cb = body.Body?.stkCallback;
  if (!cb) throw new AppError(400, 'BAD_CALLBACK', 'Missing stkCallback');
  const dep = await Deposit.findOne({ 'provider.checkoutRequestId': cb.CheckoutRequestID }).lean<DepositT>();
  if (!dep) {
    log.warn(`STK callback for unknown CheckoutRequestID ${cb.CheckoutRequestID}`);
    return;
  }
  if (Number(cb.ResultCode) !== 0) {
    const o = stkOutcome(cb.ResultCode, cb.ResultDesc);
    await failDeposit(String(dep._id), o.message, cb, { status: o.status, code: o.code });
    return;
  }
  const item = (n: string) => cb.CallbackMetadata?.Item.find((i) => i.Name === n)?.Value;
  const paidKes = Number(item('Amount') ?? 0);
  if (paidKes < (dep.localAmount ?? Infinity)) {
    await failDeposit(String(dep._id), `Amount mismatch: paid KES ${paidKes}, expected KES ${dep.localAmount}`, cb, { code: 'amount_mismatch' });
    return;
  }
  await completeDeposit(String(dep._id), { receipt: String(item('MpesaReceiptNumber') ?? ''), raw: cb });
}

/**
 * PayHero callback. Matched by CheckoutRequestID (fallback: our ExternalReference "Y2-<depositId>"),
 * the amount is re-checked, and completeDeposit() only credits a deposit once.
 */
export async function handlePayheroCallback(body: PayheroCallback) {
  const r = body.response;
  if (!r) throw new AppError(400, 'BAD_CALLBACK', 'Missing response');
  let dep = r.CheckoutRequestID ? await Deposit.findOne({ 'provider.checkoutRequestId': r.CheckoutRequestID }).lean<DepositT>() : null;
  const refId = r.ExternalReference?.startsWith('Y2-') ? r.ExternalReference.slice(3) : '';
  if (!dep && Types.ObjectId.isValid(refId)) dep = await Deposit.findById(refId).lean<DepositT>();
  if (!dep) {
    log.warn(`PayHero callback for unknown payment ${r.CheckoutRequestID ?? r.ExternalReference}`);
    return;
  }
  if (dep.method !== 'mpesa') return;
  const ok = Number(r.ResultCode) === 0 && (r.Status ?? 'Success').toLowerCase() === 'success';
  if (!ok) {
    const o = stkOutcome(r.ResultCode, r.ResultDesc);
    await failDeposit(String(dep._id), o.message, r, { status: o.status, code: o.code });
    return;
  }
  const paidKes = Number(r.Amount ?? 0);
  if (paidKes < (dep.localAmount ?? Infinity)) {
    await failDeposit(String(dep._id), `Amount mismatch: paid KES ${paidKes}, expected KES ${dep.localAmount}`, r, { code: 'amount_mismatch' });
    return;
  }
  await completeDeposit(String(dep._id), { receipt: r.MpesaReceiptNumber ?? '', raw: r });
}

/**
 * Stays well inside PayHero's STK abuse limits (10 failed prompts per phone, 50 per account in 6h):
 * one open prompt per user, max 5 failed prompts per phone and 40 per account in a sliding 6h window.
 */
async function guardStkAbuse(userId: string, phone: string) {
  const since = new Date(Date.now() - 6 * 3600_000);
  if (await Deposit.exists({ userId, method: 'mpesa', status: 'processing', createdAt: { $gt: new Date(Date.now() - 120_000) } }))
    throw badRequest('Please complete the M-Pesa prompt on your phone, or wait 2 minutes before trying again', 'STK_PENDING');
  const unsuccessful = { method: 'mpesa', status: { $in: ['failed', 'cancelled'] }, createdAt: { $gt: since } };
  if ((await Deposit.countDocuments({ ...unsuccessful, phone })) >= 5)
    throw badRequest('Too many unsuccessful M-Pesa attempts on this number. Please try again in a few hours.', 'STK_LIMIT');
  if ((await Deposit.countDocuments(unsuccessful)) >= 40)
    throw badRequest('M-Pesa deposits are busy right now. Please try again shortly or use another method.', 'STK_THROTTLED');
}

/** Resolves M-Pesa deposits whose callback never arrived (query Daraja, then time out). */
/**
 * Asks PayHero for the final state of an STK push. Returns true when the deposit was settled
 * (completed / failed / cancelled), false when PayHero still reports it as queued or unknown.
 */
export async function reconcilePayhero(d: DepositT, allowTimeout: boolean): Promise<boolean> {
  const ref = d.provider?.merchantRequestId;
  if (!ref || !payheroConfigured()) return false;
  let s: PayheroStatus;
  try {
    s = await payheroStatus(ref);
  } catch (e) {
    log.warn(`payhero status ${ref} failed: ${(e as Error).message}`);
    return false;
  }
  const status = String(s.status ?? '').toUpperCase();
  if (s.external_reference && s.external_reference !== `Y2-${d._id}`) {
    log.warn(`payhero status ${ref} belongs to ${s.external_reference}, not deposit ${d._id}`);
    return false;
  }
  if (status === 'SUCCESS') {
    const expectedKes = d.localAmount ?? 0;
    if (s.amount != null && expectedKes && Number(s.amount) < expectedKes) {
      await failDeposit(String(d._id), `Amount mismatch: paid KES ${s.amount}, expected KES ${expectedKes}. Contact support.`, s, { code: 'amount_mismatch' });
      return true;
    }
    await completeDeposit(String(d._id), { receipt: s.provider_reference ?? s.third_party_reference, raw: s });
    log.info(`deposit ${d._id} confirmed via PayHero status (${s.provider_reference})`);
    return true;
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    const o = stkOutcome(undefined, s.result_desc ?? s.description ?? (status === 'CANCELLED' ? 'cancelled' : ''));
    await failDeposit(String(d._id), o.message, s, { status: o.status, code: o.code });
    return true;
  }
  if (allowTimeout) await failDeposit(String(d._id), 'The M-Pesa prompt expired before it was completed.', s, { code: 'timeout' });
  return false;
}

const lastRecheck = new Map<string, number>();

export function startDepositReconciler() {
  setInterval(async () => {
    try {
      if (!mpesaSimulated() && env.MPESA_PROVIDER === 'payhero') {
        // Callbacks can't reach a non-public API_PUBLIC_URL (e.g. localhost), so poll PayHero directly.
        const open = await Deposit.find({ method: 'mpesa', status: 'processing', createdAt: { $lt: new Date(Date.now() - 8_000) } })
          .limit(20)
          .lean<DepositT[]>();
        for (const d of open) {
          const age = Date.now() - (d as unknown as { createdAt: Date }).createdAt.getTime();
          await reconcilePayhero(d, age > 5 * 60_000);
        }
        // Recovery: deposits we timed out in the last 24h get re-checked every few minutes in case they were paid.
        const expired = await Deposit.find({
          method: 'mpesa',
          status: 'failed',
          failureCode: 'timeout',
          'provider.merchantRequestId': { $exists: true, $ne: '' },
          createdAt: { $gt: new Date(Date.now() - 24 * 3600_000) },
        })
          .limit(20)
          .lean<DepositT[]>();
        for (const d of expired) {
          const id = String(d._id);
          if (Date.now() - (lastRecheck.get(id) ?? 0) < 5 * 60_000) continue;
          lastRecheck.set(id, Date.now());
          await reconcilePayhero(d, false);
        }
        return;
      }
      const stale = await Deposit.find({ method: 'mpesa', status: 'processing', createdAt: { $lt: new Date(Date.now() - 90_000) } }).limit(20).lean<DepositT[]>();
      for (const d of stale) {
        const age = Date.now() - (d as unknown as { createdAt: Date }).createdAt.getTime();
        if (!mpesaSimulated() && env.MPESA_PROVIDER === 'daraja' && d.provider?.checkoutRequestId) {
          try {
            const q = await stkQuery(d.provider.checkoutRequestId);
            if (q.ResultCode === '0') {
              await completeDeposit(String(d._id), { receipt: 'STK-QUERY', raw: q });
              continue;
            }
            if (q.ResultCode && q.ResultCode !== '0') {
              const o = stkOutcome(q.ResultCode, q.ResultDesc);
              await failDeposit(String(d._id), o.message, q, { status: o.status, code: o.code });
              continue;
            }
          } catch (e) {
            log.warn(`stk query failed: ${(e as Error).message}`);
          }
        }
        // Safaricom prompts expire after about a minute; if no callback came, close it out.
        if (age > 3 * 60_000) await failDeposit(String(d._id), 'The M-Pesa prompt expired before it was completed.', undefined, { code: 'timeout' });
      }
    } catch (e) {
      log.error('reconciler error', e);
    }
  }, 15_000);
}
