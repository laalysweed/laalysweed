import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { z } from 'zod';
import { Types } from 'mongoose';
import { ah, objectId, parse, param } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { User } from '../models/user';
import { Account, AccountT, LedgerEntry } from '../models/account';
import { Deposit } from '../models/finance';
import { ChatMessage, ChatT, Follow, KycDocument, Signal, SignalT, Tournament, TournamentT } from '../models/misc';
import { Trade, TradeT, publicTrade } from '../models/trade';
import { env } from '../config/env';
import { badRequest, notFound } from '../lib/errors';
import { randomToken } from '../lib/crypto';
import { getBonusConfig } from '../services/settings.service';
import { toAdmins, toUser } from '../realtime/io';
import { joinTournament, leaderboard, publicTournament } from '../tournaments/tournament.service';
import { publicSignal, signalStats } from '../signals/signal.engine';
import { traderStats } from '../social/copy.service';

// ---------------- Referrals ----------------
export const referralRouter = Router();
referralRouter.use(requireAuth);
referralRouter.get(
  '/',
  ah(async (req, res) => {
    const me = await User.findById(uid(req), { username: 1 }).lean();
    const invited = await User.find({ referredBy: uid(req) }, { username: 1, createdAt: 1, country: 1 }).sort({ createdAt: -1 }).lean();
    const ids = invited.map((u) => u._id);
    const depositors = await Deposit.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { userId: { $in: ids }, status: 'completed' } },
      { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    ]);
    const depMap = new Map(depositors.map((d) => [String(d._id), d.total]));
    const commissions = await LedgerEntry.find({ userId: uid(req), type: 'referral_commission' }).sort({ createdAt: -1 }).limit(100).lean();
    const cfg = await getBonusConfig();
    const mask = (s: string) => (s.length <= 3 ? `${s[0]}**` : `${s.slice(0, 2)}${'*'.repeat(Math.min(5, s.length - 3))}${s.slice(-1)}`);
    res.json({
      code: me?.username,
      link: `${env.APP_URL}/?ref=${me?.username}`,
      commissionPct: cfg.referral.depositPct,
      stats: {
        invited: invited.length,
        depositors: depositors.length,
        totalCommission: commissions.reduce((s, c) => s + c.amount, 0),
      },
      referrals: invited.map((u) => ({ username: mask(u.username), country: u.country, joinedAt: u.createdAt, deposited: depMap.has(String(u._id)) })),
      commissions: commissions.map((c) => ({ id: String(c._id), amount: c.amount, createdAt: c.createdAt })),
    });
  }),
);

// ---------------- KYC ----------------
const kycDir = path.resolve(process.cwd(), env.UPLOAD_DIR, 'kyc');
fs.mkdirSync(kycDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: kycDir,
    filename: (_req, file, cb) => cb(null, `${randomToken(16)}${path.extname(file.originalname).toLowerCase().slice(0, 6)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)),
});

export const kycRouter = Router();
kycRouter.use(requireAuth);
kycRouter.get(
  '/',
  ah(async (req, res) => {
    const u = await User.findById(uid(req), { kycStatus: 1, kycNote: 1 }).lean();
    const docs = await KycDocument.find({ userId: uid(req) }).sort({ createdAt: -1 }).lean();
    res.json({ status: u?.kycStatus, note: u?.kycNote ?? null, documents: docs.map((d) => ({ id: String(d._id), docType: d.docType, originalName: d.originalName, createdAt: d.createdAt })) });
  }),
);
kycRouter.post(
  '/',
  upload.single('file'),
  ah(async (req, res) => {
    const b = parse(z.object({ docType: z.enum(['id_front', 'id_back', 'selfie', 'proof_of_address']) }), req.body);
    if (!req.file) throw badRequest('Upload a JPG, PNG, WEBP or PDF file up to 8 MB');
    await KycDocument.create({ userId: uid(req), docType: b.docType, path: req.file.filename, originalName: req.file.originalname.slice(0, 100), mime: req.file.mimetype, size: req.file.size });
    const types = new Set((await KycDocument.find({ userId: uid(req) }, { docType: 1 }).lean()).map((d) => d.docType));
    const u = await User.findById(uid(req));
    if (u && types.has('id_front') && types.has('selfie') && (u.kycStatus === 'none' || u.kycStatus === 'rejected')) {
      u.kycStatus = 'pending';
      u.kycNote = undefined;
      await u.save();
      toAdmins('admin:kyc', { userId: uid(req) });
    }
    res.status(201).json({ ok: true, status: u?.kycStatus });
  }),
);

// ---------------- Support chat ----------------
export const publicChat = (m: ChatT) => ({ id: String(m._id), from: m.from, text: m.text, createdAt: (m as unknown as { createdAt: Date }).createdAt, read: m.from === 'support' ? m.readByUser : m.readBySupport });

export const chatRouter = Router();
chatRouter.use(requireAuth);
chatRouter.get(
  '/',
  ah(async (req, res) => {
    const rows = await ChatMessage.find({ conversationUserId: uid(req) }).sort({ createdAt: -1 }).limit(100).lean<ChatT[]>();
    res.json(rows.reverse().map(publicChat));
  }),
);
chatRouter.get(
  '/unread',
  ah(async (req, res) => res.json({ count: await ChatMessage.countDocuments({ conversationUserId: uid(req), from: 'support', readByUser: false }) })),
);
chatRouter.post(
  '/',
  ah(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
    const m = await ChatMessage.create({ conversationUserId: uid(req), from: 'user', authorId: uid(req), text: b.text });
    const out = publicChat(m.toObject() as ChatT);
    toUser(uid(req), 'chat:message', out);
    toAdmins('admin:chat', { userId: uid(req), message: out });
    res.status(201).json(out);
  }),
);
chatRouter.post(
  '/read',
  ah(async (req, res) => {
    await ChatMessage.updateMany({ conversationUserId: uid(req), from: 'support', readByUser: false }, { $set: { readByUser: true } });
    res.json({ ok: true });
  }),
);

// ---------------- Tournaments ----------------
export const tournamentRouter = Router();
tournamentRouter.use(requireAuth);
tournamentRouter.get(
  '/',
  ah(async (req, res) => {
    const list = await Tournament.find({ endsAt: { $gte: new Date(Date.now() - 14 * 86_400_000) } }).sort({ startsAt: 1 }).lean<TournamentT[]>();
    const mine = await Account.find({ userId: uid(req), type: 'tournament' }, { tournamentId: 1, _id: 1 }).lean();
    const joined = new Map(mine.map((a) => [String(a.tournamentId), String(a._id)]));
    const participants = await Account.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { type: 'tournament', tournamentId: { $in: list.map((t) => t._id) } } },
      { $group: { _id: '$tournamentId', n: { $sum: 1 } } },
    ]);
    const pMap = new Map(participants.map((p) => [String(p._id), p.n]));
    res.json(list.map((t) => publicTournament(t, { joined: joined.has(String(t._id)), accountId: joined.get(String(t._id)) ?? null, participants: pMap.get(String(t._id)) ?? 0 })));
  }),
);
tournamentRouter.get(
  '/:id',
  ah(async (req, res) => {
    const t = await Tournament.findById(param(req, 'id')).lean<TournamentT>();
    if (!t) throw notFound('Tournament not found');
    const board = await leaderboard(String(t._id), 100);
    const me = board.find((b) => b.userId === uid(req));
    res.json({ ...publicTournament(t), leaderboard: board.map(({ userId, ...r }) => ({ ...r, me: userId === uid(req) })), myRank: me?.rank ?? null });
  }),
);
tournamentRouter.post(
  '/:id/join',
  ah(async (req, res) => {
    const accountId = await joinTournament(uid(req), param(req, 'id'));
    res.status(201).json({ accountId: String(accountId) });
  }),
);

// ---------------- Signals ----------------
export const signalsRouter = Router();
signalsRouter.use(requireAuth);
signalsRouter.get(
  '/',
  ah(async (req, res) => {
    const symbol = req.query['symbol'] ? String(req.query['symbol']) : undefined;
    const rows = await Signal.find(symbol ? { symbol } : {}).sort({ createdAt: -1 }).limit(60).lean<SignalT[]>();
    res.json(rows.map(publicSignal));
  }),
);
signalsRouter.get('/stats', ah(async (_req, res) => res.json(await signalStats(7))));

// ---------------- Social trading ----------------
export const socialRouter = Router();
socialRouter.use(requireAuth);
socialRouter.get('/traders', ah(async (_req, res) => res.json((await traderStats(30)).slice(0, 100))));
socialRouter.get(
  '/traders/:username',
  ah(async (req, res) => {
    const u = await User.findOne({ username: param(req, 'username').toLowerCase(), isPublic: true }, { _id: 1 }).lean();
    if (!u) throw notFound('Trader not found or profile is private');
    const [stats] = await traderStats(30, [String(u._id)]);
    const recent = await Trade.find({ userId: u._id, status: { $ne: 'open' }, accountType: { $ne: 'tournament' } }).sort({ openedAt: -1 }).limit(20).lean<TradeT[]>();
    const following = await Follow.findOne({ followerId: uid(req), leaderId: u._id, active: true }).lean();
    res.json({ ...stats, recent: recent.map((t) => ({ ...publicTrade(t), accountId: undefined })), following: following ? { amount: following.amount, accountId: String(following.accountId) } : null });
  }),
);
socialRouter.get(
  '/following',
  ah(async (req, res) => {
    const list = await Follow.find({ followerId: uid(req), active: true }).lean();
    const leaders = await User.find({ _id: { $in: list.map((f) => f.leaderId) } }, { username: 1 }).lean();
    const lMap = new Map(leaders.map((l) => [String(l._id), l.username]));
    res.json(list.map((f) => ({ leaderId: String(f.leaderId), username: lMap.get(String(f.leaderId)), amount: f.amount, accountId: String(f.accountId), copiedCount: f.copiedCount })));
  }),
);
socialRouter.post(
  '/follow',
  ah(async (req, res) => {
    const b = parse(z.object({ leaderId: objectId, accountId: objectId, amount: z.number().int().min(100).max(100_000) }), req.body);
    if (b.leaderId === uid(req)) throw badRequest('You cannot copy yourself');
    const leader = await User.findOne({ _id: b.leaderId, isPublic: true }).lean();
    if (!leader) throw notFound('Trader not found or profile is private');
    const acc = await Account.findOne({ _id: b.accountId, userId: uid(req), type: { $in: ['demo', 'real'] } }).lean<AccountT>();
    if (!acc) throw notFound('Account not found');
    await Follow.updateOne({ followerId: uid(req), leaderId: b.leaderId }, { $set: { accountId: acc._id, amount: b.amount, active: true } }, { upsert: true });
    res.json({ ok: true });
  }),
);
socialRouter.delete(
  '/follow/:leaderId',
  ah(async (req, res) => {
    await Follow.updateOne({ followerId: uid(req), leaderId: param(req, 'leaderId') }, { $set: { active: false } });
    res.json({ ok: true });
  }),
);
