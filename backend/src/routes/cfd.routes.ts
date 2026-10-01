import { Router } from 'express';
import { z } from 'zod';
import { ah, objectId, parse, param } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { tradeLimiter } from '../middleware/rate-limit';
import { CfdOrder, CfdOrderT, CfdPosition, CfdT } from '../models/trade';
import { cancelCfdOrder, closeCfd, cfdPnl, openCfd, placeCfdOrder, publicCfd, publicCfdOrder, updateCfdLevels } from '../trading/cfd.service';
import { marketHub } from '../market/market-hub';

export const cfdRouter = Router();
cfdRouter.use(requireAuth);

cfdRouter.get(
  '/positions',
  ah(async (req, res) => {
    const q = parse(z.object({ status: z.enum(['open', 'closed']).default('open'), accountId: objectId.optional() }), req.query);
    const rows = await CfdPosition.find({ userId: uid(req), status: q.status, ...(q.accountId ? { accountId: q.accountId } : {}) })
      .sort({ openedAt: -1 })
      .limit(200)
      .lean<CfdT[]>();
    res.json(rows.map(publicCfd));
  }),
);

cfdRouter.post(
  '/positions',
  tradeLimiter,
  ah(async (req, res) => {
    const b = parse(
      z.object({
        accountId: objectId,
        symbol: z.string().max(20),
        side: z.enum(['buy', 'sell']),
        lots: z.number().min(0.01).max(100),
        sl: z.number().positive().nullable().optional(),
        tp: z.number().positive().nullable().optional(),
      }),
      req.body,
    );
    const p = await openCfd(uid(req), b.accountId, { ...b, lots: Math.round(b.lots * 100) / 100 });
    res.status(201).json(publicCfd(p));
  }),
);

cfdRouter.post(
  '/positions/:id/close',
  ah(async (req, res) => {
    const p = await closeCfd(param(req, 'id'), 'manual', uid(req));
    res.json(p ? publicCfd(p) : null);
  }),
);

cfdRouter.patch(
  '/positions/:id',
  ah(async (req, res) => {
    const b = parse(z.object({ sl: z.number().positive().nullable(), tp: z.number().positive().nullable() }), req.body);
    res.json(publicCfd(await updateCfdLevels(uid(req), param(req, 'id'), b.sl, b.tp)));
  }),
);

cfdRouter.post(
  '/close-all',
  ah(async (req, res) => {
    const b = parse(z.object({ accountId: objectId, filter: z.enum(['all', 'winning', 'losing']) }), req.body);
    const open = await CfdPosition.find({ userId: uid(req), accountId: b.accountId, status: 'open' }).lean<CfdT[]>();
    const targets = open.filter((p) => {
      if (b.filter === 'all') return true;
      const t = marketHub.latest(p.symbol);
      if (!t) return false;
      const { pnl } = cfdPnl(p, t.price);
      return b.filter === 'winning' ? pnl > 0 : pnl < 0;
    });
    let closed = 0;
    for (const p of targets) {
      const r = await closeCfd(String(p._id), 'close_all', uid(req)).catch(() => null);
      if (r) closed++;
    }
    res.json({ closed });
  }),
);

cfdRouter.get(
  '/orders',
  ah(async (req, res) => {
    const q = parse(z.object({ accountId: objectId.optional() }), req.query);
    const rows = await CfdOrder.find({ userId: uid(req), status: 'waiting', ...(q.accountId ? { accountId: q.accountId } : {}) })
      .sort({ createdAt: -1 })
      .lean<CfdOrderT[]>();
    res.json(rows.map(publicCfdOrder));
  }),
);

cfdRouter.post(
  '/orders',
  ah(async (req, res) => {
    const b = parse(
      z.object({
        accountId: objectId,
        symbol: z.string().max(20),
        side: z.enum(['buy', 'sell']),
        lots: z.number().min(0.01).max(100),
        limitPrice: z.number().positive(),
        sl: z.number().positive().nullable().optional(),
        tp: z.number().positive().nullable().optional(),
      }),
      req.body,
    );
    res.status(201).json(publicCfdOrder(await placeCfdOrder(uid(req), b.accountId, { ...b, lots: Math.round(b.lots * 100) / 100 })));
  }),
);

cfdRouter.delete('/orders/:id', ah(async (req, res) => res.json(publicCfdOrder(await cancelCfdOrder(uid(req), param(req, 'id'))))));
