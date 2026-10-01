import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { FilterQuery, Types } from 'mongoose';
import { ah, objectId, paging, parse, param } from '../lib/http';
import { requireAdmin, uid } from '../middleware/auth';
import { User, UserT, publicUser } from '../models/user';
import { Account, AccountT, LedgerEntry, LedgerT, LEDGER_TYPES, publicAccount } from '../models/account';
import { Deposit, DepositT, Withdrawal, WithdrawalT } from '../models/finance';
import { Asset, AssetT, Tick } from '../models/market';
import { Trade, TradeT, publicTrade } from '../models/trade';
import { ChatMessage, ChatT, KycDocument, Tournament, TournamentT } from '../models/misc';
import { badRequest, notFound } from '../lib/errors';
import { env } from '../config/env';
import { emitAccounts, postEntry, withTxn } from '../services/ledger.service';
import { bonusConfigSchema, getBonusConfig, setBonusConfig } from '../services/settings.service';
import { cryptoWalletsSchema, getCryptoWallets, setCryptoWallets } from '../services/crypto-wallets.service';
import { withdrawalPopupSchema, getGlobalWithdrawalPopup, setGlobalWithdrawalPopup } from '../services/withdrawal-popup.service';
import { completeDeposit, failDeposit, publicDeposit } from '../finance/deposit.service';
import { approveWithdrawal, markWithdrawalPaid, publicWithdrawal, rejectWithdrawal } from '../finance/withdrawal.service';
import { marketHub } from '../market/market-hub';
import { tickStore } from '../market/tick-store';
import { decideOutcome } from '../trading/trade.service';
import { publicChat } from './community.routes';
import { publicTournament } from '../tournaments/tournament.service';
import { toAll, toUser } from '../realtime/io';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const startOfDay = () => new Date(new Date().setUTCHours(0, 0, 0, 0));

adminRouter.get(
  '/stats',
  ah(async (_req, res) => {
    const today = startOfDay();
    const sum = async (model: typeof Deposit | typeof Withdrawal, match: Record<string, unknown>) =>
      ((await (model as typeof Deposit).aggregate<{ t: number }>([{ $match: match }, { $group: { _id: null, t: { $sum: '$amount' } } }]))[0]?.t ?? 0);
    const [users, usersToday, openTrades, kycPending, pendingW, depToday, depAll, wPaid, realBalances, platformPnl] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: today } }),
      Trade.countDocuments({ status: 'open' }),
      User.countDocuments({ kycStatus: 'pending' }),
      Withdrawal.countDocuments({ status: 'pending_review' }),
      sum(Deposit, { status: 'completed', completedAt: { $gte: today } }),
      sum(Deposit, { status: 'completed' }),
      sum(Withdrawal, { status: 'paid' }),
      Account.aggregate<{ c: number; b: number }>([{ $match: { type: 'real' } }, { $group: { _id: null, c: { $sum: '$balance' }, b: { $sum: '$bonusBalance' } } }]),
      Trade.aggregate<{ p: number }>([{ $match: { accountType: 'real', status: { $ne: 'open' } } }, { $group: { _id: null, p: { $sum: '$profit' } } }]),
    ]);
    const pendingDeposits = await Deposit.countDocuments({ status: 'awaiting_review' });
    res.json({
      users,
      usersToday,
      openTrades,
      kycPending,
      pendingWithdrawals: pendingW,
      pendingDeposits,
      depositsToday: depToday,
      depositsTotal: depAll,
      withdrawalsPaid: wPaid,
      clientCash: realBalances[0]?.c ?? 0,
      clientBonus: realBalances[0]?.b ?? 0,
      clientTradingPnl: platformPnl[0]?.p ?? 0,
    });
  }),
);

// ---------------- Users ----------------
adminRouter.get(
  '/users',
  ah(async (req, res) => {
    const { limit, skip } = paging(req.query);
    const q = String(req.query['q'] ?? '').trim();
    const filter: FilterQuery<UserT> = q
      ? { $or: [{ username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }
      : {};
    const [rows, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<UserT[]>(), User.countDocuments(filter)]);
    const accs = await Account.find({ userId: { $in: rows.map((r) => r._id) }, type: 'real' }).lean<AccountT[]>();
    const aMap = new Map(accs.map((a) => [String(a.userId), a]));
    res.json({
      total,
      rows: rows.map((u) => ({ ...publicUser(u), blocked: u.blocked, lastLoginAt: u.lastLoginAt ?? null, lastIp: u.lastIp ?? null, real: aMap.get(String(u._id)) ? publicAccount(aMap.get(String(u._id))!) : null })),
    });
  }),
);

adminRouter.get(
  '/users/:id',
  ah(async (req, res) => {
    const u = await User.findById(param(req, 'id')).lean<UserT>();
    if (!u) throw notFound('User not found');
    const [accounts, ledger, trades, deposits, withdrawals, kyc, referrer] = await Promise.all([
      Account.find({ userId: u._id }).lean<AccountT[]>(),
      LedgerEntry.find({ userId: u._id }).sort({ createdAt: -1 }).limit(50).lean<LedgerT[]>(),
      Trade.find({ userId: u._id }).sort({ openedAt: -1 }).limit(30).lean<TradeT[]>(),
      Deposit.find({ userId: u._id }).sort({ createdAt: -1 }).limit(30).lean<DepositT[]>(),
      Withdrawal.find({ userId: u._id }).sort({ createdAt: -1 }).limit(30).lean<WithdrawalT[]>(),
      KycDocument.find({ userId: u._id }).sort({ createdAt: -1 }).lean(),
      u.referredBy ? User.findById(u.referredBy, { username: 1 }).lean() : null,
    ]);
    res.json({
      user: { ...publicUser(u), blocked: u.blocked, lastLoginAt: u.lastLoginAt ?? null, lastIp: u.lastIp ?? null, referrer: referrer?.username ?? null },
      accounts: accounts.map(publicAccount),
      ledger: ledger.map(publicLedger),
      trades: trades.map(publicTrade),
      deposits: deposits.map((d) => publicDeposit(d)),
      withdrawals: withdrawals.map(publicWithdrawal),
      kyc: kyc.map((d) => ({ id: String(d._id), docType: d.docType, originalName: d.originalName, mime: d.mime, createdAt: d.createdAt })),
    });
  }),
);

adminRouter.patch(
  '/users/:id',
  ah(async (req, res) => {
    const b = parse(z.object({ blocked: z.boolean().optional(), role: z.enum(['user', 'admin']).optional(), level: z.string().max(20).optional(), withdrawalPopup: withdrawalPopupSchema.optional() }), req.body);
    if (param(req, 'id') === uid(req) && (b.blocked || b.role === 'user')) throw badRequest('You cannot block or demote yourself');
    const u = await User.findByIdAndUpdate(param(req, 'id'), { $set: b }, { new: true }).lean<UserT>();
    if (!u) throw notFound();
    res.json({ ...publicUser(u), blocked: u.blocked });
  }),
);

adminRouter.patch(
  '/users/:id/withdrawal-popup',
  ah(async (req, res) => {
    const b = parse(withdrawalPopupSchema, req.body);
    const u = await User.findByIdAndUpdate(param(req, 'id'), { $set: { withdrawalPopup: b } }, { new: true }).lean<UserT>();
    if (!u) throw notFound('User not found');
    res.json({ ok: true, withdrawalPopup: u.withdrawalPopup });
  }),
);

adminRouter.post(
  '/users/:id/adjust',
  ah(async (req, res) => {
    const b = parse(z.object({ accountId: objectId, bucket: z.enum(['cash', 'bonus']), amount: z.number().int().refine((n) => n !== 0), note: z.string().trim().min(3).max(200) }), req.body);
    const acc = await Account.findOne({ _id: b.accountId, userId: param(req, 'id') }).lean();
    if (!acc) throw notFound('Account not found');
    await withTxn((s) => postEntry(s, { accountId: b.accountId, type: 'admin_adjust', bucket: b.bucket, amount: b.amount, note: b.note, actorId: uid(req) }));
    await emitAccounts(param(req, 'id'));
    res.json({ ok: true });
  }),
);

// ---------------- KYC ----------------
adminRouter.get(
  '/kyc',
  ah(async (req, res) => {
    const status = String(req.query['status'] ?? 'pending');
    const users = await User.find({ kycStatus: status }).sort({ updatedAt: 1 }).limit(100).lean<UserT[]>();
    const docs = await KycDocument.find({ userId: { $in: users.map((u) => u._id) } }).lean();
    res.json(
      users.map((u) => ({
        user: publicUser(u),
        documents: docs.filter((d) => String(d.userId) === String(u._id)).map((d) => ({ id: String(d._id), docType: d.docType, originalName: d.originalName, mime: d.mime, createdAt: d.createdAt })),
      })),
    );
  }),
);

adminRouter.get(
  '/kyc/file/:docId',
  ah(async (req, res) => {
    const d = await KycDocument.findById(param(req, 'docId')).lean();
    if (!d) throw notFound();
    res.setHeader('Content-Type', d.mime ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.resolve(process.cwd(), env.UPLOAD_DIR, 'kyc', path.basename(d.path)));
  }),
);

adminRouter.post(
  '/kyc/:userId/review',
  ah(async (req, res) => {
    const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }), req.body);
    const u = await User.findByIdAndUpdate(param(req, 'userId'), { $set: { kycStatus: b.status, kycNote: b.note } }, { new: true }).lean<UserT>();
    if (!u) throw notFound();
    toUser(u._id, 'toast', { kind: b.status === 'approved' ? 'success' : 'error', text: b.status === 'approved' ? 'Your identity has been verified ✅' : `Identity verification rejected: ${b.note ?? 'please re-upload clearer documents'}` });
    res.json({ ok: true });
  }),
);

// ---------------- Deposits & withdrawals ----------------
adminRouter.get(
  '/deposits',
  ah(async (req, res) => {
    const { limit, skip } = paging(req.query);
    const status = req.query['status'] ? String(req.query['status']) : undefined;
    const rows = await Deposit.find(status ? { status } : {}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<DepositT[]>();
    const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }, { username: 1, email: 1 }).lean();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    res.json(rows.map((d) => publicDeposit(d, { username: uMap.get(String(d.userId))?.username, email: uMap.get(String(d.userId))?.email, userId: String(d.userId) })));
  }),
);
adminRouter.post(
  '/deposits/:id/approve',
  ah(async (req, res) => {
    const r = await completeDeposit(param(req, 'id'), { receipt: `MANUAL-${uid(req).slice(-6)}` }, uid(req));
    if (!r) throw badRequest('Deposit is not awaiting approval');
    res.json(publicDeposit(r.dep));
  }),
);
adminRouter.post(
  '/deposits/:id/reject',
  ah(async (req, res) => {
    const b = parse(z.object({ note: z.string().min(3).max(200) }), req.body);
    const d = await failDeposit(param(req, 'id'), b.note);
    if (!d) throw badRequest('Deposit cannot be rejected');
    res.json(publicDeposit(d));
  }),
);

adminRouter.get(
  '/withdrawals',
  ah(async (req, res) => {
    const { limit, skip } = paging(req.query);
    const status = req.query['status'] ? String(req.query['status']) : undefined;
    const rows = await Withdrawal.find(status ? { status } : {}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<WithdrawalT[]>();
    const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }, { username: 1, email: 1, kycStatus: 1, emailVerified: 1 }).lean();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    res.json(
      rows.map((w) => {
        const u = uMap.get(String(w.userId));
        return { ...publicWithdrawal(w), userId: String(w.userId), username: u?.username, email: u?.email, kycStatus: u?.kycStatus, emailVerified: u?.emailVerified };
      }),
    );
  }),
);
adminRouter.post('/withdrawals/:id/approve', ah(async (req, res) => res.json(publicWithdrawal(await approveWithdrawal(uid(req), param(req, 'id'))))));
adminRouter.post(
  '/withdrawals/:id/reject',
  ah(async (req, res) => {
    const b = parse(z.object({ note: z.string().min(3).max(200) }), req.body);
    const w = await rejectWithdrawal(uid(req), param(req, 'id'), b.note);
    res.json(w ? publicWithdrawal(w) : null);
  }),
);
adminRouter.post(
  '/withdrawals/:id/mark-paid',
  ah(async (req, res) => {
    const b = parse(z.object({ txRef: z.string().min(4).max(120) }), req.body);
    res.json(publicWithdrawal(await markWithdrawalPaid(uid(req), param(req, 'id'), b.txRef)));
  }),
);

// ---------------- Assets ----------------
adminRouter.get(
  '/assets',
  ah(async (_req, res) => {
    const rows = await Asset.find().sort({ sort: 1 }).lean<AssetT[]>();
    res.json(rows.map((a) => ({ ...a, _id: String(a._id), price: marketHub.latest(a.symbol)?.price ?? null, fresh: marketHub.isFresh(a.symbol) })));
  }),
);
adminRouter.patch(
  '/assets/:symbol',
  ah(async (req, res) => {
    const b = parse(
      z.object({
        payout: z.number().int().min(10).max(100).optional(),
        enabled: z.boolean().optional(),
        minTradeCents: z.number().int().min(100).optional(),
        maxTradeCents: z.number().int().min(100).max(10_000_000).optional(),
        sort: z.number().int().optional(),
        cfd: z.object({ enabled: z.boolean(), spread: z.number().min(0), leverage: z.number().int().min(1).max(500), contractSize: z.number().positive() }).partial().optional(),
      }),
      req.body,
    );
    const set: Record<string, unknown> = { ...b };
    delete set['cfd'];
    if (b.cfd) for (const [k, v] of Object.entries(b.cfd)) set[`cfd.${k}`] = v;
    const a = await Asset.findOneAndUpdate({ symbol: param(req, 'symbol') }, { $set: set }, { new: true }).lean<AssetT>();
    if (!a) throw notFound('Asset not found');
    await marketHub.reloadAsset(a.symbol);
    res.json(a);
  }),
);

// ---------------- Bonus configuration ----------------
adminRouter.get('/settings/bonuses', ah(async (_req, res) => res.json(await getBonusConfig())));
adminRouter.put(
  '/settings/bonuses',
  ah(async (req, res) => {
    const cfg = parse(bonusConfigSchema, req.body);
    await setBonusConfig(cfg);
    res.json(cfg);
  }),
);

// ---------------- Deposit / withdrawal limits ----------------
adminRouter.get('/settings/limits', ah(async (_req, res) => res.json((await getBonusConfig()).limits)));
adminRouter.put(
  '/settings/limits',
  ah(async (req, res) => {
    const limits = parse(
      z.object({ minDeposit: z.number().int().min(1), maxDeposit: z.number().int().min(1), minWithdrawal: z.number().int().min(100) }),
      req.body,
    );
    if (limits.maxDeposit < limits.minDeposit) throw badRequest('Maximum deposit must be at least the minimum deposit');
    const cfg = await getBonusConfig();
    await setBonusConfig({ ...cfg, limits });
    toAll('settings:limits', limits); // every open deposit / withdrawal screen updates instantly
    res.json(limits);
  }),
);

// ---------------- Crypto deposit wallets ----------------
adminRouter.get('/settings/crypto', ah(async (_req, res) => res.json(await getCryptoWallets())));
adminRouter.put(
  '/settings/crypto',
  ah(async (req, res) => {
    const wallets = parse(cryptoWalletsSchema, req.body);
    for (const w of wallets) {
      if (w.enabled && w.address && w.address.length < 20) throw badRequest(`${w.coin}: that address looks too short`);
    }
    await setCryptoWallets(wallets);
    res.json(wallets);
  }),
);

// ---------------- Global withdrawal popup ----------------
adminRouter.get('/settings/withdrawal-popup', ah(async (_req, res) => res.json(await getGlobalWithdrawalPopup())));
adminRouter.put(
  '/settings/withdrawal-popup',
  ah(async (req, res) => {
    const popup = parse(withdrawalPopupSchema, req.body);
    await setGlobalWithdrawalPopup(popup);
    toAll('settings:withdrawal-popup', popup);
    res.json(popup);
  }),
);

// ---------------- Ledger & trade audit ----------------
const publicLedger = (l: LedgerT) => ({
  id: String(l._id),
  userId: String(l.userId),
  accountId: String(l.accountId),
  accountType: l.accountType,
  type: l.type,
  bucket: l.bucket,
  amount: l.amount,
  balanceAfter: l.balanceAfter,
  refKind: l.refKind ?? null,
  refId: l.refId ? String(l.refId) : null,
  note: l.note ?? null,
  actorId: l.actorId ? String(l.actorId) : null,
  createdAt: (l as unknown as { createdAt: Date }).createdAt,
});

adminRouter.get(
  '/ledger',
  ah(async (req, res) => {
    const { limit, skip } = paging(req.query, 200);
    const q = parse(z.object({ userId: objectId.optional(), type: z.enum(LEDGER_TYPES).optional(), accountType: z.enum(['demo', 'real', 'tournament']).optional() }), req.query);
    const filter: FilterQuery<LedgerT> = {};
    if (q.userId) filter.userId = q.userId;
    if (q.type) filter.type = q.type;
    if (q.accountType) filter.accountType = q.accountType;
    const [rows, total] = await Promise.all([LedgerEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<LedgerT[]>(), LedgerEntry.countDocuments(filter)]);
    const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }, { username: 1 }).lean();
    const uMap = new Map(users.map((u) => [String(u._id), u.username]));
    res.json({ total, rows: rows.map((l) => ({ ...publicLedger(l), username: uMap.get(String(l.userId)) })) });
  }),
);

adminRouter.get(
  '/trades',
  ah(async (req, res) => {
    const { limit, skip } = paging(req.query, 200);
    const q = parse(z.object({ userId: objectId.optional(), symbol: z.string().optional(), status: z.enum(['open', 'won', 'lost', 'draw']).optional(), accountType: z.enum(['demo', 'real', 'tournament']).optional() }), req.query);
    const filter: FilterQuery<TradeT> = {};
    if (q.userId) filter.userId = q.userId;
    if (q.symbol) filter.symbol = q.symbol;
    if (q.status) filter.status = q.status;
    if (q.accountType) filter.accountType = q.accountType;
    const [rows, total] = await Promise.all([Trade.find(filter).sort({ openedAt: -1 }).skip(skip).limit(limit).lean<TradeT[]>(), Trade.countDocuments(filter)]);
    const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }, { username: 1 }).lean();
    const uMap = new Map(users.map((u) => [String(u._id), u.username]));
    res.json({ total, rows: rows.map((t) => ({ ...publicTrade(t), userId: String(t.userId), username: uMap.get(String(t.userId)) })) });
  }),
);

/**
 * Independent re-verification of a trade from stored ticks:
 * loads the exact open/close ticks by id, re-derives the close tick from the time-series,
 * and recomputes the outcome and payout.
 */
adminRouter.get(
  '/trades/:id/audit',
  ah(async (req, res) => {
    const t = await Trade.findById(param(req, 'id')).lean<TradeT>();
    if (!t) throw notFound('Trade not found');
    const [openTick, closeTick, ledger, user] = await Promise.all([
      Tick.findById(t.openTickId).lean(),
      t.closeTickId ? Tick.findById(t.closeTickId).lean() : null,
      LedgerEntry.find({ refKind: 'trade', refId: t._id }).sort({ createdAt: 1 }).lean<LedgerT[]>(),
      User.findById(t.userId, { username: 1 }).lean(),
    ]);
    const derived = await Tick.findOne({ symbol: t.symbol, ts: { $lte: t.expiresAt } }).sort({ ts: -1 }).lean();
    const from = t.openedAt.getTime() - 60_000;
    const to = (t.closedAt ?? new Date()).getTime() + 15_000;
    const ticks = await tickStore.rangeAny(t.symbol, from, to);
    const step = Math.max(1, Math.ceil(ticks.length / 1500));
    const recomputed =
      t.status === 'open' || !derived
        ? null
        : (() => {
            const closePrice = derived.ts.getTime() >= t.openedAt.getTime() ? derived.price : t.openPrice;
            const status = decideOutcome(t.direction as 'up' | 'down', t.openPrice, closePrice);
            const payout = status === 'won' ? t.amount + Math.floor((t.amount * t.payoutPct) / 100) : status === 'draw' ? t.amount : 0;
            return { closePrice, status, payout };
          })();
    res.json({
      trade: { ...publicTrade(t), username: user?.username, fromCash: t.fromCash, fromBonus: t.fromBonus, idempotencyKey: t.idempotencyKey },
      openTick: openTick ? { id: String(openTick._id), ts: openTick.ts, price: openTick.price } : null,
      closeTick: closeTick ? { id: String(closeTick._id), ts: closeTick.ts, price: closeTick.price } : null,
      derivedCloseTick: derived ? { id: String(derived._id), ts: derived.ts, price: derived.price } : null,
      recomputed,
      verified:
        !!recomputed &&
        !!openTick &&
        openTick.price === t.openPrice &&
        recomputed.status === t.status &&
        recomputed.payout === t.payout &&
        (!closeTick || String(closeTick._id) === String(derived?._id) || closeTick.price === recomputed.closePrice),
      ledger: ledger.map(publicLedger),
      ticks: ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1).map((x) => ({ t: x.ts, p: x.price, id: String(x.id) })),
    });
  }),
);

// ---------------- Support chat ----------------
adminRouter.get(
  '/chat/conversations',
  ah(async (_req, res) => {
    const rows = await ChatMessage.aggregate<{ _id: Types.ObjectId; last: ChatT; unread: number }>([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationUserId', last: { $first: '$$ROOT' }, unread: { $sum: { $cond: [{ $and: [{ $eq: ['$from', 'user'] }, { $eq: ['$readBySupport', false] }] }, 1, 0] } } } },
      { $sort: { 'last.createdAt': -1 } },
      { $limit: 200 },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }, { username: 1, fullName: 1, email: 1 }).lean();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    res.json(rows.map((r) => ({ userId: String(r._id), username: uMap.get(String(r._id))?.username, fullName: uMap.get(String(r._id))?.fullName, last: publicChat(r.last), unread: r.unread })));
  }),
);
adminRouter.get(
  '/chat/:userId',
  ah(async (req, res) => {
    const rows = await ChatMessage.find({ conversationUserId: param(req, 'userId') }).sort({ createdAt: -1 }).limit(200).lean<ChatT[]>();
    await ChatMessage.updateMany({ conversationUserId: param(req, 'userId'), from: 'user', readBySupport: false }, { $set: { readBySupport: true } });
    res.json(rows.reverse().map(publicChat));
  }),
);
adminRouter.post(
  '/chat/:userId',
  ah(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
    const m = await ChatMessage.create({ conversationUserId: param(req, 'userId'), from: 'support', authorId: uid(req), text: b.text, readBySupport: true });
    const out = publicChat(m.toObject() as ChatT);
    toUser(param(req, 'userId'), 'chat:message', out);
    res.status(201).json(out);
  }),
);

// ---------------- Tournaments ----------------
adminRouter.get(
  '/tournaments',
  ah(async (_req, res) => {
    const rows = await Tournament.find().sort({ startsAt: -1 }).limit(100).lean<TournamentT[]>();
    res.json(rows.map((t) => publicTournament(t)));
  }),
);
adminRouter.post(
  '/tournaments',
  ah(async (req, res) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(3).max(80),
        description: z.string().max(500).default(''),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        entryFee: z.number().int().min(0),
        startingBalance: z.number().int().min(100),
        prizes: z.array(z.number().int().min(0)).max(50),
      }),
      req.body,
    );
    if (b.endsAt <= b.startsAt) throw badRequest('End must be after start');
    const t = await Tournament.create(b);
    res.status(201).json(publicTournament(t.toObject() as TournamentT));
  }),
);
adminRouter.delete(
  '/tournaments/:id',
  ah(async (req, res) => {
    if (await Account.exists({ type: 'tournament', tournamentId: param(req, 'id') })) throw badRequest('Tournament already has participants');
    await Tournament.deleteOne({ _id: param(req, 'id'), status: 'upcoming' });
    res.json({ ok: true });
  }),
);
