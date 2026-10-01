import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createLogger } from '../lib/logger';

const log = createLogger('binance');

export interface FeedSymbol {
  symbol: string; // internal symbol
  binanceSymbol: string;
}

/**
 * Streams aggregated trades from Binance and samples them to at most one tick per `sampleMs`
 * per symbol (the sampled price is what gets stored and used for trade settlement).
 */
export class BinanceFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { price: number; vol: number }>();
  private sampler: NodeJS.Timeout | null = null;
  private retry = 0;
  private stopped = false;
  private byBinance = new Map<string, string>();

  constructor(
    private readonly url: string,
    private symbols: FeedSymbol[],
    private readonly sampleMs = 250,
  ) {
    super();
  }

  start() {
    this.stopped = false;
    this.sampler = setInterval(() => this.flush(), this.sampleMs);
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.sampler) clearInterval(this.sampler);
    this.ws?.terminate();
  }

  setSymbols(list: FeedSymbol[]) {
    this.symbols = list;
    this.ws?.terminate(); // reconnect picks up the new list
  }

  private connect() {
    if (this.stopped || !this.symbols.length) return;
    this.byBinance = new Map(this.symbols.map((s) => [s.binanceSymbol.toUpperCase(), s.symbol]));
    const streams = this.symbols.map((s) => `${s.binanceSymbol.toLowerCase()}@aggTrade`).join('/');
    const ws = new WebSocket(`${this.url}?streams=${streams}`);
    this.ws = ws;
    ws.on('open', () => {
      this.retry = 0;
      log.info(`connected (${this.symbols.length} symbols)`);
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { data?: { s: string; p: string; q: string } };
        const d = msg.data;
        if (!d) return;
        const symbol = this.byBinance.get(d.s);
        if (!symbol) return;
        const prev = this.pending.get(symbol);
        this.pending.set(symbol, { price: Number(d.p), vol: (prev?.vol ?? 0) + Number(d.q) });
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('close', () => this.scheduleReconnect());
    ws.on('error', (e) => log.warn(`socket error: ${e.message}`));
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    log.warn(`disconnected, reconnecting in ${delay}ms`);
    setTimeout(() => this.connect(), delay);
  }

  private flush() {
    if (!this.pending.size) return;
    const ts = Date.now();
    for (const [symbol, p] of this.pending) this.emit('tick', { symbol, price: p.price, vol: p.vol, ts });
    this.pending.clear();
  }
}

/** Binance REST klines, used only to backfill chart history for real symbols. */
export async function fetchKlines(restUrl: string, binanceSymbol: string, interval: string, limit: number, endTime?: number) {
  const qs = new URLSearchParams({ symbol: binanceSymbol, interval, limit: String(limit) });
  if (endTime) qs.set('endTime', String(endTime));
  const res = await fetch(`${restUrl}/api/v3/klines?${qs}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const rows = (await res.json()) as [number, string, string, string, string, string][];
  return rows.map((r) => ({
    time: Math.floor(r[0] / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}
