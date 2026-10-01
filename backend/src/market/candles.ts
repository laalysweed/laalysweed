import { Tick } from '../models/market';
import type { StoredTick } from './tick-store';

export interface Candle {
  time: number; // seconds epoch (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Supported chart timeframes in seconds: S1 (line chart), S5..M15, plus H1 for pro mode. */
export const TIMEFRAMES = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 3600] as const;

export function bucketTicks(ticks: StoredTick[], tf: number): Candle[] {
  const out: Candle[] = [];
  const ms = tf * 1000;
  for (const t of ticks) {
    const time = Math.floor(t.ts / ms) * tf;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, t.price);
      last.low = Math.min(last.low, t.price);
      last.close = t.price;
      last.volume += t.vol;
    } else {
      out.push({ time, open: t.price, high: t.price, low: t.price, close: t.price, volume: t.vol });
    }
  }
  return out;
}

/** Aggregates stored ticks into candles inside MongoDB (used for history older than the memory buffer). */
export async function aggregateCandles(symbol: string, tf: number, from: number, to: number): Promise<Candle[]> {
  if (to <= from) return [];
  const ms = tf * 1000;
  const rows = await Tick.aggregate<{ _id: number; open: number; high: number; low: number; close: number; volume: number }>([
    { $match: { symbol, ts: { $gte: new Date(from), $lte: new Date(to) } } },
    { $sort: { ts: 1 } },
    {
      $group: {
        _id: { $subtract: [{ $toLong: '$ts' }, { $mod: [{ $toLong: '$ts' }, ms] }] },
        open: { $first: '$price' },
        high: { $max: '$price' },
        low: { $min: '$price' },
        close: { $last: '$price' },
        volume: { $sum: '$vol' },
      },
    },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);
  return rows.map((r) => ({ time: Math.floor(Number(r._id) / 1000), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
}

/** Merges candle lists; later lists win on equal timestamps. */
export function mergeCandles(...lists: Candle[][]): Candle[] {
  const map = new Map<number, Candle>();
  for (const l of lists) for (const c of l) map.set(c.time, c);
  return [...map.values()].sort((a, b) => a.time - b.time);
}
