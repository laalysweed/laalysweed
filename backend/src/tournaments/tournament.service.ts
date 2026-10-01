import { Types } from 'mongoose';
import { Tournament, TournamentT } from '../models/misc';
import { Account, AccountT } from '../models/account';
import { Trade } from '../models/trade';
import { User } from '../models/user';
import { badRequest, conflict, notFound } from '../lib/errors';
import { emitAccounts, postEntry, withTxn } from '../services/ledger.service';
import { toRoom, toUser } from '../realtime/io';
import { createLogger } from '../lib/logger';

const log = createLogger('tournaments');

export const publicTournament = (t: TournamentT, extra: Record<string, unknown> = {}) => ({
  id: String(t._id),
  name: t.name,
  description: t.description,
  startsAt: t.startsAt,
  endsAt: t.endsAt,
  entryFee: t.entryFee,
  startingBalance: t.startingBalance,
  prizes: t.prizes,
  prizePool: t.prizes.reduce((s, p) => s + p, 0),
  status: t.status,
  results: t.results ?? [],
  ...extra,
});

export async function leaderboard(tournamentId: string, limit = 50) {
  const accounts = await Account.find({ type: 'tournament', tournamentId }).sort({ balance: -1 }).limit(limit).lean<AccountT[]>();
  const users = await User.find({ _id: { $in: accounts.map((a) => a.userId) } }, { username: 1, country: 1, avatarUrl: 1 }).lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  return accounts.map((a, i) => ({
    rank: i + 1,
    userId: String(a.userId),
    username: uMap.get(String(a.userId))?.username ?? 'trader',
    country: uMap.get(String(a.userId))?.country ?? '',
    balance: a.balance,
  }));
}

export async function joinTournament(userId: string, tournamentId: string) {
  const t = await Tournament.findById(tournamentId).lean<TournamentT>();
  if (!t) throw notFound('Tournament not found');
  if (t.status === 'finished' || t.endsAt.getTime() < Date.now()) throw badRequest('This tournament has ended');
  if (await Account.exists({ userId, type: 'tournament', tournamentId })) throw conflict('You already joined this tournament');
  const account = await withTxn(async (session) => {
    const accId = new Types.ObjectId();
    if (t.entryFee > 0) {
      const real = await Account.findOne({ userId, type: 'real' }).session(session).lean<AccountT>();
      if (!real) throw notFound('Real account not found');
      await postEntry(session, { accountId: real._id, type: 'tournament_fee', bucket: 'cash', amount: -t.entryFee, refKind: 'tournament', refId: t._id });
    }
    await Account.create([{ _id: accId, userId, type: 'tournament', tournamentId: t._id, balance: 0 }], { session });
    await postEntry(session, { accountId: accId, type: 'tournament_start', bucket: 'cash', amount: t.startingBalance, refKind: 'tournament', refId: t._id });
    return accId;
  });
  void emitAccounts(userId);
  return account;
}

async function finish(t: TournamentT) {
  const accIds = (await Account.find({ type: 'tournament', tournamentId: t._id }, { _id: 1 }).lean()).map((a) => a._id);
  if (await Trade.exists({ accountId: { $in: accIds }, status: 'open' })) return; // wait for last trades to settle
  const board = await leaderboard(String(t._id), Math.max(t.prizes.length, 10));
  const results = board.map((b, i) => ({ userId: new Types.ObjectId(b.userId), username: b.username, rank: b.rank, balance: b.balance, prize: t.prizes[i] ?? 0 }));
  const done = await withTxn(async (session) => {
    const claimed = await Tournament.findOneAndUpdate({ _id: t._id, paidOut: false }, { $set: { status: 'finished', paidOut: true, results } }, { new: true, session });
    if (!claimed) return false;
    for (const r of results) {
      if (r.prize <= 0) continue;
      const real = await Account.findOne({ userId: r.userId, type: 'real' }).session(session).lean<AccountT>();
      if (real) await postEntry(session, { accountId: real._id, type: 'tournament_prize', bucket: 'cash', amount: r.prize, refKind: 'tournament', refId: t._id, note: `Rank #${r.rank}` });
    }
    return true;
  });
  if (!done) return;
  for (const r of results) {
    if (r.prize > 0) {
      void emitAccounts(r.userId);
      toUser(r.userId, 'toast', { kind: 'success', text: `🏆 You placed #${r.rank} in ${t.name} and won $${(r.prize / 100).toFixed(2)}!` });
    }
  }
  toRoom('tournaments', 'tournament:update', { id: String(t._id), status: 'finished' });
  log.info(`finished "${t.name}", paid ${results.filter((r) => r.prize > 0).length} prizes`);
}

export function startTournamentWorker() {
  setInterval(async () => {
    try {
      const now = new Date();
      const started = await Tournament.updateMany({ status: 'upcoming', startsAt: { $lte: now } }, { $set: { status: 'running' } });
      if (started.modifiedCount) toRoom('tournaments', 'tournament:update', { status: 'running' });
      const ending = await Tournament.find({ status: 'running', endsAt: { $lte: now }, paidOut: false }).lean<TournamentT[]>();
      for (const t of ending) await finish(t);
    } catch (e) {
      log.error('worker error', e);
    }
  }, 5000);
}
