import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { ChartComponent } from './chart.component';
import { AssetSelectorComponent } from './asset-selector.component';
import { TradePanelComponent } from './trade-panel.component';
import { TradesPanelComponent } from './trades-panel.component';
import { SignalsPanelComponent } from './signals-panel.component';
import { SocialPanelComponent } from './social-panel.component';
import { PendingPanelComponent } from './pending-panel.component';
import { IconComponent } from '../../shared/icon.component';
import { SpotlightDirective } from '../../core/spotlight';
import { UiService, ChartType, RightPanel } from '../../core/ui.service';
import { MarketService } from '../../core/market.service';
import { TradesService } from '../../core/trades.service';
import { AuthService } from '../../core/auth.service';
import { ClockService } from '../../core/clock.service';
import { ApiService } from '../../core/api.service';
import { clock, shortDuration, utcLabel } from '../../core/format';

const WINDOWS = [30, 60, 120, 300, 600, 900];
const TIMEFRAMES = [5, 10, 15, 30, 60, 120, 300, 600, 900, 3600];

@Component({
  selector: 'app-trading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'menu.set(null)' },
  imports: [ChartComponent, AssetSelectorComponent, TradePanelComponent, TradesPanelComponent, SignalsPanelComponent, SocialPanelComponent, PendingPanelComponent, IconComponent, SpotlightDirective],
  templateUrl: './trading.component.html',
  styleUrl: './trading.component.scss',
})
export class TradingComponent implements OnInit {
  protected ui = inject(UiService);
  protected market = inject(MarketService);
  protected trades = inject(TradesService);
  protected auth = inject(AuthService);
  private clockSvc = inject(ClockService);
  private api = inject(ApiService);

  /** ?symbol= deep link (e.g. from the landing page markets table). */
  readonly symbolParam = input<string | undefined>(undefined, { alias: 'symbol' });

  protected menu = signal<'ind' | 'type' | 'draw' | 'tf' | 'tz' | null>(null);
  protected asset = computed(() => this.market.asset(this.ui.symbol()));
  protected offset = computed(() => this.auth.user()?.timezoneOffset ?? 180);
  protected clockText = computed(() => clock(this.clockSvc.now(), this.offset()));
  protected tzLabel = computed(() => utcLabel(this.offset()));
  protected sentiment = computed(() => this.market.sentiment(this.ui.symbol())());
  protected openCount = computed(() => this.trades.open().length);

  protected chartType = computed<ChartType>(() => {
    const t = this.ui.chartType();
    if (this.ui.mode() === 'classic') return t === 'line' ? 'line' : 'area';
    return t === 'bars' ? 'bars' : 'candles';
  });
  protected isArea = computed(() => this.chartType() === 'area' || this.chartType() === 'line');
  protected tfLabel = computed(() => shortDuration(this.isArea() ? this.ui.window() : this.ui.timeframe()));
  protected tfOptions = computed(() => (this.isArea() ? WINDOWS : TIMEFRAMES));
  protected tzOptions = Array.from({ length: 27 }, (_, i) => (i - 12) * 60);
  protected shortDuration = shortDuration;
  protected utcLabel = utcLabel;

  protected chartTypes: { id: ChartType; label: string; icon: string }[] = [
    { id: 'area', label: 'Area', icon: 'chart-area' },
    { id: 'line', label: 'Line', icon: 'chart-line' },
    { id: 'candles', label: 'Candles', icon: 'chart-candle' },
    { id: 'bars', label: 'Bars', icon: 'chart-bars' },
  ];
  protected indicatorList = [
    { id: 'sma', label: 'Moving Average (SMA)', color: '#F5B841' },
    { id: 'ema', label: 'Exponential MA (EMA)', color: '#C084FC' },
    { id: 'bb', label: 'Bollinger Bands', color: '#2DD4BF' },
  ];

  ngOnInit() {
    const s = this.symbolParam();
    if (s) this.ui.symbol.set(s);
    void this.market.loadAssets().then(() => {
      if (!this.market.asset(this.ui.symbol())) this.ui.symbol.set(this.market.assets()[0]?.symbol ?? 'BTCUSD_OTC');
    });
  }

  protected toggleMenu(m: 'ind' | 'type' | 'draw' | 'tf' | 'tz') {
    this.menu.set(this.menu() === m ? null : m);
  }

  protected setType(t: ChartType) {
    this.ui.chartType.set(t);
    this.ui.mode.set(t === 'area' || t === 'line' ? 'classic' : 'pro');
    this.menu.set(null);
  }

  protected setMode(m: 'classic' | 'pro') {
    this.ui.mode.set(m);
    this.ui.chartType.set(m === 'classic' ? 'area' : 'candles');
  }

  protected setTf(v: number) {
    if (this.isArea()) this.ui.window.set(v);
    else this.ui.timeframe.set(v);
    this.menu.set(null);
  }

  protected setTool(t: 'none' | 'hline' | 'trend') {
    this.ui.drawTool.set(this.ui.drawTool() === t ? 'none' : t);
    this.menu.set(null);
  }

  protected clearDrawings() {
    this.ui.clearDrawings.update((n) => n + 1);
    this.ui.drawTool.set('none');
    this.menu.set(null);
  }

  protected async setTz(off: number) {
    this.menu.set(null);
    this.auth.patchUser({ timezoneOffset: off });
    await this.api.patch('/me', { timezoneOffset: off }).catch(() => undefined);
  }

  protected panel(p: RightPanel) {
    this.ui.rightPanel.set(this.ui.rightPanel() === p ? null : p);
    this.ui.mobileSheet.set(true);
  }
}
