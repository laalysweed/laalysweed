import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AccountService } from '../../core/account.service';
import { MarketService } from '../../core/market.service';
import { TradeDetailComponent } from '../trading/trade-detail.component';
import { Trade } from '../../core/models';
import { dateTime, money, price, signedMoney } from '../../core/format';

@Component({
  selector: 'app-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TradeDetailComponent],
  template: `
    <div class="page">
      <h1>Trading history</h1>
      <div class="bar">
        <div class="accs">
          @for (a of accounts.accounts(); track a.id) {
            <button [class.on]="accountId() === a.id" (click)="accountId.set(a.id)">{{ accounts.label(a) }}</button>
          }
        </div>
        <select class="input sm" [ngModel]="symbol()" (ngModelChange)="symbol.set($event)">
          <option value="">All assets</option>
          @for (a of market.assets(); track a.symbol) { <option [value]="a.symbol">{{ a.name }}</option> }
        </select>
      </div>
      <div class="grid-4">
        <div class="card-solid"><span>Trades</span><b>{{ summary().n }}</b></div>
        <div class="card-solid"><span>Win rate</span><b>{{ summary().winRate }}%</b></div>
        <div class="card-solid"><span>Volume</span><b>{{ money(summary().volume) }}</b></div>
        <div class="card-solid"><span>Net result</span><b [class.up-text]="summary().profit >= 0" [class.down-text]="summary().profit < 0">{{ signed(summary().profit) }}</b></div>
      </div>
      <div class="card-solid table-wrap flush">
        <table class="table stack">
          <thead><tr><th>Opened</th><th>Asset</th><th>Direction</th><th>Amount</th><th>Duration</th><th>Open → Close</th><th>Result</th></tr></thead>
          <tbody>
            @for (t of rows(); track t.id) {
              <tr (click)="detail.set(t)" class="click">
                <td data-label="Opened">{{ dt(t.openedAt) }}</td>
                <td data-label="Asset">{{ market.asset(t.symbol)?.name ?? t.symbol }}</td>
                <td data-label="Direction"><span class="badge" [class.green]="t.direction === 'up'" [class.red]="t.direction === 'down'">{{ t.direction === 'up' ? '▲ BUY' : '▼ SELL' }}</span></td>
                <td data-label="Amount" class="num">{{ money(t.amount) }}</td>
                <td data-label="Duration">{{ t.durationSec }}s</td>
                <td data-label="Open → Close" class="num muted">{{ price(t.openPrice, prec(t.symbol)) }} → {{ price(t.closePrice, prec(t.symbol)) }}</td>
                <td data-label="Result" class="num"><b [class.up-text]="t.profit > 0" [class.down-text]="t.profit < 0">{{ signed(t.profit) }}</b></td>
              </tr>
            } @empty {
              <tr><td colspan="7"><div class="empty">{{ loading() ? 'Loading…' : 'No closed trades on this account yet' }}</div></td></tr>
            }
          </tbody>
        </table>
        @if (more()) { <button class="btn btn-soft block" (click)="loadMore()">Load more</button> }
      </div>
    </div>
    @if (detail(); as d) { <app-trade-detail [tradeId]="d.id" (closed)="detail.set(null)" /> }
  `,
  styles: [
    `.bar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px}.bar select{width:220px}
     .accs{display:flex;gap:8px;flex-wrap:wrap}.accs button{height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--border-strong);background:rgba(22,28,42,.9);font-weight:600}
     .accs button.on{border-color:var(--primary);background:rgba(47,128,237,.18)}
     .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}@media(max-width:900px){.grid-4{grid-template-columns:repeat(2,1fr)}}
     .grid-4 span{display:block;color:var(--muted);font-size:13px}.grid-4 b{font-size:22px}
     .card-solid{background:rgba(22,28,42,.92)}.flush{padding:4px}.click{cursor:pointer}.empty{padding:40px;text-align:center;color:var(--muted)}`,
  ],
})
export class HistoryComponent {
  private api = inject(ApiService);
  protected accounts = inject(AccountService);
  protected market = inject(MarketService);
  protected accountId = signal<string | null>(null);
  protected symbol = signal('');
  protected rows = signal<Trade[]>([]);
  protected loading = signal(false);
  protected more = signal(false);
  protected detail = signal<Trade | null>(null);
  protected money = money;
  protected signed = signedMoney;
  protected price = price;
  protected dt = dateTime;
  protected prec = (s: string) => this.market.asset(s)?.precision ?? 2;

  protected summary = computed(() => {
    const r = this.rows();
    const wins = r.filter((t) => t.status === 'won').length;
    return { n: r.length, winRate: r.length ? Math.round((wins / r.length) * 100) : 0, volume: r.reduce((s, t) => s + t.amount, 0), profit: r.reduce((s, t) => s + t.profit, 0) };
  });

  constructor() {
    void this.market.loadAssets();
    effect(() => {
      if (!this.accountId() && this.accounts.active()) this.accountId.set(this.accounts.active()!.id);
    });
    effect(() => {
      const acc = this.accountId();
      const sym = this.symbol();
      if (acc) untracked(() => void this.load(acc, sym));
    });
  }

  private async load(accountId: string, symbol: string, before?: string) {
    this.loading.set(true);
    try {
      const list = await this.api.get<Trade[]>('/trades', { status: 'closed', accountId, symbol: symbol || undefined, limit: 100, before });
      this.rows.set(before ? [...this.rows(), ...list] : list);
      this.more.set(list.length === 100);
    } finally {
      this.loading.set(false);
    }
  }

  protected loadMore() {
    const last = this.rows()[this.rows().length - 1];
    if (last && this.accountId()) void this.load(this.accountId()!, this.symbol(), last.openedAt);
  }
}
