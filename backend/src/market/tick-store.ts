import { Types } from 'mongoose';
import { Tick } from '../models/market';
import { createLogger } from '../lib/logger';

const log = createLogger('ticks');

export interface StoredTick {
  id: Types.ObjectId;
  symbol: string;
  price: number;
  ts: number; // ms epoch, strictly increasing per symbol
  vol: number;
}

const MEMORY_MS = 20 * 60_000;

/**
 * In-memory ring buffer of recent ticks per symbol + batched persistence to the time-series collection.
 * Tick ids are assigned here, before the DB write, so trades can reference the exact tick they used.
 */
class TickStore {
  private buffers = new Map<string, StoredTick[]>();
  private queue: StoredTick[] = [];
  private flushing = false;
  private timer: NodeJS.Timeout | null = null;

  add(symbol: string, price: number, ts: number, vol = 0, persist = true): StoredTick {
    let buf = this.buffers.get(symbol);
    if (!buf) this.buffers.set(symbol, (buf = []));
    const last = buf[buf.length - 1];
    if (last && ts <= last.ts) ts = last.ts + 1;
    const t: StoredTick = { id: new Types.ObjectId(), symbol, price, ts, vol };
    buf.push(t);
    // trim old ticks (amortised: only when clearly over)
    if (buf.length > 64 && buf[0]!.ts < ts - MEMORY_MS - 60_000) {
      const cut = lowerBound(buf, ts - MEMORY_MS);
      buf.splice(0, cut);
    }
    if (persist) this.queue.push(t);
    return t;
  }

  /** Loads already-persisted ticks into memory (startup warm-up). */
  preload(symbol: string, ticks: StoredTick[]) {
    const buf = this.buffers.get(symbol) ?? [];
    this.buffers.set(symbol, [...ticks, ...buf].sort((a, b) => a.ts - b.ts));
  }

  latest(symbol: string): StoredTick | undefined {
    const b = this.buffers.get(symbol);
    return b?.[b.length - 1];
  }

  memoryStart(symbol: string): number | undefined {
    return this.buffers.get(symbol)?.[0]?.ts;
  }

  /** Last tick with ts <= at, from memory if covered, otherwise from the database. */
  async atOrBefore(symbol: string, at: number): Promise<StoredTick | undefined> {
    const b = this.buffers.get(symbol);
    if (b?.length && b[0]!.ts <= at) {
      const i = upperBound(b, at) - 1;
      if (i >= 0) return b[i];
    }
    const doc = await Tick.findOne({ symbol, ts: { $lte: new Date(at) } })
      .sort({ ts: -1 })
      .lean();
    return doc ? { id: doc._id, symbol, price: doc.price, ts: doc.ts.getTime(), vol: doc.vol ?? 0 } : undefined;
  }

  range(symbol: string, from: number, to: number): StoredTick[] {
    const b = this.buffers.get(symbol);
    if (!b?.length) return [];
    return b.slice(lowerBound(b, from), upperBound(b, to));
  }

  async rangeDb(symbol: string, from: number, to: number, limit = 20_000): Promise<StoredTick[]> {
    const docs = await Tick.find({ symbol, ts: { $gte: new Date(from), $lte: new Date(to) } })
      .sort({ ts: 1 })
      .limit(limit)
      .lean();
    return docs.map((d) => ({ id: d._id, symbol, price: d.price, ts: d.ts.getTime(), vol: d.vol ?? 0 }));
  }

  /** Memory first; falls back to DB for anything older than the buffer. */
  async rangeAny(symbol: string, from: number, to: number): Promise<StoredTick[]> {
    const start = this.memoryStart(symbol);
    if (start !== undefined && start <= from) return this.range(symbol, from, to);
    const older = await this.rangeDb(symbol, from, Math.min(to, (start ?? to + 1) - 1));
    return start !== undefined ? [...older, ...this.range(symbol, start, to)] : older;
  }

  startFlusher(intervalMs = 1000) {
    this.timer = setInterval(() => void this.flush(), intervalMs);
  }

  async flush() {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 5000);
    try {
      await Tick.insertMany(
        batch.map((t) => ({ _id: t.id, ts: new Date(t.ts), symbol: t.symbol, price: t.price, vol: t.vol })),
        { ordered: false, lean: true },
      );
    } catch (e) {
      log.error(`failed to persist ${batch.length} ticks, re-queueing`, (e as Error).message);
      this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    while (this.queue.length) await this.flush();
  }
}

function lowerBound(a: StoredTick[], ts: number) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m]!.ts < ts) lo = m + 1;
    else hi = m;
  }
  return lo;
}
function upperBound(a: StoredTick[], ts: number) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m]!.ts <= ts) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export const tickStore = new TickStore();
