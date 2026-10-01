import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { TradesService } from '../../core/trades.service';
import { MarketService } from '../../core/market.service';
import { IconComponent } from '../../shared/icon.component';
import { CountdownRingComponent } from '../../shared/countdown-ring.component';
import { TradeDetailComponent } from './trade-detail.component';
import { Trade } from '../../core/models';
import { clock, money, price, signedMoney } from '../../core/format';
import { AuthService } from '../../core/auth.service';

const ROW_H = 76;

@Component({
  selector: 'app-trades-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CountdownRingComponent, TradeDetailComponent],
  templateUrl: './trades-panel.component.html',
  styleUrl: './trades-panel.component.scss',
})
export class TradesPanelComponent {
  protected trades = inject(TradesService);
  protected market = inject(MarketService);
  private auth = inject(AuthService);
  protected tab = signal<'open' | 'closed'>('open');
  protected detail = signal<Trade | null>(null);
  protected money = money;
  protected signed = signedMoney;
  protected price = price;

  // --- virtual scroll for the closed list ---
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  protected scrollTop = signal(0);
  protected viewH = signal(600);
  protected loadingMore = signal(false);
  private exhausted = false;
  protected readonly ROW_H = ROW_H;
  protected window = computed(() => {
    const list = this.trades.closed();
    const start = Math.max(0, Math.floor(this.scrollTop() / ROW_H) - 4);
    const end = Math.min(list.length, Math.ceil((this.scrollTop() + this.viewH()) / ROW_H) + 4);
    return { items: list.slice(start, end), offset: start * ROW_H, total: list.length * ROW_H };
  });

  protected openCount = computed(() => this.trades.open().length);

  protected projected(t: Trade) {
    const p = this.market.price(t.symbol)();
    if (p == null || p === t.openPrice) return { text: '±$0.00', cls: '' };
    const winning = t.direction === 'up' ? p > t.openPrice : p < t.openPrice;
    return winning ? { text: signedMoney(Math.floor((t.amount * t.payoutPct) / 100)), cls: 'up-text' } : { text: signedMoney(-t.amount), cls: 'down-text' };
  }

  protected timeOf(iso: string | null) {
    return iso ? clock(new Date(iso).getTime(), this.auth.user()?.timezoneOffset ?? 180) : '';
  }

  protected name(symbol: string) {
    return this.market.asset(symbol)?.name ?? symbol;
  }
  protected precision(symbol: string) {
    return this.market.asset(symbol)?.precision ?? 2;
  }

  protected async onScroll(ev: Event) {
    const el = ev.target as HTMLElement;
    this.scrollTop.set(el.scrollTop);
    this.viewH.set(el.clientHeight);
    if (!this.exhausted && !this.loadingMore() && el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 4) {
      this.loadingMore.set(true);
      const n = await this.trades.loadMoreClosed().finally(() => this.loadingMore.set(false));
      if (n === 0) this.exhausted = true;
    }
  }

  protected setTab(t: 'open' | 'closed') {
    this.tab.set(t);
    this.exhausted = false;
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) this.viewH.set(el.clientHeight);
    });
  }
}
