import { Follow } from '../models/misc';
import { User } from '../models/user';
import { Trade, TradeT } from '../models/trade';
import { openTrade, setTradeOpenedHook } from '../trading/trade.service';
import { toUser } from '../realtime/io';
import { createLogger } from '../lib/logger';

const log = createLogger('copy');

/** Mirrors a public trader's new trades onto followers' chosen accounts at the follower's fixed amount. */
async function fanOut(leaderTrade: TradeT) {
  if (leaderTrade.source === 'copy' || leaderTrade.accountType === 'tournament') return;
  const leader = await User.findById(leaderTrade.userId, { isPublic: 1, username: 1 }).lean();
  if (!leader?.isPublic) return;
  const remaining = Math.floor((leaderTrade.expiresAt.getTime() - Date.now()) / 1000);
  if (remaining < 5) return;
  const follows = await Follow.find({ leaderId: leaderTrade.userId, active: true }).lean();
  for (const f of follows) {
    try {
      const { created } = await openTrade({
        userId: String(f.followerId),
        accountId: String(f.accountId),
        symbol: leaderTrade.symbol,
        direction: leaderTrade.direction as 'up' | 'down',
        amount: f.amount,
        durationSec: remaining,
        idempotencyKey: `copy:${leaderTrade._id}`,
        source: 'copy',
        copiedFrom: leaderTrade._id,
      });
      if (created) {
        await Follow.updateOne({ _id: f._id }, { $inc: { copiedCount: 1 } });
        toUser(f.followerId, 'toast', { kind: 'info', text: `Copied ${leader.username}'s ${leaderTrade.direction.toUpperCase()} trade on ${leaderTrade.symbol}` });
      }
    } catch (e) {
      toUser(f.followerId, 'toast', { kind: 'error', text: `Could not copy ${leader.username}'s trade: ${(e as Error).message}` });
    }
  }
}

export function registerCopyTrading() {
  setTradeOpenedHook((t) => void fanOut(t).catch((e) => log.error('fan-out failed', e)));
}

/** Public trader stats over the last N days (only for users with a public profile). */
export async function traderStats(days = 30, userIds?: string[]) {
  const since = new Date(Date.now() - days * 86_400_000);
  const publicUsers = await User.find({ isPublic: true, blocked: false, ...(userIds ? { _id: { $in: userIds } } : {}) }, { username: 1, fullName: 1, avatarUrl: 1, country: 1, level: 1 }).lean();
  const ids = publicUsers.map((u) => u._id);
  const rows = await Trade.aggregate<{ _id: unknown; trades: number; wins: number; profit: number; volume: number }>([
    { $match: { userId: { $in: ids }, status: { $in: ['won', 'lost', 'draw'] }, accountType: { $ne: 'tournament' }, openedAt: { $gte: since } } },
    { $group: { _id: '$userId', trades: { $sum: 1 }, wins: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } }, profit: { $sum: '$profit' }, volume: { $sum: '$amount' } } },
  ]);
  const followers = await Follow.aggregate<{ _id: unknown; n: number }>([{ $match: { leaderId: { $in: ids }, active: true } }, { $group: { _id: '$leaderId', n: { $sum: 1 } } }]);
  const fMap = new Map(followers.map((f) => [String(f._id), f.n]));
  const sMap = new Map(rows.map((r) => [String(r._id), r]));
  return publicUsers
    .map((u) => {
      const s = sMap.get(String(u._id));
      return {
        id: String(u._id),
        username: u.username,
        fullName: u.fullName,
        avatarUrl: u.avatarUrl ?? null,
        country: u.country,
        level: u.level,
        trades: s?.trades ?? 0,
        winRate: s?.trades ? Math.round((s.wins / s.trades) * 100) : 0,
        profit: s?.profit ?? 0,
        roi: s?.volume ? Math.round((s.profit / s.volume) * 1000) / 10 : 0,
        followers: fMap.get(String(u._id)) ?? 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}
