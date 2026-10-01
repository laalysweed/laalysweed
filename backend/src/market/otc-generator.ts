/**
 * OTC PRICE GENERATOR (ISOLATED MODULE)
 * -------------------------------------
 * Produces prices for OTC instruments from a secret-seeded, mean-reverting random walk.
 *
 * Fairness guarantee: this module imports NOTHING from the application (no models, no services).
 * It cannot see trades, users, positions or balances, so prices cannot be steered against clients.
 * `tests/otc-isolation.test.ts` fails the build if an application import is ever added here.
 * Every generated tick is persisted by the market hub for audit and trade replay.
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

export interface OtcAssetConfig {
  symbol: string;
  basePrice: number;
  volatility: number; // relative sigma per sqrt(second)
  meanReversion: number; // per second
  precision: number;
}

export interface GeneratedTick {
  symbol: string;
  price: number;
  ts: number;
}

/** xoshiro128** PRNG: fast, deterministic for a given 128-bit seed. */
class Xoshiro128 {
  private s: Uint32Array;
  constructor(seed: Buffer) {
    this.s = new Uint32Array([seed.readUInt32LE(0), seed.readUInt32LE(4), seed.readUInt32LE(8), seed.readUInt32LE(12)]);
    if (this.s.every((v) => v === 0)) this.s[0] = 1;
  }
  next(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1]!, 5), 7), 9) >>> 0;
    const t = s[1]! << 9;
    s[2]! ^= s[0]!;
    s[3]! ^= s[1]!;
    s[1]! ^= s[2]!;
    s[0]! ^= s[3]!;
    s[2]! ^= t;
    s[3] = rotl(s[3]!, 11);
    return result / 4294967296;
  }
}
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

interface State {
  cfg: OtcAssetConfig;
  logPrice: number;
  drift: number; // current micro-trend (per second, log space)
  driftTtl: number; // seconds until regime change
  rng: Xoshiro128;
  spare: number | null;
}

export class OtcGenerator extends EventEmitter {
  private states = new Map<string, State>();
  private timer: NodeJS.Timeout | null = null;
  private lastStep = 0;

  constructor(
    private readonly seed: string,
    private readonly intervalMs = 500,
  ) {
    super();
  }

  /** Add or update an instrument. `startPrice` lets prices continue from the last stored tick after a restart. */
  upsert(cfg: OtcAssetConfig, startPrice?: number) {
    const existing = this.states.get(cfg.symbol);
    if (existing) {
      existing.cfg = cfg;
      return;
    }
    const seedBuf = crypto.createHmac('sha256', this.seed).update(`${cfg.symbol}:${process.hrtime.bigint()}`).digest();
    this.states.set(cfg.symbol, {
      cfg,
      logPrice: Math.log(startPrice && startPrice > 0 ? startPrice : cfg.basePrice),
      drift: 0,
      driftTtl: 0,
      rng: new Xoshiro128(seedBuf),
      spare: null,
    });
  }

  remove(symbol: string) {
    this.states.delete(symbol);
  }

  symbols() {
    return [...this.states.keys()];
  }

  start() {
    if (this.timer) return;
    this.lastStep = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(5, (now - this.lastStep) / 1000);
      this.lastStep = now;
      for (const st of this.states.values()) {
        this.emit('tick', { symbol: st.cfg.symbol, price: this.advance(st, dt), ts: now } satisfies GeneratedTick);
      }
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Generates a historical path ending "now" for a brand-new instrument (first boot only). */
  backfill(symbol: string, fromMs: number, toMs: number, stepMs: number): GeneratedTick[] {
    const st = this.states.get(symbol);
    if (!st) return [];
    const out: GeneratedTick[] = [];
    for (let ts = fromMs; ts <= toMs; ts += stepMs) out.push({ symbol, ts, price: this.advance(st, stepMs / 1000) });
    return out;
  }

  private gaussian(st: State): number {
    if (st.spare !== null) {
      const v = st.spare;
      st.spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = st.rng.next();
    while (v === 0) v = st.rng.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    st.spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  private advance(st: State, dt: number): number {
    const { cfg } = st;
    st.driftTtl -= dt;
    if (st.driftTtl <= 0) {
      // new micro-trend regime every 15–90s
      st.driftTtl = 15 + st.rng.next() * 75;
      st.drift = (st.rng.next() * 2 - 1) * cfg.volatility * 0.12;
    }
    let z = this.gaussian(st);
    if (st.rng.next() < 0.004) z *= 2.5; // occasional fat-tail move
    const pull = -cfg.meanReversion * (st.logPrice - Math.log(cfg.basePrice));
    st.logPrice += (pull + st.drift) * dt + cfg.volatility * Math.sqrt(dt) * z;
    const f = 10 ** cfg.precision;
    return Math.round(Math.exp(st.logPrice) * f) / f;
  }
}
