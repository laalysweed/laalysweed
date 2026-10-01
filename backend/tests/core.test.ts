import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OtcGenerator } from '../src/market/otc-generator';
import { bucketTicks, mergeCandles } from '../src/market/candles';
import { decideOutcome, sentimentPct } from '../src/trading/trade.service';
import { bidAsk, cfdPnl } from '../src/trading/cfd.service';
import { offerTerms, tradersBoxTerms } from '../src/bonus/bonus.service';
import { DEFAULT_BONUS_CONFIG, bonusConfigSchema } from '../src/services/settings.service';
import { normalizeKePhone } from '../src/finance/mpesa';
import { pctOf, usdToKes } from '../src/lib/money';
import { Types } from 'mongoose';

describe('OTC generator isolation', () => {
  it('imports nothing from the application (cannot see trades, users or balances)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/market/otc-generator.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['node:crypto', 'node:events']);
    expect(src).not.toMatch(/require\(/);
  });

  it('produces positive, mean-reverting prices at the configured precision', () => {
    const g = new OtcGenerator('test-seed');
    g.upsert({ symbol: 'X', basePrice: 100, volatility: 0.001, meanReversion: 0.002, precision: 3 });
    const ticks = g.backfill('X', 0, 6 * 3600_000, 1000);
    expect(ticks.length).toBe(6 * 3600 + 1);
    for (const t of ticks) {
      expect(t.price).toBeGreaterThan(0);
      expect(Math.round(t.price * 1000) / 1000).toBe(t.price);
    }
    const last = ticks[ticks.length - 1]!.price;
    expect(last).toBeGreaterThan(50);
    expect(last).toBeLessThan(200);
  });

  it('continues from a given start price after restart', () => {
    const g = new OtcGenerator('seed');
    g.upsert({ symbol: 'Y', basePrice: 1.1, volatility: 0.00007, meanReversion: 0.0004, precision: 5 }, 1.2345);
    const [first] = g.backfill('Y', 0, 0, 1000);
    expect(Math.abs(first!.price - 1.2345)).toBeLessThan(0.01);
  });
});

describe('fixed-time trade outcome', () => {
  it('decides win / loss / draw', () => {
    expect(decideOutcome('up', 100, 101)).toBe('won');
    expect(decideOutcome('up', 100, 99)).toBe('lost');
    expect(decideOutcome('down', 100, 99)).toBe('won');
    expect(decideOutcome('down', 100, 101)).toBe('lost');
    expect(decideOutcome('up', 100, 100)).toBe('draw');
    expect(decideOutcome('down', 100, 100)).toBe('draw');
  });

  it('computes crowd sentiment percentages', () => {
    expect(sentimentPct(undefined)).toEqual({ up: 50, down: 50 });
    expect(sentimentPct({ up: 300, down: 100 })).toEqual({ up: 75, down: 25 });
  });
});

describe('CFD maths', () => {
  const pos = { side: 'buy' as const, openPrice: 100, lots: 1, contractSize: 10, spread: 0.2 };
  it('buys at ask and closes at bid', () => {
    expect(bidAsk(100, 0.2)).toEqual({ bid: 99.9, ask: 100.1 });
    // exit at bid 100.9 → +0.9 * 10 = $9.00
    expect(cfdPnl(pos, 101).pnl).toBe(900);
  });
  it('sell profits when price falls', () => {
    const r = cfdPnl({ ...pos, side: 'sell' }, 99);
    // exit at ask 99.1 → (100 - 99.1) * 10 = $9.00
    expect(r.pnl).toBe(900);
  });
});

describe('bonus terms', () => {
  it('default config is valid', () => {
    expect(bonusConfigSchema.safeParse(DEFAULT_BONUS_CONFIG).success).toBe(true);
  });
  it('terms state turnover, cap and cancellation rights', () => {
    const t = offerTerms('first50', DEFAULT_BONUS_CONFIG);
    const text = t.terms.join(' ');
    expect(text).toContain('20×');
    expect(text).toContain('$500.00');
    expect(text).toMatch(/cancel the bonus at any time/i);
  });
  it("Trader's Box odds sum to 100%", () => {
    const b = tradersBoxTerms(DEFAULT_BONUS_CONFIG);
    const sum = b.odds.reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(b.expectedValue).toBe(445);
  });
});

describe('candles', () => {
  it('buckets ticks into OHLC', () => {
    const t = (ts: number, price: number) => ({ id: new Types.ObjectId(), symbol: 'X', ts, price, vol: 1 });
    const c = bucketTicks([t(0, 10), t(2000, 12), t(4000, 9), t(5000, 11)], 5);
    expect(c).toEqual([
      { time: 0, open: 10, high: 12, low: 9, close: 9, volume: 3 },
      { time: 5, open: 11, high: 11, low: 11, close: 11, volume: 1 },
    ]);
    expect(mergeCandles(c, [{ ...c[1]!, close: 20 }])[1]!.close).toBe(20);
  });
});

describe('helpers', () => {
  it('normalises Kenyan phone numbers', () => {
    expect(normalizeKePhone('0712 345 678')).toBe('254712345678');
    expect(normalizeKePhone('+254110000000')).toBe('254110000000');
    expect(normalizeKePhone('712345678')).toBe('254712345678');
    expect(normalizeKePhone('12345')).toBeNull();
  });
  it('money helpers never over-pay', () => {
    expect(pctOf(999, 79)).toBe(789);
    expect(usdToKes(1000, 129)).toBe(1290);
  });
});
