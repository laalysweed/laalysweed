import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { AreaSeries, ColorType, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, createChart, createSeriesMarkers } from 'lightweight-charts';
import { ApiService } from '../../core/api.service';
import { MarketService } from '../../core/market.service';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { Trade } from '../../core/models';
import { clock, dateTime, money, price, signedMoney } from '../../core/format';

interface Detail {
  trade: Trade;
  ticks: { t: number; p: number; id: string }[];
}

/** Bottom sheet with a tick-by-tick replay of a trade drawn from the server's recorded ticks. */
@Component({
  selector: 'app-trade-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="backdrop anim-fade" (click)="close()"></div>
    <section class="sheet" [class.leaving]="leaving()" role="dialog" aria-modal="true">
      <header>
        <div>
          <h3>{{ name() }} <span class="dir" [class.up]="d()?.trade?.direction === 'up'">{{ d()?.trade?.direction === 'up' ? '▲ BUY' : '▼ SELL' }}</span></h3>
          <small class="muted">{{ when() }}</small>
        </div>
        <button class="icon-btn" (click)="close()" aria-label="Close"><app-icon name="close" [size]="18" /></button>
      </header>
      <div class="replay">
        <div class="chart" #chartEl></div>
        <button class="btn btn-soft sm play" (click)="replay()" [disabled]="playing() || !d()"><app-icon name="play" [size]="16" /> Replay</button>
      </div>
      @if (d(); as x) {
        <div class="facts">
          <div><span>Amount</span><b>{{ money(x.trade.amount) }}</b></div>
          <div><span>Payout</span><b>{{ x.trade.payoutPct }}%</b></div>
          <div><span>Open price</span><b class="num">{{ price(x.trade.openPrice, prec()) }}</b></div>
          <div><span>Close price</span><b class="num">{{ x.trade.closePrice !== null ? price(x.trade.closePrice, prec()) : '—' }}</b></div>
          <div><span>Duration</span><b>{{ x.trade.durationSec }}s</b></div>
          <div><span>Result</span>
            <b [class.up-text]="x.trade.profit > 0" [class.down-text]="x.trade.profit < 0">
              {{ x.trade.status === 'open' ? 'Open' : signed(x.trade.profit) }}
            </b>
          </div>
        </div>
        <p class="audit"><app-icon name="shield" [size]="16" /> Settled on recorded ticks · open tick <code>{{ x.trade.openTickId.slice(-8) }}</code>
          @if (x.trade.closeTickId) { · close tick <code>{{ x.trade.closeTickId.slice(-8) }}</code> }
        </p>
      } @else {
        <div class="skeleton" style="height: 90px; margin: 16px"></div>
      }
    </section>
  `,
  styleUrl: './trade-detail.component.scss',
})
export class TradeDetailComponent {
  private api = inject(ApiService);
  private market = inject(MarketService);
  private auth = inject(AuthService);
  readonly tradeId = input.required<string>();
  readonly closed = output<void>();

  private chartEl = viewChild.required<ElementRef<HTMLDivElement>>('chartEl');
  protected d = signal<Detail | null>(null);
  protected playing = signal(false);
  protected leaving = signal(false);
  protected money = money;
  protected signed = signedMoney;
  protected price = price;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Area'> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  protected name = () => this.market.asset(this.d()?.trade.symbol ?? '')?.name ?? this.d()?.trade.symbol ?? '';
  protected prec = () => this.market.asset(this.d()?.trade.symbol ?? '')?.precision ?? 2;
  protected when = () => {
    const t = this.d()?.trade;
    if (!t) return '';
    const off = this.auth.user()?.timezoneOffset ?? 180;
    return `${dateTime(t.openedAt)} · ${clock(new Date(t.openedAt).getTime(), off)} → ${clock(new Date(t.expiresAt).getTime(), off)}`;
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.timer);
      this.chart?.remove();
    });
    afterNextRender(async () => {
      this.chart = createChart(this.chartEl().nativeElement, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8A93A6', attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,.05)' } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true },
        handleScroll: false,
        handleScale: false,
      });
      this.series = this.chart.addSeries(AreaSeries, { lineColor: '#38BDF8', topColor: 'rgba(56,189,248,.28)', bottomColor: 'rgba(56,189,248,0)', lineWidth: 2, priceLineVisible: false });
      const r = await this.api.get<Detail>(`/trades/${this.tradeId()}`);
      this.d.set(r);
      this.series.applyOptions({ priceFormat: { type: 'price', precision: this.prec(), minMove: 1 / 10 ** this.prec() } });
      this.draw(r.ticks.length);
    });
  }

  private points(n: number) {
    const x = this.d()!;
    const off = (this.auth.user()?.timezoneOffset ?? 180) * 60;
    const out: { time: UTCTimestamp; value: number }[] = [];
    for (const k of x.ticks.slice(0, n)) {
      const time = (Math.floor(k.t / 1000) + off) as UTCTimestamp;
      if (out.length && out[out.length - 1]!.time === time) out[out.length - 1]!.value = k.p;
      else out.push({ time, value: k.p });
    }
    return out;
  }

  private draw(n: number) {
    const x = this.d();
    if (!x || !this.series || !this.chart) return;
    const pts = this.points(n);
    this.series.setData(pts);
    const t = x.trade;
    const color = t.status === 'won' ? '#22C55E' : t.status === 'lost' ? '#EF4444' : '#94A3B8';
    this.series.createPriceLine({ price: t.openPrice, color: t.direction === 'up' ? '#22C55E' : '#EF4444', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'Open' });
    const off = (this.auth.user()?.timezoneOffset ?? 180) * 60;
    const markers = [{ time: (Math.floor(new Date(t.openedAt).getTime() / 1000) + off) as UTCTimestamp, position: t.direction === 'up' ? ('belowBar' as const) : ('aboveBar' as const), color: t.direction === 'up' ? '#22C55E' : '#EF4444', shape: t.direction === 'up' ? ('arrowUp' as const) : ('arrowDown' as const), text: 'Open' }];
    if (t.closedAt && n >= x.ticks.length) markers.push({ time: (Math.floor(new Date(t.expiresAt).getTime() / 1000) + off) as UTCTimestamp, position: 'aboveBar', color, shape: 'arrowDown', text: 'Close' });
    createSeriesMarkers(this.series, markers.filter((m) => pts.some((p) => p.time >= m.time)));
    this.chart.timeScale().fitContent();
  }

  protected replay() {
    const x = this.d();
    if (!x) return;
    this.playing.set(true);
    let n = 2;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      n += Math.max(1, Math.ceil(x.ticks.length / 120));
      this.series?.setData(this.points(Math.min(n, x.ticks.length)));
      this.chart?.timeScale().fitContent();
      if (n >= x.ticks.length) {
        clearInterval(this.timer);
        this.draw(x.ticks.length);
        this.playing.set(false);
      }
    }, 30);
  }

  protected close() {
    this.leaving.set(true);
    setTimeout(() => this.closed.emit(), 240);
  }
}
