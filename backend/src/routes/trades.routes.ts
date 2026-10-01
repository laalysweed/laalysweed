import { Router } from 'express';
import { z } from 'zod';
import { FilterQuery } from 'mongoose';
import { ah, objectId, parse, param } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { tradeLimiter } from '../middleware/rate-limit';
import { Trade, TradeT, publicTrade, PendingOrder, PendingT } from '../models/trade';
import { Account } from '../models/account';
import { openTrade, MAX_DURATION, MIN_DURATION } from '../trading/trade.service';
import { tickStore } from '../market/tick-store';
import { badRequest, notFound } from '../lib/errors';
import { publicPending, reloadPending } from '../trading/pending.service';
import { toUser } from '../realtime/io';

export const tradesRouter = Router();
tradesRouter.use(requireAuth);

const openSchema = z.object({
  symbol: z.string().max(20),
  direction: z.enum(['up', 'down']),
  amount: z.number().int().positive(),
  durationSec: z.number().int().min(MIN_DURATION).max(MAX_DURATION),
  idempotencyKey: z.string().min(8).max(64),
  accountId: objectId.optional(),
  source: z.enum(['manual', 'ai']).default('manual'),
  // Any client price is accepted for backwards compatibility but deliberately ignored.
  price: z.number().optional(),
});

tradesRouter.post(
  '/',
  tradeLimiter,
  ah(async (req, res) => {
    const b = parse(openSchema, req.body);
    const { trade, created } = await openTrade({ ...b, userId: uid(req) });
    res.status(created ? 201 : 200).json(publicTrade(trade));
  }),
);

tradesRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(['open', 'closed']).default('open'),
        accountId: objectId.optional(),
        before: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        symbol: z.string().optional(),
      }),
      req.query,
    );
    const filter: FilterQuery<TradeT> = { userId: uid(req), status: q.status === 'open' ? 'open' : { $ne: 'open' } };
    if (q.accountId) filter.accountId = q.accountId;
    if (q.symbol) filter.symbol = q.symbol;
    if (q.before) filter.openedAt = { $lt: q.before };
    const rows = await Trade.find(filter).sort({ openedAt: -1 }).limit(q.limit).lean<TradeT[]>();
    res.json(rows.map(publicTrade));
  }),
);

/** Trade detail with the recorded ticks around it, for the replay mini-chart. */
tradesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const t = await Trade.findOne({ _id: param(req, 'id'), userId: uid(req) }).lean<TradeT>();
    if (!t) throw notFound('Trade not found');
    const from = t.openedAt.getTime() - 30_000;
    const to = (t.closedAt ?? new Date()).getTime() + 5000;
    const ticks = await tickStore.rangeAny(t.symbol, from, to);
    const step = Math.max(1, Math.ceil(ticks.length / 600));
    res.json({
      trade: publicTrade(t),
      ticks: ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1).map((x) => ({ t: x.ts, p: x.price, id: String(x.id) })),
    });
  }),
);

// ---------------- Pending trades ----------------
export const pendingRouter = Router();
pendingRouter.use(requireAuth);

pendingRouter.get(
  '/',
  ah(async (req, res) => {
    const rows = await PendingOrder.find({ userId: uid(req) }).sort({ createdAt: -1 }).limit(100).lean<PendingT[]>();
    res.json(rows.map(publicPending));
  }),
);

pendingRouter.post(
  '/',
  ah(async (req, res) => {
    const b = parse(
      z.object({
        accountId: objectId,
        symbol: z.string().max(20),
        direction: z.enum(['up', 'down']),
        amount: z.number().int().positive(),
        durationSec: z.number().int().min(MIN_DURATION).max(MAX_DURATION),
        triggerType: z.enum(['price', 'time']),
        triggerPrice: z.number().positive().optional(),
        triggerCondition: z.enum(['above', 'below']).optional(),
        triggerAt: z.coerce.date().optional(),
        validHours: z.number().min(0.1).max(72).default(24),
      }),
      req.body,
    );
    if (!(await Account.exists({ _id: b.accountId, userId: uid(req) }))) throw notFound('Account not found');
    if (b.triggerType === 'price' && (!b.triggerPrice || !b.triggerCondition)) throw badRequest('Price trigger needs a price and condition');
    if (b.triggerType === 'time' && (!b.triggerAt || b.triggerAt.getTime() < Date.now())) throw badRequest('Trigger time must be in the future');
    const open = await PendingOrder.countDocuments({ userId: uid(req), status: 'waiting' });
    if (open >= 20) throw badRequest('You can have at most 20 pending trades');
    const p = await PendingOrder.create({ ...b, userId: uid(req), validUntil: new Date(Date.now() + b.validHours * 3600_000) });
    await reloadPending();
    const out = publicPending(p.toObject() as PendingT);
    toUser(uid(req), 'pending:update', out);
    res.status(201).json(out);
  }),
);

pendingRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const p = await PendingOrder.findOneAndUpdate({ _id: param(req, 'id'), userId: uid(req), status: 'waiting' }, { $set: { status: 'cancelled' } }, { new: true }).lean<PendingT>();
    if (!p) throw notFound('Pending trade not found');
    await reloadPending();
    const out = publicPending(p);
    toUser(uid(req), 'pending:update', out);
    res.json(out);
  }),
);
