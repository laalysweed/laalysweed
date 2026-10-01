import { Withdrawal, WithdrawalT } from '../models/finance';
import { Account, AccountT } from '../models/account';
import { User } from '../models/user';
import { env } from '../config/env';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { usdToKes } from '../lib/money';
import { randomToken } from '../lib/crypto';
import { createLogger } from '../lib/logger';
import { emitAccounts, postEntry, withTxn } from '../services/ledger.service';
import { getBonusConfig } from '../services/settings.service';
import { getEffectiveWithdrawalPopup } from '../services/withdrawal-popup.service';
import { toAdmins, toUser } from '../realtime/io';
import { b2cPayout, normalizeKePhone } from './mpesa';

const log = createLogger('withdrawals');

export const publicWithdrawal = (w: WithdrawalT) => ({
  id: String(w._id),
  method: w.method,
  amount: w.amount,
  localAmount: w.localAmount ?? null,
  localCurrency: w.localCurrency ?? null,
  phone: w.phone ?? null,
  address: w.address ?? null,
  status: w.status,
  reviewNote: w.reviewNote ?? null,
  txRef: w.provider?.transactionId ?? w.provider?.txRef ?? null,
  createdAt: (w as unknown as { createdAt: Date }).createdAt,
  paidAt: w.paidAt ?? null,
});

function emitW(w: WithdrawalT) {
  toUser(w.userId, 'withdrawal:update', publicWithdrawal(w));
  toAdmins('admin:withdrawal', { id: String(w._id), status: w.status });
}

export async function requestWithdrawal(userId: string, inp: { method: 'mpesa' | 'usdt_trc20' | 'usdt_bep20'; amount: number; phone?: string; address?: string }) {
  const user = await User.findById(userId).lean();
  if (!user) throw notFound('User not found');
  if (!user.emailVerified) throw forbidden('Please verify your e-mail address before withdrawing', 'EMAIL_UNVERIFIED');
  if (env.REQUIRE_KYC_FOR_WITHDRAWAL && user.kycStatus !== 'approved') throw forbidden('Identity verification is required before withdrawing', 'KYC_REQUIRED');

  const popup = await getEffectiveWithdrawalPopup(userId);
  if (popup?.enabled && popup?.blocking) {
    throw forbidden(popup.message || 'Withdrawals are currently restricted for your account', 'WITHDRAWAL_BLOCKED');
  }

  const { limits } = await getBonusConfig();
  if (!Number.isSafeInteger(inp.amount) || inp.amount < limits.minWithdrawal) throw badRequest(`Minimum withdrawal is $${limits.minWithdrawal / 100}`, 'BELOW_MIN');

  let phone: string | undefined;
  let address: string | undefined;
  if (inp.method === 'mpesa') {
    phone = normalizeKePhone(inp.phone ?? '') ?? undefined;
    if (!phone) throw badRequest('Enter a valid Safaricom number', 'BAD_PHONE');
  } else {
    address = inp.address?.trim();
    const ok = inp.method === 'usdt_trc20' ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address ?? '') : /^0x[a-fA-F0-9]{40}$/.test(address ?? '');
    if (!ok) throw badRequest('Enter a valid wallet address for the selected network', 'BAD_ADDRESS');
  }

  const acc = await Account.findOne({ userId, type: 'real' }).lean<AccountT>();
  if (!acc) throw notFound('Real account not found');

  const w = await withTxn(async (session) => {
    const [doc] = await Withdrawal.create(
      [
        {
          userId,
          accountId: acc._id,
          method: inp.method,
          amount: inp.amount,
          localAmount: inp.method === 'mpesa' ? Math.floor((inp.amount / 100) * env.KES_PER_USD) : inp.amount / 100,
          localCurrency: inp.method === 'mpesa' ? 'KES' : 'USDT',
          phone,
          address,
        },
      ],
      { session },
    );
    // Hold the funds immediately (only withdrawable cash, never bonus funds).
    await postEntry(session, { accountId: acc._id, type: 'withdrawal_hold', bucket: 'cash', amount: -inp.amount, refKind: 'withdrawal', refId: doc!._id });
    return doc!.toObject() as WithdrawalT;
  });
  emitW(w);
  void emitAccounts(userId);
  return publicWithdrawal(w);
}

async function refund(w: WithdrawalT, status: 'cancelled' | 'rejected' | 'failed', note?: string, actorId?: string) {
  const out = await withTxn(async (session) => {
    const from = status === 'failed' ? ['processing'] : ['pending_review'];
    const upd = await Withdrawal.findOneAndUpdate(
      { _id: w._id, status: { $in: from } },
      { $set: { status, reviewNote: note, ...(actorId ? { reviewedBy: actorId } : {}) } },
      { new: true, session },
    ).lean<WithdrawalT>();
    if (!upd) return null;
    await postEntry(session, { accountId: w.accountId, type: 'withdrawal_reversal', bucket: 'cash', amount: w.amount, refKind: 'withdrawal', refId: w._id, actorId, note });
    return upd;
  });
  if (out) {
    emitW(out);
    void emitAccounts(w.userId);
  }
  return out;
}

export async function cancelWithdrawal(userId: string, id: string) {
  const w = await Withdrawal.findOne({ _id: id, userId, status: 'pending_review' }).lean<WithdrawalT>();
  if (!w) throw notFound('Withdrawal cannot be cancelled');
  return refund(w, 'cancelled', 'Cancelled by user');
}

export async function rejectWithdrawal(adminId: string, id: string, note: string) {
  const w = await Withdrawal.findOne({ _id: id, status: 'pending_review' }).lean<WithdrawalT>();
  if (!w) throw notFound('Withdrawal not pending');
  return refund(w, 'rejected', note, adminId);
}

export async function approveWithdrawal(adminId: string, id: string) {
  const w = await Withdrawal.findOneAndUpdate(
    { _id: id, status: 'pending_review' },
    { $set: { status: 'processing', reviewedBy: adminId, 'provider.originatorConversationId': `Y2-${randomToken(9)}` } },
    { new: true },
  ).lean<WithdrawalT>();
  if (!w) throw notFound('Withdrawal not pending');
  emitW(w);
  if (w.method === 'mpesa') {
    try {
      const r = await b2cPayout({
        phone: w.phone!,
        amountKes: w.localAmount ?? usdToKes(w.amount, env.KES_PER_USD),
        originatorConversationId: w.provider!.originatorConversationId!,
        remarks: `Y2 Markets withdrawal ${String(w._id).slice(-6)}`,
      });
      if (r.manual) {
        await Withdrawal.updateOne({ _id: w._id }, { $set: { reviewNote: 'Approved: pay manually via M-Pesa, then mark as paid' } });
        return w;
      }
      await Withdrawal.updateOne({ _id: w._id }, { $set: { 'provider.conversationId': r.conversationId } });
      if (r.simulated) {
        setTimeout(
          () =>
            void handleB2cResult({
              Result: { ResultCode: 0, ResultDesc: 'Simulated payout', OriginatorConversationID: w.provider!.originatorConversationId!, ConversationID: r.conversationId, TransactionID: `SIMB2C${Date.now().toString(36).toUpperCase()}` },
            }),
          5000,
        );
      }
    } catch (e) {
      log.error('B2C request failed', e);
      await refund(w, 'failed', `Payout failed: ${(e as Error).message}`);
    }
  }
  // USDT payouts are sent manually by the treasury team and then marked paid with the tx hash.
  return w;
}

export async function markWithdrawalPaid(adminId: string, id: string, txRef: string) {
  const w = await Withdrawal.findOneAndUpdate(
    { _id: id, status: 'processing' },
    { $set: { status: 'paid', paidAt: new Date(), 'provider.txRef': txRef, reviewedBy: adminId } },
    { new: true },
  ).lean<WithdrawalT>();
  if (!w) throw notFound('Withdrawal is not processing');
  emitW(w);
  return w;
}

interface B2cResultBody {
  Result?: { ResultCode: number | string; ResultDesc: string; OriginatorConversationID: string; ConversationID: string; TransactionID?: string };
}

export async function handleB2cResult(body: B2cResultBody) {
  const r = body.Result;
  if (!r) return;
  const w = await Withdrawal.findOne({ 'provider.originatorConversationId': r.OriginatorConversationID }).lean<WithdrawalT>();
  if (!w || w.status !== 'processing') return;
  if (Number(r.ResultCode) === 0) {
    const paid = await Withdrawal.findOneAndUpdate(
      { _id: w._id, status: 'processing' },
      { $set: { status: 'paid', paidAt: new Date(), 'provider.transactionId': r.TransactionID, 'provider.raw': r } },
      { new: true },
    ).lean<WithdrawalT>();
    if (paid) emitW(paid);
  } else {
    await refund(w, 'failed', r.ResultDesc || 'Payout failed');
  }
}
