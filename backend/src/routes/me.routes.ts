import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { ah, objectId, parse, param } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { publicUser, Session, User, UserT } from '../models/user';
import { Account, AccountT, LedgerEntry, publicAccount } from '../models/account';
import { Trade } from '../models/trade';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { hashPassword, verifyPassword } from '../services/auth.service';
import { passwordSchema } from './auth.routes';
import { emitAccounts, postEntry, withTxn } from '../services/ledger.service';
import { getBonusConfig } from '../services/settings.service';
import { Tournament } from '../models/misc';

export const meRouter = Router();
meRouter.use(requireAuth);

async function loadMe(userId: string) {
  const u = await User.findById(userId).lean<UserT>();
  if (!u) throw notFound('User not found');
  const accounts = await Account.find({ userId }).lean<AccountT[]>();
  const tIds = accounts.filter((a) => a.tournamentId).map((a) => a.tournamentId);
  const ts = await Tournament.find({ _id: { $in: tIds } }, { name: 1, status: 1 }).lean();
  const tMap = new Map(ts.map((t) => [String(t._id), t]));
  // If the selected account belongs to a tournament that isn't running (not started yet or finished),
  // fall back to the demo account so trading never fails with a tournament error.
  const active = accounts.find((a) => String(a._id) === String(u.activeAccountId));
  if (active?.type === 'tournament' && tMap.get(String(active.tournamentId))?.status !== 'running') {
    const demo = accounts.find((a) => a.type === 'demo');
    if (demo) {
      await User.updateOne({ _id: u._id }, { $set: { activeAccountId: demo._id } });
      u.activeAccountId = demo._id;
    }
  }
  return {
    user: publicUser(u),
    accounts: accounts.map((a) => ({
      ...publicAccount(a),
      tournamentName: a.tournamentId ? (tMap.get(String(a.tournamentId))?.name ?? null) : null,
      tournamentStatus: a.tournamentId ? (tMap.get(String(a.tournamentId))?.status ?? null) : null,
    })),
  };
}

meRouter.get('/', ah(async (req, res) => res.json(await loadMe(uid(req)))));

meRouter.patch(
  '/',
  ah(async (req, res) => {
    const b = parse(
      z.object({
        fullName: z.string().trim().min(2).max(80).optional(),
        phone: z.string().trim().max(20).optional(),
        country: z.string().length(2).toUpperCase().optional(),
        timezoneOffset: z.number().int().min(-720).max(840).optional(),
        isPublic: z.boolean().optional(),
        avatarUrl: z.string().max(200).optional(),
      }),
      req.body,
    );
    await User.updateOne({ _id: uid(req) }, { $set: b });
    res.json(await loadMe(uid(req)));
  }),
);

meRouter.post(
  '/password',
  ah(async (req, res) => {
    const b = parse(z.object({ current: z.string(), next: passwordSchema }), req.body);
    const u = await User.findById(uid(req));
    if (!u || !(await verifyPassword(b.current, u.passwordHash))) throw badRequest('Current password is incorrect', 'BAD_PASSWORD');
    u.passwordHash = await hashPassword(b.next);
    await u.save();
    res.json({ ok: true });
  }),
);

meRouter.put(
  '/pins',
  ah(async (req, res) => {
    const b = parse(z.object({ symbols: z.array(z.string().max(20)).max(12) }), req.body);
    await User.updateOne({ _id: uid(req) }, { $set: { pinnedAssets: [...new Set(b.symbols)] } });
    res.json({ pinnedAssets: b.symbols });
  }),
);

meRouter.post(
  '/promos/dismiss',
  ah(async (req, res) => {
    const b = parse(z.object({ promo: z.string().max(40) }), req.body);
    await User.updateOne({ _id: uid(req) }, { $addToSet: { dismissedPromos: b.promo } });
    res.json({ ok: true });
  }),
);

meRouter.patch(
  '/onboarding',
  ah(async (req, res) => {
    const b = parse(
      z.object({ welcomeSeen: z.boolean().optional(), goodLuckSeen: z.boolean().optional(), tourStep: z.number().int().min(0).max(50).optional(), tourDone: z.boolean().optional() }),
      req.body,
    );
    const set = Object.fromEntries(Object.entries(b).map(([k, v]) => [`onboarding.${k}`, v]));
    const u = await User.findByIdAndUpdate(uid(req), { $set: set }, { new: true }).lean<UserT>();
    res.json({ onboarding: u?.onboarding });
  }),
);

meRouter.post(
  '/active-account',
  ah(async (req, res) => {
    const b = parse(z.object({ accountId: objectId }), req.body);
    const acc = await Account.findOne({ _id: b.accountId, userId: uid(req) }).lean<AccountT>();
    if (!acc) throw notFound('Account not found');
    if (acc.type === 'tournament') {
      const t = await Tournament.findById(acc.tournamentId, { status: 1, startsAt: 1 }).lean();
      if (t?.status !== 'running')
        throw badRequest(t?.status === 'upcoming' ? 'This tournament has not started yet. You can trade in it once it begins.' : 'This tournament has ended.', 'TOURNAMENT_CLOSED');
    }
    await User.updateOne({ _id: uid(req) }, { $set: { activeAccountId: b.accountId } });
    res.json({ activeAccountId: b.accountId });
  }),
);

meRouter.post(
  '/demo/reset',
  ah(async (req, res) => {
    const cfg = await getBonusConfig();
    const demo = await Account.findOne({ userId: uid(req), type: 'demo' }).lean<AccountT>();
    if (!demo) throw notFound('Demo account not found');
    if (await Trade.exists({ accountId: demo._id, status: 'open' })) throw badRequest('Close your open demo trades first');
    await withTxn(async (s) => {
      const fresh = await Account.findById(demo._id).session(s).lean<AccountT>();
      await postEntry(s, { accountId: demo._id, type: 'demo_reset', bucket: 'cash', amount: cfg.demoBalance - (fresh?.balance ?? 0), note: 'Demo balance reset' });
    });
    await emitAccounts(uid(req));
    res.json(await loadMe(uid(req)));
  }),
);

// ---- 2FA (TOTP) ----
meRouter.post(
  '/2fa/setup',
  ah(async (req, res) => {
    const u = await User.findById(uid(req));
    if (!u) throw notFound();
    if (u.twoFactor?.enabled) throw badRequest('2FA is already enabled');
    const secret = authenticator.generateSecret();
    u.set('twoFactor.pendingSecret', secret);
    await u.save();
    const otpauth = authenticator.keyuri(u.email, 'Y2 Markets', secret);
    res.json({ secret, otpauth, qr: await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }) });
  }),
);

meRouter.post(
  '/2fa/enable',
  ah(async (req, res) => {
    const b = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    const u = await User.findById(uid(req));
    const secret = u?.twoFactor?.pendingSecret;
    if (!u || !secret) throw badRequest('Start 2FA setup first');
    if (!authenticator.verify({ token: b.code, secret })) throw badRequest('Invalid code', 'BAD_2FA');
    u.set('twoFactor', { enabled: true, secret, pendingSecret: undefined });
    await u.save();
    res.json({ ok: true });
  }),
);

meRouter.post(
  '/2fa/disable',
  ah(async (req, res) => {
    const b = parse(z.object({ code: z.string().regex(/^\d{6}$/), password: z.string() }), req.body);
    const u = await User.findById(uid(req));
    if (!u?.twoFactor?.enabled || !u.twoFactor.secret) throw badRequest('2FA is not enabled');
    if (!(await verifyPassword(b.password, u.passwordHash))) throw unauthorized('Incorrect password', 'BAD_PASSWORD');
    if (!authenticator.verify({ token: b.code, secret: u.twoFactor.secret })) throw badRequest('Invalid code', 'BAD_2FA');
    u.set('twoFactor', { enabled: false });
    await u.save();
    res.json({ ok: true });
  }),
);

meRouter.get(
  '/sessions',
  ah(async (req, res) => {
    const list = await Session.find({ userId: uid(req), revokedAt: null, replacedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json(list.map((s) => ({ id: String(s._id), userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt })));
  }),
);

meRouter.delete(
  '/sessions/:id',
  ah(async (req, res) => {
    await Session.updateOne({ _id: param(req, 'id'), userId: uid(req) }, { $set: { revokedAt: new Date() } });
    res.json({ ok: true });
  }),
);

/** Trading statistics shown on the profile page and avatar menu. */
meRouter.get(
  '/stats',
  ah(async (req, res) => {
    const userId = new Types.ObjectId(uid(req));
    const real = await Account.findOne({ userId, type: 'real' }, { _id: 1 }).lean();
    const accountId = real?._id ?? new Types.ObjectId();
    const since = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const [today] = await Trade.aggregate<{ trades: number; turnover: number; profit: number }>([
      { $match: { accountId, openedAt: { $gte: since } } },
      { $group: { _id: null, trades: { $sum: 1 }, turnover: { $sum: '$amount' }, profit: { $sum: '$profit' } } },
    ]);
    const [all] = await Trade.aggregate<{ trades: number; wins: number; profit: number; volume: number; best: number }>([
      { $match: { accountId, status: { $in: ['won', 'lost', 'draw'] } } },
      { $group: { _id: null, trades: { $sum: 1 }, wins: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } }, profit: { $sum: '$profit' }, volume: { $sum: '$amount' }, best: { $max: '$profit' } } },
    ]);
    const deposits = await LedgerEntry.aggregate<{ total: number }>([
      { $match: { userId, type: 'deposit' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    res.json({
      today: { trades: today?.trades ?? 0, turnover: today?.turnover ?? 0, profit: today?.profit ?? 0 },
      allTime: { trades: all?.trades ?? 0, winRate: all?.trades ? Math.round((all.wins / all.trades) * 100) : 0, profit: all?.profit ?? 0, volume: all?.volume ?? 0, best: all?.best ?? 0 },
      totalDeposited: deposits[0]?.total ?? 0,
    });
  }),
);
