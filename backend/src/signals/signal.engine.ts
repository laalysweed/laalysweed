import { Signal, SignalT } from '../models/misc';
import { marketHub } from '../market/market-hub';
import { tickStore } from '../market/tick-store';
import { toRoom } from '../realtime/io';
import { createLogger } from '../lib/logger';

const log = createLogger('signals');
const HORIZON_SEC = 300;

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1]! * (1 - k)));
  return out;
}

export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export const publicSignal = (s: SignalT) => ({
  id: String(s._id),
  symbol: s.symbol,
  direction: s.direction,
  timeframeSec: s.timeframeSec,
  confidence: s.confidence,
  price: s.price,
  reason: s.reason ?? '',
  expiresAt: s.expiresAt,
  result: s.result,
  closePrice: s.closePrice ?? null,
  createdAt: (s as unknown as { createdAt: Date }).createdAt,
});

/** Technical-analysis signals (EMA 9/21 crossover + RSI extremes) on 1-minute candles. Informational only. */
async function scan() {
  const active = new Set((await Signal.find({ result: 'pending' }, { symbol: 1 }).lean()).map((s) => s.symbol));
  for (const a of marketHub.listAssets()) {
    if (!a.enabled || active.has(a.symbol) || !marketHub.isFresh(a.symbol)) continue;
    const candles = await marketHub.candles(a.symbol, 60, 60);
    if (candles.length < 30) continue;
    const closes = candles.map((c) => c.close);
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    const n = closes.length - 1;
    const r = rsi(closes);
    const price = closes[n]!;
    let direction: 'up' | 'down' | null = null;
    let reason = '';
    if (e9[n - 1]! <= e21[n - 1]! && e9[n]! > e21[n]!) {
      direction = 'up';
      reason = `EMA(9) crossed above EMA(21) on M1, RSI ${r.toFixed(0)}`;
    } else if (e9[n - 1]! >= e21[n - 1]! && e9[n]! < e21[n]!) {
      direction = 'down';
      reason = `EMA(9) crossed below EMA(21) on M1, RSI ${r.toFixed(0)}`;
    } else if (r < 25) {
      direction = 'up';
      reason = `RSI(14) oversold at ${r.toFixed(0)} on M1`;
    } else if (r > 75) {
      direction = 'down';
      reason = `RSI(14) overbought at ${r.toFixed(0)} on M1`;
    }
    if (!direction) continue;
    const trendAgree = direction === 'up' ? r > 50 && r < 70 : r < 50 && r > 30;
    const confidence = Math.min(82, Math.round(55 + (trendAgree ? 12 : 0) + Math.min(15, (Math.abs(e9[n]! - e21[n]!) / price) * 20000)));
    const s = await Signal.create({ symbol: a.symbol, direction, timeframeSec: HORIZON_SEC, confidence, price, reason, expiresAt: new Date(Date.now() + HORIZON_SEC * 1000) });
    toRoom('signals', 'signal:new', publicSignal(s.toObject()));
  }
}

async function evaluate() {
  const due = await Signal.find({ result: 'pending', expiresAt: { $lte: new Date() } }).limit(100).lean<SignalT[]>();
  for (const s of due) {
    const t = await tickStore.atOrBefore(s.symbol, s.expiresAt.getTime());
    if (!t) continue;
    const result = t.price === s.price ? 'flat' : (s.direction === 'up') === t.price > s.price ? 'hit' : 'miss';
    const upd = await Signal.findOneAndUpdate({ _id: s._id, result: 'pending' }, { $set: { result, closePrice: t.price } }, { new: true }).lean<SignalT>();
    if (upd) toRoom('signals', 'signal:update', publicSignal(upd));
  }
}

/** Honest track record: accuracy of all evaluated signals in the window. */
export async function signalStats(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await Signal.aggregate<{ _id: string; n: number }>([
    { $match: { createdAt: { $gte: since }, result: { $ne: 'pending' } } },
    { $group: { _id: '$result', n: { $sum: 1 } } },
  ]);
  const m = Object.fromEntries(rows.map((r) => [r._id, r.n])) as Record<string, number>;
  const decided = (m['hit'] ?? 0) + (m['miss'] ?? 0);
  return { days, hit: m['hit'] ?? 0, miss: m['miss'] ?? 0, flat: m['flat'] ?? 0, accuracy: decided ? Math.round(((m['hit'] ?? 0) / decided) * 1000) / 10 : null };
}

export function startSignalEngine() {
  setInterval(() => void scan().catch((e) => log.error('scan failed', e)), 20_000);
  setInterval(() => void evaluate().catch((e) => log.error('evaluate failed', e)), 5000);
}
