import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { AccountService } from '../../core/account.service';
import { MarketService } from '../../core/market.service';
import { UiService } from '../../core/ui.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { ApiError, Asset, Direction, PendingOrder } from '../../core/models';
import { dateTime, duration, money, price } from '../../core/format';

@Component({
  selector: 'app-pending-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <h3 class="title">Pending Trades</h3>
    <form class="pending-form" (ngSubmit)="create()">
      <div class="seg">
        <button type="button" [class.on]="dir() === 'up'" class="up" (click)="dir.set('up')">▲ BUY</button>
        <button type="button" [class.on]="dir() === 'down'" class="down" (click)="dir.set('down')">▼ SELL</button>
      </div>
      <div class="seg small">
        <button type="button" [class.on]="type() === 'price'" (click)="type.set('price')">At price</button>
        <button type="button" [class.on]="type() === 'time'" (click)="type.set('time')">At time</button>
      </div>
      @if (type() === 'price') {
        <div class="two">
          <select class="input sm" [ngModel]="cond()" (ngModelChange)="cond.set($event)" name="cond">
            <option value="above">Price ≥</option>
            <option value="below">Price ≤</option>
          </select>
          <input class="input sm num" type="number" step="any" [ngModel]="trigger()" (ngModelChange)="trigger.set($event)" name="trig" />
        </div>
        <small class="muted">Current: {{ price(current(), asset()?.precision ?? 2) }}</small>
      } @else {
        <input class="input sm" type="datetime-local" [ngModel]="at()" (ngModelChange)="at.set($event)" name="at" />
      }
      <div class="summary">{{ asset()?.name }} · {{ money(ui.amount()) }} · {{ dur() }}</div>
      <button class="btn btn-primary block" type="submit" [disabled]="busy()">Create pending trade</button>
    </form>

    <div class="list">
      @for (p of list(); track p.id) {
        <div class="row pend" [attr.data-status]="p.status">
          <span class="arrow" [class.up]="p.direction === 'up'">{{ p.direction === 'up' ? '▲' : '▼' }}</span>
          <span class="body">
            <b>{{ name(p.symbol) }} · {{ money(p.amount) }}</b>
            <small>{{ p.triggerType === 'price' ? (p.triggerCondition === 'above' ? '≥ ' : '≤ ') + p.triggerPrice : dt(p.triggerAt) }}{{ p.failReason ? ' · ' + p.failReason : '' }}</small>
          </span>
          @if (p.status === 'waiting') {
            <button class="icon-btn sm" (click)="cancel(p.id)" aria-label="Cancel"><app-icon name="close" [size]="14" /></button>
          } @else {
            <span class="badge" [class.green]="p.status === 'triggered'" [class.red]="p.status === 'failed'">{{ p.status }}</span>
          }
        </div>
      } @empty {
        <div class="empty">No pending trades. They open automatically when your condition is met.</div>
      }
    </div>
  `,
  styleUrl: './rail-panels.scss',
})
export class PendingPanelComponent {
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private accounts = inject(AccountService);
  private market = inject(MarketService);
  protected ui = inject(UiService);
  private toast = inject(ToastService);

  readonly asset = input<Asset | undefined>();
  protected list = signal<PendingOrder[]>([]);
  protected dir = signal<Direction>('up');
  protected type = signal<'price' | 'time'>('price');
  protected cond = signal<'above' | 'below'>('above');
  protected trigger = signal<number | null>(null);
  protected at = signal(new Date(Date.now() + 10 * 60_000 + 3 * 3600_000).toISOString().slice(0, 16));
  protected busy = signal(false);
  protected money = money;
  protected price = price;
  protected dt = dateTime;
  protected current = computed(() => this.market.price(this.asset()?.symbol ?? '')());
  protected dur = computed(() => duration(this.ui.durationSec()));

  constructor() {
    void this.api.get<PendingOrder[]>('/pending').then((l) => this.list.set(l));
    const off = this.socket.on<PendingOrder>('pending:update', (p) =>
      this.list.update((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [p, ...l])),
    );
    inject(DestroyRef).onDestroy(off);
  }

  protected name(s: string) {
    return this.market.asset(s)?.name ?? s;
  }

  protected async create() {
    const a = this.asset();
    const acc = this.accounts.active();
    if (!a || !acc) return;
    const body: Record<string, unknown> = { accountId: acc.id, symbol: a.symbol, direction: this.dir(), amount: this.ui.amount(), durationSec: this.ui.durationSec(), triggerType: this.type() };
    if (this.type() === 'price') {
      body['triggerPrice'] = Number(this.trigger() ?? this.current());
      body['triggerCondition'] = this.cond();
    } else body['triggerAt'] = new Date(this.at()).toISOString();
    this.busy.set(true);
    try {
      await this.api.post('/pending', body);
      this.toast.success('Pending trade created');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(id: string) {
    await this.api.delete(`/pending/${id}`).catch((e: ApiError) => this.toast.error(e.message));
  }
}
