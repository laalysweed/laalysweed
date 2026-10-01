import { Router } from 'express';
import { z } from 'zod';
import { ah, parse } from '../lib/http';
import { marketHub } from '../market/market-hub';
import { TIMEFRAMES } from '../market/candles';
import { AssetT } from '../models/market';
import { notFound } from '../lib/errors';
import { sentimentPct } from '../trading/trade.service';
import { sentimentCache } from '../trading/sentiment';

export const publicAsset = (a: AssetT) => {
  const t = marketHub.latest(a.symbol);
  return {
    symbol: a.symbol,
    name: a.name,
    category: a.category,
    source: a.source,
    icon: a.icon,
    precision: a.precision,
    payout: a.payout,
    minTrade: a.minTradeCents,
    maxTrade: a.maxTradeCents,
    cfd: a.cfd?.enabled ? { spread: a.cfd.spread, leverage: a.cfd.leverage, contractSize: a.cfd.contractSize } : null,
    price: t?.price ?? null,
    fresh: marketHub.isFresh(a.symbol),
  };
};

export const marketRouter = Router();

marketRouter.get(
  '/assets',
  ah(async (_req, res) => {
    const summary = new Map(marketHub.summary().map((s) => [s.symbol, s]));
    res.json(
      marketHub
        .listAssets()
        .filter((a) => a.enabled)
        .map((a) => ({ ...publicAsset(a), changePct: summary.get(a.symbol)?.changePct ?? 0 })),
    );
  }),
);

marketRouter.get('/summary', (_req, res) => {
  res.json(marketHub.summary());
});

marketRouter.get(
  '/candles',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        symbol: z.string().max(20),
        tf: z.coerce.number().refine((n) => (TIMEFRAMES as readonly number[]).includes(n), 'Unsupported timeframe'),
        limit: z.coerce.number().int().min(10).max(1500).default(300),
      }),
      req.query,
    );
    if (!marketHub.getAsset(q.symbol)) throw notFound('Unknown symbol');
    res.json(await marketHub.candles(q.symbol, q.tf, q.limit));
  }),
);

marketRouter.get('/sentiment', (req, res) => {
  const symbol = String(req.query['symbol'] ?? '');
  res.json({ symbol, ...sentimentPct(sentimentCache.get(symbol)) });
});
