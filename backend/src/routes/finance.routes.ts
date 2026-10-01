import { Router, Request } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { ah, parse, param } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { Deposit, DepositT, DEPOSIT_METHODS, Withdrawal, WithdrawalT } from '../models/finance';
import { Account, LedgerEntry, LedgerT } from '../models/account';
import { User } from '../models/user';
import { cancelDeposit, createDeposit, cryptoPayTo, listMethods, publicDeposit, submitCryptoTx } from '../finance/deposit.service';
import { activeWallets, coinAmount } from '../services/crypto-wallets.service';
import { cancelWithdrawal, publicWithdrawal, requestWithdrawal } from '../finance/withdrawal.service';
import { getBonusConfig } from '../services/settings.service';
import { getEffectiveWithdrawalPopup } from '../services/withdrawal-popup.service';
import { notFound } from '../lib/errors';
import { env } from '../config/env';
import { bonusOverview, cancelBonus } from '../bonus/bonus.service';

export const financeRouter = Router();
financeRouter.use(requireAuth);

financeRouter.get(
  '/methods',
  ah(async (req, res) => {
    const u = await User.findById(uid(req), { country: 1 }).lean();
    const country = String(req.query['country'] ?? u?.country ?? 'KE');
    const cfg = await getBonusConfig();
    res.json({ country, methods: await listMethods(country), limits: cfg.limits, kesPerUsd: env.KES_PER_USD, commission: 0 });
  }),
);

/** Coins users can deposit, with the approximate coin amount for a given USD amount. */
financeRouter.get(
  '/crypto',
  ah(async (req, res) => {
    const cents = Math.max(0, Math.round(Number(req.query['amount'] ?? 0)));
    const list = await activeWallets();
    res.json(list.map((w) => ({ code: w.code, coin: w.coin, name: w.name, network: w.network, popular: w.popular, coinAmount: cents ? coinAmount(w, cents) : null })));
  }),
);

financeRouter.post(
  '/deposits',
  ah(async (req, res) => {
    const b = parse(
      z.object({
        method: z.enum(DEPOSIT_METHODS),
        amount: z.number().int().positive(),
        phone: z.string().max(20).optional(),
        bonusOffer: z.enum(['first50', 'welcome100']).nullable().optional(),
        bonusTermsVersion: z.string().optional(),
        tradersBox: z.boolean().optional(),
        country: z.string().length(2).optional(),
        coin: z.string().max(20).optional(),
      }),
      req.body,
    );
    const u = await User.findById(uid(req), { country: 1 }).lean();
    res.status(201).json(await createDeposit(uid(req), b.country ?? u?.country ?? 'KE', b));
  }),
);

financeRouter.get(
  '/deposits/:id',
  ah(async (req, res) => {
    const d = await Deposit.findOne({ _id: param(req, 'id'), userId: uid(req) }).lean<DepositT>();
    if (!d) throw notFound('Deposit not found');
    res.json(publicDeposit(d, await cryptoPayTo(d)));
  }),
);

financeRouter.post(
  '/deposits/:id/tx',
  ah(async (req, res) => {
    const b = parse(z.object({ txHash: z.string().trim().min(10).max(120) }), req.body);
    res.json(await submitCryptoTx(uid(req), param(req, 'id'), b.txHash));
  }),
);

financeRouter.post('/deposits/:id/cancel', ah(async (req, res) => res.json(await cancelDeposit(uid(req), param(req, 'id')))));

financeRouter.post(
  '/withdrawals',
  ah(async (req, res) => {
    const b = parse(
      z.object({
        method: z.enum(['mpesa', 'usdt_trc20', 'usdt_bep20']),
        amount: z.number().int().positive(),
        phone: z.string().max(20).optional(),
        address: z.string().max(80).optional(),
      }),
      req.body,
    );
    res.status(201).json(await requestWithdrawal(uid(req), b));
  }),
);

financeRouter.post('/withdrawals/:id/cancel', ah(async (req, res) => res.json(await cancelWithdrawal(uid(req), param(req, 'id')))));

financeRouter.get(
  '/withdrawals',
  ah(async (req, res) => {
    const rows = await Withdrawal.find({ userId: uid(req) }).sort({ createdAt: -1 }).limit(50).lean<WithdrawalT[]>();
    res.json(rows.map(publicWithdrawal));
  }),
);

financeRouter.get(
  '/withdrawal-popup',
  ah(async (req, res) => {
    const popup = await getEffectiveWithdrawalPopup(uid(req));
    res.json({ active: !!popup, popup });
  }),
);

const INTERNAL_TYPES = ['bonus_credit', 'bonus_cancel', 'bonus_convert', 'box_reward', 'referral_commission', 'tournament_fee', 'tournament_prize', 'admin_adjust'];

interface HistoryRow {
  id: string;
  kind: 'deposit' | 'withdrawal' | 'internal';
  method: string;
  amount: number;
  status: string;
  reference: string;
  createdAt: Date;
}

async function history(req: Request): Promise<HistoryRow[]> {
  const q = parse(
    z.object({
      type: z.enum(['all', 'deposits', 'withdrawals', 'internal']).default('all'),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    req.query,
  );
  const range = { $gte: q.from ?? new Date(Date.now() - 90 * 86_400_000), $lte: q.to ? new Date(q.to.getTime() + 86_399_999) : new Date() };
  const userId = new Types.ObjectId(uid(req));
  const rows: HistoryRow[] = [];
  if (q.type === 'all' || q.type === 'deposits') {
    const ds = await Deposit.find({ userId, createdAt: range }).sort({ createdAt: -1 }).limit(500).lean<DepositT[]>();
    rows.push(...ds.map((d) => ({ id: String(d._id), kind: 'deposit' as const, method: d.method, amount: d.amount, status: d.status, reference: d.provider?.receipt ?? d.provider?.txHash ?? '', createdAt: (d as unknown as { createdAt: Date }).createdAt })));
  }
  if (q.type === 'all' || q.type === 'withdrawals') {
    const ws = await Withdrawal.find({ userId, createdAt: range }).sort({ createdAt: -1 }).limit(500).lean<WithdrawalT[]>();
    rows.push(...ws.map((w) => ({ id: String(w._id), kind: 'withdrawal' as const, method: w.method, amount: -w.amount, status: w.status, reference: w.provider?.transactionId ?? w.provider?.txRef ?? '', createdAt: (w as unknown as { createdAt: Date }).createdAt })));
  }
  if (q.type === 'all' || q.type === 'internal') {
    const real = await Account.findOne({ userId, type: 'real' }, { _id: 1 }).lean();
    const ls = await LedgerEntry.find({ accountId: real?._id, type: { $in: INTERNAL_TYPES }, createdAt: range }).sort({ createdAt: -1 }).limit(500).lean<LedgerT[]>();
    rows.push(...ls.map((l) => ({ id: String(l._id), kind: 'internal' as const, method: `${l.type}${l.bucket === 'bonus' ? ' (bonus)' : ''}`, amount: l.amount, status: 'completed', reference: l.note ?? '', createdAt: (l as unknown as { createdAt: Date }).createdAt })));
  }
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

financeRouter.get('/history', ah(async (req, res) => res.json(await history(req))));

financeRouter.get(
  '/history.csv',
  ah(async (req, res) => {
    const rows = await history(req);
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // CSV injection guard
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const csv = [
      'Date,Type,Method,Amount (USD),Status,Reference,ID',
      ...rows.map((r) => [r.createdAt.toISOString(), r.kind, r.method, (r.amount / 100).toFixed(2), r.status, r.reference, r.id].map(esc).join(',')),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="y2markets-history-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }),
);

// ---------------- Bonuses ----------------
export const bonusRouter = Router();
bonusRouter.use(requireAuth);
bonusRouter.get('/', ah(async (req, res) => res.json(await bonusOverview(uid(req)))));
bonusRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    await cancelBonus(uid(req), param(req, 'id'));
    res.json(await bonusOverview(uid(req)));
  }),
);
