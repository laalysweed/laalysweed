import { PendingOrder, PendingT } from '../models/trade';
import { marketHub } from '../market/market-hub';
import type { StoredTick } from '../market/tick-store';
import { openTrade } from './trade.service';
import { toUser } from '../realtime/io';
import { createLogger } from '../lib/logger';

const log = createLogger('pending');
let waiting: PendingT[] = [];
const inFlight = new Set<string>();

export const publicPending = (p: PendingT) => ({
  id: String(p._id),
  accountId: String(p.accountId),
  symbol: p.symbol,
  direction: p.direction,
  amount: p.amount,
  durationSec: p.durationSec,
  triggerType: p.triggerType,
  triggerPrice: p.triggerPrice ?? null,
  triggerCondition: p.triggerCondition ?? null,
  triggerAt: p.triggerAt ?? null,
  validUntil: p.validUntil,
  status: p.status,
  tradeId: p.tradeId ? String(p.tradeId) : null,
  failReason: p.failReason ?? null,
  createdAt: (p as unknown as { createdAt: Date }).createdAt,
});

export async function reloadPending() {
  waiting = await PendingOrder.find({ status: 'waiting' }).lean<PendingT[]>();
}

async function trigger(p: PendingT) {
  const id = String(p._id);
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const claimed = await PendingOrder.findOneAndUpdate({ _id: p._id, status: 'waiting' }, { $set: { status: 'triggered' } }, { new: true }).lean<PendingT>();
    if (!claimed) return;
    try {
      const { trade } = await openTrade({
        userId: String(p.userId),
        accountId: String(p.accountId),
        symbol: p.symbol,
        direction: p.direction as 'up' | 'down',
        amount: p.amount,
        durationSec: p.durationSec,
        idempotencyKey: `pending:${id}`,
        source: 'pending',
      });
      await PendingOrder.updateOne({ _id: p._id }, { $set: { tradeId: trade._id } });
    } catch (e) {
      await PendingOrder.updateOne({ _id: p._id }, { $set: { status: 'failed', failReason: (e as Error).message } });
    }
    const fresh = await PendingOrder.findById(p._id).lean<PendingT>();
    if (fresh) toUser(p.userId, 'pending:update', publicPending(fresh));
  } finally {
    waiting = waiting.filter((w) => String(w._id) !== id);
    inFlight.delete(id);
  }
}

export function startPendingWorker() {
  void reloadPending();
  marketHub.on('tick', (t: StoredTick) => {
    for (const p of waiting) {
      if (p.symbol !== t.symbol || p.triggerType !== 'price' || p.triggerPrice == null) continue;
      const hit = p.triggerCondition === 'above' ? t.price >= p.triggerPrice : t.price <= p.triggerPrice;
      if (hit) void trigger(p);
    }
  });
  setInterval(async () => {
    const now = Date.now();
    for (const p of waiting) {
      if (p.triggerType === 'time' && p.triggerAt && p.triggerAt.getTime() <= now) void trigger(p);
    }
    const expired = waiting.filter((p) => p.validUntil.getTime() < now && !inFlight.has(String(p._id)));
    for (const p of expired) {
      const r = await PendingOrder.findOneAndUpdate({ _id: p._id, status: 'waiting' }, { $set: { status: 'expired' } }, { new: true }).lean<PendingT>();
      if (r) toUser(p.userId, 'pending:update', publicPending(r));
    }
    if (expired.length) waiting = waiting.filter((p) => !expired.includes(p));
  }, 500);
  setInterval(() => void reloadPending().catch((e) => log.error('reload failed', e)), 5000);
}
