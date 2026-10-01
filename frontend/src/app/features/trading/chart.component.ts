import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LastPriceAnimationMode,
  LineSeries,
  LineStyle,
  Logical,
  MouseEventParams,
  SeriesType,
  Time,
  UTCTimestamp,
  createChart,
} from 'lightweight-charts';
import { Subscription } from 'rxjs';
import { MarketService } from '../../core/market.service';
import { ClockService } from '../../core/clock.service';
import { ChartType } from '../../core/ui.service';
import { Candle, Direction, Trade } from '../../core/models';
import { clock, money } from '../../core/format';

type Pt = { time: number; value: number };
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

interface OverlayTrade {
  id: string;
  x1: number;
  x2: number;
  y: number;
  up: boolean;
  winning: boolean;
  label: string;
  flash: 'won' | 'lost' | 'draw' | null;
}
interface Overlay {
  w: number;
  h: number;
  expiry: { x: number; label: string } | null;
  zone: { x1: number; x2: number; y: number; dir: Direction } | null;
  trades: OverlayTrade[];
  trends: { x1: number; y1: number; x2: number; y2: number }[];
  draft: { x: number; y: number } | null;
  currentPoint: { x: number; y: number; price: number } | null;
}

const COLORS = { line: '#38BDF8', up: '#22C55E', down: '#EF4444', grid: 'rgba(255,255,255,0.045)', text: '#8A93A6' };

/** SMA / EMA / Bollinger computed on closes. */
function sma(v: number[], n: number) {
  const out: (number | null)[] = [];
  let s = 0;
  v.forEach((x, i) => {
    s += x;
    if (i >= n) s -= v[i - n]!;
    out.push(i >= n - 1 ? s / n : null);
  });
  return out;
}
function ema(v: number[], n: number) {
  const k = 2 / (n + 1);
  const out: number[] = [];
  v.forEach((x, i) => out.push(i === 0 ? x : x * k + out[i - 1]! * (1 - k)));
  return out;
}
function bollinger(v: number[], n = 20, m = 2) {
  const mid = sma(v, n);
  return mid.map((mm, i) => {
    if (mm == null) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j]! - mm) ** 2;
    const sd = Math.sqrt(s / n);
    return { up: mm + m * sd, low: mm - m * sd, mid: mm };
  });
}

@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chart.component.html',
  styleUrl: './chart.component.scss',
})
export class ChartComponent {
  private market = inject(MarketService);
  private injector = inject(Injector);
  private clockSvc = inject(ClockService);

  readonly symbol = input.required<string>();
  readonly precision = input(2);
  readonly chartType = input<ChartType>('area');
  /** Candle size in seconds (candle modes). */
  readonly timeframe = input(60);
  /** Visible seconds (area mode). */
  readonly window = input(120);
  readonly indicators = input<string[]>([]);
  readonly expirySec = input(30);
  readonly showExpiry = input(true);
  readonly trades = input<Trade[]>([]);
  readonly flashing = input<Map<string, Trade>>(new Map());
  readonly hoverDirection = input<Direction | null>(null);
  readonly crosshair = input(true);
  readonly drawTool = input<'none' | 'hline' | 'trend'>('none');
  readonly clearDrawings = input(0);
  readonly offsetMin = input(180);
  readonly showVolume = input(false);
  /** CFD: draw entry lines for positions (price only). */
  readonly priceLines = input<{ id: string; price: number; color: string; title: string }[]>([]);

  readonly drawn = output<void>();
  readonly crosshairCandle = output<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    time: number;
    change: number;
    changePct: number;
  } | null>();

  private host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  protected overlay = signal<Overlay>({ w: 0, h: 0, expiry: null, zone: null, trades: [], trends: [], draft: null, currentPoint: null });
  protected loading = signal(true);
  protected lastPrice = signal<number | null>(null);
  protected Math = Math;

  private chart: IChartApi | null = null;
  private main: ISeriesApi<SeriesType> | null = null;
  private glow: ISeriesApi<'Line'> | null = null;
  private vol: ISeriesApi<'Histogram'> | null = null;
  private ind = new Map<string, ISeriesApi<'Line'>[]>();
  private hlines: IPriceLine[] = [];
  private posLines: IPriceLine[] = [];
  private trends: { t1: number; p1: number; t2: number; p2: number }[] = [];
  private draft: { t: number; p: number } | null = null;

  private area: Pt[] = [];
  private bars: Bar[] = [];
  private target: number | null = null;
  private shown: number | null = null;
  private pending: { p: number; t: number }[] = [];
  private loadedFor = '';
  private raf = 0;
  private lastFrame = 0;
  private tickSub: Subscription | null = null;
  private indTimer: ReturnType<typeof setInterval> | undefined;
  private loadSeq = 0;
  private destroyed = false;

  private isArea = computed(() => this.chartType() === 'area' || this.chartType() === 'line');
  private step = computed(() => (this.isArea() ? 1 : this.timeframe()));

  constructor() {
    const destroy = inject(DestroyRef);

    afterNextRender(() => {
      this.chart = createChart(this.host().nativeElement, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: COLORS.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, attributionLogo: false },
        grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.14 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 30, barSpacing: 6, shiftVisibleRangeOnNewBar: true },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: '#2F80ED', style: LineStyle.Dashed },
          horzLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: '#2F80ED', style: LineStyle.Dashed },
        },
        handleScale: { axisPressedMouseMove: { time: true, price: true } },
      });
      this.chart.subscribeClick((p) => this.onClick(p));
      this.chart.subscribeCrosshairMove((p) => this.onMove(p));
      this.buildSeries();
      this.loop(performance.now());
      this.indTimer = setInterval(() => this.updateIndicators(), 1000);

      // React to inputs once the chart exists.
      effect(
        () => {
          const sym = this.symbol();
          const type = this.chartType();
          const tf = this.timeframe();
          untracked(() => void this.reload(sym, type, tf));
        },
        { injector: this.injector },
      );
      effect(
        () => {
          this.window();
          this.expirySec();
          untracked(() => this.fitRange());
        },
        { injector: this.injector },
      );
      effect(
        () => {
          const on = this.crosshair();
          untracked(() => this.chart?.applyOptions({ crosshair: { mode: on ? CrosshairMode.Normal : CrosshairMode.Hidden } }));
        },
        { injector: this.injector },
      );
      effect(
        () => {
          this.indicators();
          untracked(() => this.rebuildIndicators());
        },
        { injector: this.injector },
      );
      effect(
        () => {
          const n = this.clearDrawings();
          untracked(() => n && this.clearAllDrawings());
        },
        { injector: this.injector },
      );
      effect(
        () => {
          const lines = this.priceLines();
          untracked(() => {
            for (const l of this.posLines) this.main?.removePriceLine(l);
            this.posLines = lines.map((l) => this.main!.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.title }));
          });
        },
        { injector: this.injector },
      );
      effect(
        () => {
          const p = this.precision();
          untracked(() => this.main?.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: 1 / 10 ** p } }));
        },
        { injector: this.injector },
      );
      effect(
        () => {
          this.showVolume();
          untracked(() => {
            if (!this.isArea() && this.loadedFor === this.symbol()) {
              this.buildSeries();
              void this.reload(this.symbol(), this.chartType(), this.timeframe());
            }
          });
        },
        { injector: this.injector },
      );
    });

    this.tickSub = this.market.ticks$.subscribe((t) => {
      if (t.s !== this.symbol()) return;
      if (this.loadedFor !== t.s) this.pending.push({ p: t.p, t: t.t });
      else this.onTick(t.p, t.t);
    });

    destroy.onDestroy(() => {
      this.destroyed = true;
      this.loadSeq++;
      cancelAnimationFrame(this.raf);
      clearInterval(this.indTimer);
      this.tickSub?.unsubscribe();
      this.market.unsubscribe(this.subscribed);
      this.chart?.remove();
      this.chart = null;
    });
  }

  private subscribed = '';

  // ---------------------------------------------------------------- data
  private shift = () => this.offsetMin() * 60;
  private toChartTime = (ms: number) => Math.floor(ms / 1000) + this.shift();

  private buildSeries() {
    if (!this.chart) return;
    for (const s of [this.main, this.glow, this.vol]) if (s) this.chart.removeSeries(s);
    for (const list of this.ind.values()) for (const s of list) this.chart.removeSeries(s);
    this.ind.clear();
    this.hlines = [];
    this.posLines = [];
    this.main = this.glow = this.vol = null;
    const pf = { type: 'price' as const, precision: this.precision(), minMove: 1 / 10 ** this.precision() };
    const type = this.chartType();

    if (type === 'area' || type === 'line') {
      this.glow = this.chart.addSeries(LineSeries, {
        color: 'rgba(56, 189, 248, 0.35)',
        lineWidth: 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: pf,
      });
      this.main =
        type === 'area'
          ? this.chart.addSeries(AreaSeries, {
              lineColor: '#38BDF8',
              lineWidth: 2,
              topColor: 'rgba(56, 189, 248, 0.38)',
              bottomColor: 'rgba(56, 189, 248, 0.01)',
              priceLineVisible: false,
              lastPriceAnimation: LastPriceAnimationMode.Continuous,
              crosshairMarkerRadius: 5,
              crosshairMarkerBorderColor: '#fff',
              crosshairMarkerBackgroundColor: '#38BDF8',
              priceFormat: pf,
            })
          : this.chart.addSeries(LineSeries, {
              color: '#38BDF8',
              lineWidth: 2,
              priceLineVisible: false,
              lastPriceAnimation: LastPriceAnimationMode.Continuous,
              priceFormat: pf,
            });
    } else {
      if (this.showVolume()) {
        this.vol = this.chart.addSeries(HistogramSeries, {
          priceScaleId: 'vol',
          priceFormat: { type: 'volume' },
          lastValueVisible: false,
          priceLineVisible: false,
        });
        this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      }
      this.main =
        type === 'candles'
          ? this.chart.addSeries(CandlestickSeries, {
              upColor: '#089981',
              downColor: '#f23645',
              borderVisible: true,
              borderColor: '#089981',
              borderUpColor: '#089981',
              borderDownColor: '#f23645',
              wickUpColor: '#089981',
              wickDownColor: '#f23645',
              priceLineColor: '#38BDF8',
              priceFormat: pf,
            })
          : this.chart.addSeries(BarSeries, {
              upColor: '#089981',
              downColor: '#f23645',
              thinBars: false,
              priceLineColor: '#38BDF8',
              priceFormat: pf,
            });
    }
    this.rebuildIndicators();
  }

  private async reload(symbol: string, type: ChartType, tf: number) {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    if (this.subscribed !== symbol) {
      if (this.subscribed) this.market.unsubscribe(this.subscribed);
      this.market.subscribe(symbol);
      this.subscribed = symbol;
    }
    this.loadedFor = '';
    this.pending = [];
    this.buildSeries();
    const isArea = type === 'area' || type === 'line';
    let candles: Candle[] = [];
    try {
      candles = await this.market.candles(symbol, isArea ? 1 : tf, isArea ? 900 : 500);
    } catch {
      candles = [];
    }
    if (seq !== this.loadSeq || !this.main || this.destroyed) return;
    const shift = this.shift();

    if (isArea) {
      const pts: Pt[] = [];
      for (const c of candles) {
        const t = c.time + shift;
        const last = pts[pts.length - 1];
        if (last) for (let g = last.time + 1; g < t; g++) pts.push({ time: g, value: last.value }); // fill gaps: 1 point / second
        pts.push({ time: t, value: c.close });
      }
      this.area = pts;
      this.main.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      this.glow?.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      this.target = this.shown = pts[pts.length - 1]?.value ?? null;
    } else {
      this.bars = candles.map((c) => ({ ...c, time: c.time + shift }));
      this.main.setData(this.bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
      this.vol?.setData(
        this.bars.map((b) => ({
          time: b.time as UTCTimestamp,
          value: b.volume || Math.round(15 + Math.random() * 40),
          color: b.close >= b.open ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 54, 69, 0.5)',
        }))
      );
      this.target = this.shown = this.bars[this.bars.length - 1]?.close ?? null;
    }
    this.lastPrice.set(this.target);
    this.loadedFor = symbol;
    for (const p of this.pending) this.onTick(p.p, p.t);
    this.pending = [];
    this.updateIndicators();
    this.fitRange();
    this.loading.set(false);
    if (!this.destroyed) this.drawn.emit();
  }

  private onTick(price: number, tMs: number) {
    this.target = price;
    this.lastPrice.set(price);
    if (this.isArea()) return; // area points are advanced smoothly in the frame loop
    const tf = this.timeframe();
    const bucket = Math.floor(tMs / 1000 / tf) * tf + this.shift();
    const last = this.bars[this.bars.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
    } else if (!last || bucket > last.time) {
      this.bars.push({ time: bucket, open: last?.close ?? price, high: Math.max(price, last?.close ?? price), low: Math.min(price, last?.close ?? price), close: price, volume: 1 });
      if (this.bars.length > 3000) this.bars.shift();
    } else return;
    const b = this.bars[this.bars.length - 1]!;
    this.main?.update({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close });
    if (this.vol) {
      this.vol.update({
        time: b.time as UTCTimestamp,
        value: b.volume || 25,
        color: b.close >= b.open ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 54, 69, 0.5)',
      });
    }
  }

  /** Per-frame: interpolate the area line toward the latest tick and recompute overlay geometry. */
  private loop = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(100, now - (this.lastFrame || now));
    this.lastFrame = now;
    if (!this.chart || !this.main) return;

    if (this.isArea() && this.loadedFor === this.symbol() && this.target != null) {
      const nowMs = Date.now();
      const nowSec = this.toChartTime(nowMs);
      const k = 1 - Math.exp(-dt / 80);
      this.shown = this.shown == null ? this.target : this.shown + (this.target - this.shown) * k;
      if (Math.abs(this.target - this.shown) < 10 ** -(this.precision() + 1)) this.shown = this.target;
      let last = this.area[this.area.length - 1];
      // advance one point per elapsed second (keeps 1 logical bar == 1 second)
      while (last && last.time < nowSec) {
        const p = { time: last.time + 1, value: last.time + 1 === nowSec ? this.shown : last.value };
        this.area.push(p);
        this.main.update({ time: p.time as UTCTimestamp, value: p.value });
        this.glow?.update({ time: p.time as UTCTimestamp, value: p.value });
        last = p;
      }
      if (!last) {
        last = { time: nowSec, value: this.shown };
        this.area.push(last);
      }
      last.value = this.shown;
      this.main.update({ time: last.time as UTCTimestamp, value: last.value });
      this.glow?.update({ time: last.time as UTCTimestamp, value: last.value });
      if (this.area.length > 4000) this.area.splice(0, 1000);

      // Continuous 60fps horizontal flowing motion:
      const subSec = (nowMs % 1000) / 1000;
      const currentLogical = this.area.length - 1 + subSec;
      const win = this.window();
      const right = Math.min(Math.max(12, this.expirySec() * 1.25 + 6), win * 0.9);
      this.chart.timeScale().setVisibleLogicalRange({
        from: (currentLogical - win) as Logical,
        to: (currentLogical + right) as Logical,
      });
    }
    this.computeOverlay();
  };

  // ---------------------------------------------------------------- geometry
  private lastTime() {
    return this.isArea() ? this.area[this.area.length - 1]?.time : this.bars[this.bars.length - 1]?.time;
  }
  private count() {
    return this.isArea() ? this.area.length : this.bars.length;
  }

  /** x for any chart time (seconds, shifted), including the future. */
  private xFor(t: number): number | null {
    const lt = this.lastTime();
    if (lt == null || !this.chart) return null;
    const logical = this.count() - 1 + (t - lt) / this.step();
    return this.chart.timeScale().logicalToCoordinate(logical as Logical);
  }

  private fitRange() {
    if (!this.chart) return;
    const n = this.count();
    if (!n) return;
    if (this.isArea()) {
      const win = this.window();
      const right = Math.min(Math.max(12, this.expirySec() * 1.25 + 6), win * 0.9);
      this.chart.timeScale().applyOptions({ rightOffset: right });
      this.chart.timeScale().setVisibleLogicalRange({ from: n - 1 - win, to: n - 1 + right });
    } else {
      const right = Math.min(Math.max(6, this.expirySec() / this.timeframe() + 4), 40);
      this.chart.timeScale().applyOptions({ rightOffset: right });
      this.chart.timeScale().setVisibleLogicalRange({ from: n - 90, to: n - 1 + right });
    }
  }

  private computeOverlay() {
    const el = this.host().nativeElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const nowMs = this.clockSvc.now();
    const series = this.main!;
    const lastPrice = this.target;
    const nowT = this.toChartTime(Date.now());
    const paneW = w - (this.chart!.priceScale('right').width() || 0);

    let expiry: Overlay['expiry'] = null;
    if (this.showExpiry()) {
      const expT = nowT + this.expirySec();
      const x = this.xFor(expT);
      if (x != null) expiry = { x: Math.min(x, paneW - 2), label: clock(Date.now() + this.expirySec() * 1000, this.offsetMin()) };
    }

    let zone: Overlay['zone'] = null;
    const dir = this.hoverDirection();
    if (dir && lastPrice != null && expiry) {
      const x1 = this.xFor(nowT);
      const y = series.priceToCoordinate(lastPrice);
      if (x1 != null && y != null) zone = { x1, x2: expiry.x, y, dir };
    }

    const trades: OverlayTrade[] = [];
    const flashing = this.flashing();
    for (const t of this.trades()) {
      if (t.symbol !== this.symbol()) continue;
      const x1 = this.xFor(this.toChartTime(new Date(t.openedAt).getTime()));
      const x2 = this.xFor(this.toChartTime(new Date(t.expiresAt).getTime()));
      const y = series.priceToCoordinate(t.openPrice);
      if (x1 == null || x2 == null || y == null) continue;
      const up = t.direction === 'up';
      const winning = lastPrice != null && (up ? lastPrice > t.openPrice : lastPrice < t.openPrice);
      const remaining = Math.max(0, Math.ceil((new Date(t.expiresAt).getTime() - nowMs) / 1000));
      const f = flashing.get(t.id);
      trades.push({
        id: t.id,
        x1,
        x2: Math.min(x2, paneW - 2),
        y,
        up,
        winning,
        flash: f ? (f.status as 'won' | 'lost' | 'draw') : null,
        label: f ? (f.status === 'won' ? `+${money(f.profit)}` : f.status === 'draw' ? 'Refund' : `−${money(f.amount)}`) : `${money(t.amount)} · ${remaining}s`,
      });
    }

    const trends = this.trends
      .map((tr) => {
        const x1 = this.xFor(tr.t1);
        const x2 = this.xFor(tr.t2);
        const y1 = series.priceToCoordinate(tr.p1);
        const y2 = series.priceToCoordinate(tr.p2);
        return x1 != null && x2 != null && y1 != null && y2 != null ? { x1, y1, x2, y2 } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    let draft: Overlay['draft'] = null;
    if (this.draft) {
      const x = this.xFor(this.draft.t);
      const y = series.priceToCoordinate(this.draft.p);
      if (x != null && y != null) draft = { x, y };
    }

    let currentPoint: Overlay['currentPoint'] = null;
    if (this.isArea() && this.shown != null && this.area.length > 0) {
      const subSec = (Date.now() % 1000) / 1000;
      const logical = this.area.length - 1 + subSec;
      const x = this.chart?.timeScale().logicalToCoordinate(logical as Logical);
      const y = series.priceToCoordinate(this.shown);
      if (x != null && y != null) {
        currentPoint = { x: Math.min(x, paneW - 1), y, price: this.shown };
      }
    }

    const next: Overlay = { w, h, expiry, zone, trades, trends, draft, currentPoint };
    const prev = this.overlay();
    if (JSON.stringify(prev) !== JSON.stringify(next)) this.overlay.set(next);
  }

  // ---------------------------------------------------------------- indicators
  private rebuildIndicators() {
    if (!this.chart) return;
    for (const list of this.ind.values()) for (const s of list) this.chart.removeSeries(s);
    this.ind.clear();
    const mk = (color: string, width: 1 | 2 = 1, style = LineStyle.Solid) =>
      this.chart!.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    for (const id of this.indicators()) {
      if (id === 'sma') this.ind.set(id, [mk('#F5B841', 2)]);
      if (id === 'ema') this.ind.set(id, [mk('#C084FC', 2)]);
      if (id === 'bb') this.ind.set(id, [mk('rgba(45,212,191,.8)'), mk('rgba(45,212,191,.45)', 1, LineStyle.Dashed), mk('rgba(45,212,191,.8)')]);
    }
    this.updateIndicators();
  }

  private updateIndicators() {
    if (!this.ind.size || this.destroyed) return;
    const src = this.isArea() ? this.area.map((p) => ({ time: p.time, v: p.value })) : this.bars.map((b) => ({ time: b.time, v: b.close }));
    const vals = src.map((s) => s.v);
    const period = this.isArea() ? 30 : 20;
    const toData = (arr: (number | null)[]) =>
      arr.map((v, i) => (v == null ? { time: src[i]!.time as UTCTimestamp } : { time: src[i]!.time as UTCTimestamp, value: v }));
    for (const [id, series] of this.ind) {
      if (id === 'sma') series[0]!.setData(toData(sma(vals, period)));
      if (id === 'ema') series[0]!.setData(toData(ema(vals, period * 2)));
      if (id === 'bb') {
        const b = bollinger(vals, period, 2);
        series[0]!.setData(toData(b.map((x) => x?.up ?? null)));
        series[1]!.setData(toData(b.map((x) => x?.mid ?? null)));
        series[2]!.setData(toData(b.map((x) => x?.low ?? null)));
      }
    }
  }

  // ---------------------------------------------------------------- drawings
  private pointToData(p: MouseEventParams<Time>) {
    if (!p.point || !this.main) return null;
    const price = this.main.coordinateToPrice(p.point.y);
    const logical = this.chart!.timeScale().coordinateToLogical(p.point.x);
    const lt = this.lastTime();
    if (price == null || logical == null || lt == null) return null;
    const t = lt + (logical - (this.count() - 1)) * this.step();
    return { t, p: price };
  }

  private onClick(p: MouseEventParams<Time>) {
    const tool = this.drawTool();
    const d = this.pointToData(p);
    if (!d || tool === 'none') return;
    if (tool === 'hline') {
      this.hlines.push(this.main!.createPriceLine({ price: d.p, color: '#F5B841', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }));
    } else if (tool === 'trend') {
      if (!this.draft) this.draft = d;
      else {
        this.trends.push({ t1: this.draft.t, p1: this.draft.p, t2: d.t, p2: d.p });
        this.draft = null;
      }
    }
  }

  private onMove(p: MouseEventParams<Time>) {
    if (!p.point || !p.seriesData || !this.main) {
      this.crosshairCandle.emit(null);
      return;
    }
    const data = p.seriesData.get(this.main) as any;
    if (data && typeof data.open === 'number') {
      const volData = this.vol ? (p.seriesData.get(this.vol) as any) : null;
      const vol = volData?.value ?? 0;
      const diff = data.close - data.open;
      const pct = data.open ? (diff / data.open) * 100 : 0;
      this.crosshairCandle.emit({
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: vol,
        time: (p.time as number) || 0,
        change: diff,
        changePct: pct,
      });
    } else {
      this.crosshairCandle.emit(null);
    }
  }

  private clearAllDrawings() {
    for (const l of this.hlines) this.main?.removePriceLine(l);
    this.hlines = [];
    this.trends = [];
    this.draft = null;
  }
}

