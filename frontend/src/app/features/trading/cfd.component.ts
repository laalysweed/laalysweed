import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChartComponent } from './chart.component';
import { AssetSelectorComponent } from './asset-selector.component';
import { IconComponent } from '../../shared/icon.component';
import { UiService, ChartType, SoundService } from '../../core/ui.service';
import { MarketService } from '../../core/market.service';
import { AccountService } from '../../core/account.service';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { ClockService } from '../../core/clock.service';
import { ApiError, CfdPosition, Signal } from '../../core/models';
import { clock, dateTime, money, price, signedMoney, utcLabel } from '../../core/format';

interface CfdOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  lots: number;
  limitPrice: number;
  status: string;
  createdAt: string;
}

@Component({
  selector: 'app-cfd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent, AssetSelectorComponent, IconComponent, FormsModule],
  templateUrl: './cfd.component.html',
  styleUrl: './cfd.component.scss',
})
export class CfdComponent {
  protected ui = inject(UiService);
  protected sound = inject(SoundService);
  protected market = inject(MarketService);
  protected accounts = inject(AccountService);
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private clockSvc = inject(ClockService);

  protected chartType = signal<ChartType>('candles');
  protected tf = signal(60);
  protected orderType = signal<'market' | 'limit'>('market');
  protected side = signal<'buy' | 'sell'>('buy');
  protected lots = signal(0.01);
  protected limitPrice = signal<number | null>(null);
  protected conditionsOpen = signal(true);
  protected useSl = signal(false);
  protected useTp = signal(false);
  protected sl = signal<number | null>(null);
  protected tp = signal<number | null>(null);
  protected busy = signal(false);
  protected ai = signal<Signal | null | undefined>(undefined);
  protected tab = signal<'positions' | 'orders' | 'history'>('positions');
  protected positions = signal<CfdPosition[]>([]);
  protected history = signal<CfdPosition[]>([]);
  protected orders = signal<CfdOrder[]>([]);
  protected bottomOpen = signal(true);
  protected tool = signal<'none' | 'hline' | 'trend'>('none');
  protected clear = signal(0);
  protected hoveredCandle = signal<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    time: number;
    change: number;
    changePct: number;
  } | null>(null);
  protected indicatorsOpen = signal(false);
  protected isFullscreen = signal(false);

  protected toggleFullscreen() {
    this.isFullscreen.update((v) => !v);
  }

  protected activeOhlc = computed(() => {
    const h = this.hoveredCandle();
    if (h) {
      return {
        o: this.price(h.open, this.prec()),
        h: this.price(h.high, this.prec()),
        l: this.price(h.low, this.prec()),
        c: this.price(h.close, this.prec()),
        diff: (h.change >= 0 ? '+' : '') + this.price(h.change, this.prec()),
        pct: (h.changePct >= 0 ? '+' : '') + h.changePct.toFixed(2) + '%',
        up: h.close >= h.open,
        vol: Math.round(h.volume || 47),
      };
    }
    const m = this.mid();
    if (m == null) return null;
    const a = this.asset();
    const ch = a?.changePct ?? 0.11;
    const openP = m / (1 + ch / 100);
    const diff = m - openP;
    return {
      o: this.price(openP, this.prec()),
      h: this.price(Math.max(m, openP) * 1.0012, this.prec()),
      l: this.price(Math.min(m, openP) * 0.9988, this.prec()),
      c: this.price(m, this.prec()),
      diff: (diff >= 0 ? '+' : '') + this.price(diff, this.prec()),
      pct: (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%',
      up: m >= openP,
      vol: 47,
    };
  });
  protected money = money;
  protected signed = signedMoney;
  protected price = price;
  protected dt = dateTime;

  protected asset = computed(() => this.market.asset(this.ui.cfdSymbol()));
  protected mid = computed(() => this.market.price(this.ui.cfdSymbol())());
  protected spread = computed(() => this.asset()?.cfd?.spread ?? 0);
  protected bid = computed(() => (this.mid() ?? 0) - this.spread() / 2);
  protected ask = computed(() => (this.mid() ?? 0) + this.spread() / 2);
  protected prec = computed(() => this.asset()?.precision ?? 2);
  protected margin = computed(() => {
    const a = this.asset();
    if (!a?.cfd || !this.mid()) return 0;
    const p = this.side() === 'buy' ? this.ask() : this.bid();
    return Math.ceil(((p * this.lots() * a.cfd.contractSize) / a.cfd.leverage) * 100);
  });
  protected legend = computed(() => {
    const a = this.asset();
    return a ? `${a.name} · ${this.tf() >= 60 ? this.tf() / 60 : this.tf() + 's'} · ${a.source === 'binance' ? 'Binance' : 'Y2 OTC'}` : '';
  });
  protected offset = computed(() => this.auth.user()?.timezoneOffset ?? 180);
  protected timeText = computed(() => `${clock(this.clockSvc.now(), this.auth.user()?.timezoneOffset ?? 180)} ${utcLabel(this.auth.user()?.timezoneOffset ?? 180)}`);

  /** Unrealised P/L per open position (cents), recomputed from live prices. */
  protected livePnl = computed(() => {
    const out = new Map<string, number>();
    for (const p of this.positions()) {
      const m = this.market.price(p.symbol)();
      if (m == null) continue;
      const exit = p.side === 'buy' ? m - p.spread / 2 : m + p.spread / 2;
      const diff = p.side === 'buy' ? exit - p.openPrice : p.openPrice - exit;
      out.set(p.id, Math.max(-p.margin, Math.round(diff * p.lots * p.contractSize * 100)));
    }
    return out;
  });
  protected totals = computed(() => {
    const acc = this.accounts.active();
    const used = this.positions().reduce((s, p) => s + p.margin, 0);
    const pnl = [...this.livePnl().values()].reduce((s, v) => s + v, 0);
    const balance = (acc?.balance ?? 0) + used;
    const equity = balance + pnl;
    return { balance, equity, margin: used, free: equity - used, level: used ? (equity / used) * 100 : 0, pnl };
  });
  protected priceLines = computed(() =>
    this.positions()
      .filter((p) => p.symbol === this.ui.cfdSymbol())
      .map((p) => ({ id: p.id, price: p.openPrice, color: p.side === 'buy' ? '#22C55E' : '#EF4444', title: `${p.side.toUpperCase()} ${p.lots}` })),
  );

  constructor() {
    void this.market.loadAssets().then(() => {
      const a = this.market.asset(this.ui.cfdSymbol());
      if (!a?.cfd) this.ui.cfdSymbol.set(this.market.assets().find((x) => x.cfd)?.symbol ?? 'BTCUSDT');
    });
    effect(() => {
      const acc = this.accounts.active();
      if (acc) untracked(() => void this.load());
    });
    const offs = [
      this.socket.on<CfdPosition>('cfd:update', (p) => {
        if (p.status === 'open') this.positions.update((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [p, ...l]));
        else {
          this.positions.update((l) => l.filter((x) => x.id !== p.id));
          this.history.update((l) => [p, ...l.filter((x) => x.id !== p.id)]);
          if (p.closeReason && p.closeReason !== 'manual' && p.closeReason !== 'close_all') {
            this.toast.info(`${p.symbol} closed by ${p.closeReason.toUpperCase()}: ${signedMoney(p.pnl)}`);
          }
        }
      }),
      this.socket.on<CfdOrder>('cfd:order', (o) => this.orders.update((l) => [o, ...l.filter((x) => x.id !== o.id)].filter((x) => x.status === 'waiting'))),
    ];
    inject(DestroyRef).onDestroy(() => offs.forEach((o) => o()));
  }

  private async load() {
    const acc = this.accounts.active();
    if (!acc) return;
    const [open, closed, orders] = await Promise.all([
      this.api.get<CfdPosition[]>('/cfd/positions', { status: 'open', accountId: acc.id }),
      this.api.get<CfdPosition[]>('/cfd/positions', { status: 'closed', accountId: acc.id }),
      this.api.get<CfdOrder[]>('/cfd/orders', { accountId: acc.id }),
    ]);
    this.positions.set(open);
    this.history.set(closed);
    this.orders.set(orders);
  }

  protected stepLots(d: number) {
    this.lots.set(Math.min(100, Math.max(0.01, Math.round((this.lots() + d) * 100) / 100)));
  }

  protected async submit(side = this.side()) {
    const acc = this.accounts.active();
    if (!acc) return;
    if (acc.type === 'tournament') return this.toast.error('Switch to your demo or real account for CFD trading');
    this.busy.set(true);
    try {
      const body = { accountId: acc.id, symbol: this.ui.cfdSymbol(), side, lots: this.lots(), sl: this.useSl() ? this.sl() : null, tp: this.useTp() ? this.tp() : null };
      if (this.orderType() === 'market') {
        await this.api.post('/cfd/positions', body);
        this.sound.playTradeOpen(side === 'buy' ? 'up' : 'down');
        this.toast.success(`${side === 'buy' ? 'Bought' : 'Sold'} ${this.lots()} lot ${this.asset()?.name}`);
      } else {
        await this.api.post('/cfd/orders', { ...body, limitPrice: Number(this.limitPrice() ?? this.mid()) });
        this.sound.playTradeOpen(side === 'buy' ? 'up' : 'down');
        this.toast.success('Limit order placed');
        this.tab.set('orders');
      }
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async close(p: CfdPosition) {
    await this.api.post(`/cfd/positions/${p.id}/close`).catch((e: ApiError) => this.toast.error(e.message));
    if ((this.livePnl().get(p.id) ?? 0) >= 0) this.sound.playWin();
    else this.sound.playLoss();
  }

  protected async closeAll(filter: 'all' | 'winning' | 'losing') {
    const acc = this.accounts.active();
    if (!acc) return;
    const r = await this.api.post<{ closed: number }>('/cfd/close-all', { accountId: acc.id, filter });
    this.toast.info(`${r.closed} position${r.closed === 1 ? '' : 's'} closed`);
  }

  protected async cancelOrder(o: CfdOrder) {
    await this.api.delete(`/cfd/orders/${o.id}`).catch((e: ApiError) => this.toast.error(e.message));
    this.orders.update((l) => l.filter((x) => x.id !== o.id));
  }

  protected async autoTrade() {
    this.ai.set(undefined);
    const list = await this.api.get<Signal[]>('/signals', { symbol: this.ui.cfdSymbol() });
    const s = list.find((x) => x.result === 'pending' && new Date(x.expiresAt).getTime() > Date.now()) ?? null;
    this.ai.set(s);
    if (!s) this.toast.info('AI: no clear setup on this asset right now');
  }

  protected async followAi() {
    const s = this.ai();
    if (!s) return;
    this.ai.set(undefined);
    await this.submit(s.direction === 'up' ? 'buy' : 'sell');
  }
}
