import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { MarketService } from '../../core/market.service';
import { UiService } from '../../core/ui.service';
import { ClockService } from '../../core/clock.service';
import { IconComponent } from '../../shared/icon.component';
import { Signal } from '../../core/models';
import { price } from '../../core/format';

@Component({
  selector: 'app-signals-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <h3 class="title">Signals</h3>
    <div class="stats">
      <div><b>{{ stats()?.accuracy ?? '—' }}{{ stats()?.accuracy != null ? '%' : '' }}</b><span>7-day accuracy</span></div>
      <div><b class="up-text">{{ stats()?.hit ?? 0 }}</b><span>Hit</span></div>
      <div><b class="down-text">{{ stats()?.miss ?? 0 }}</b><span>Miss</span></div>
    </div>
    <div class="list">
      @for (s of list(); track s.id) {
        <button class="sig" [class.done]="s.result !== 'pending'" (click)="select(s.symbol)">
          <span class="arrow" [class.up]="s.direction === 'up'"><app-icon [name]="s.direction === 'up' ? 'arrow-ur' : 'arrow-dr'" [size]="20" [stroke]="2.4" /></span>
          <span class="body">
            <b>{{ name(s.symbol) }}</b>
            <small>{{ s.reason }}</small>
            <span class="conf"><i [style.width.%]="s.confidence"></i></span>
          </span>
          <span class="side">
            @if (s.result === 'pending') {
              <span class="badge blue">{{ left(s.expiresAt) }}</span>
            } @else {
              <span class="badge" [class.green]="s.result === 'hit'" [class.red]="s.result === 'miss'">{{ s.result }}</span>
            }
            <small class="num">{{ s.confidence }}%</small>
          </span>
        </button>
      } @empty {
        <div class="empty">Scanning markets… new signals appear here in real time.</div>
      }
    </div>
    <p class="disc">Signals are generated from EMA(9/21) crossovers and RSI(14) extremes on 1-minute candles. They are informational only, not financial advice; accuracy above is measured on all past signals.</p>
  `,
  styleUrl: './rail-panels.scss',
})
export class SignalsPanelComponent {
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private market = inject(MarketService);
  private ui = inject(UiService);
  private clock = inject(ClockService);
  protected list = signal<Signal[]>([]);
  protected stats = signal<{ accuracy: number | null; hit: number; miss: number } | null>(null);
  protected price = price;

  constructor() {
    void this.load();
    this.socket.joinRoom('signals');
    const offs = [
      this.socket.on<Signal>('signal:new', (s) => this.list.update((l) => [s, ...l].slice(0, 60))),
      this.socket.on<Signal>('signal:update', (s) => {
        this.list.update((l) => l.map((x) => (x.id === s.id ? s : x)));
        void this.api.get<{ accuracy: number | null; hit: number; miss: number }>('/signals/stats').then((r) => this.stats.set(r));
      }),
    ];
    inject(DestroyRef).onDestroy(() => {
      offs.forEach((o) => o());
      this.socket.leaveRoom('signals');
    });
  }

  private async load() {
    const [l, s] = await Promise.all([this.api.get<Signal[]>('/signals'), this.api.get<{ accuracy: number | null; hit: number; miss: number }>('/signals/stats')]);
    this.list.set(l);
    this.stats.set(s);
  }

  protected name(sym: string) {
    return this.market.asset(sym)?.name ?? sym;
  }
  protected left(iso: string) {
    const s = Math.max(0, Math.ceil((new Date(iso).getTime() - this.clock.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  protected select(sym: string) {
    if (this.market.asset(sym)) this.ui.symbol.set(sym);
  }
}
