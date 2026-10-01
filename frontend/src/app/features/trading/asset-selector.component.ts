import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MarketService } from '../../core/market.service';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { Asset } from '../../core/models';
import { pct, price } from '../../core/format';

@Component({
  selector: 'app-asset-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'open.set(false)' },
  imports: [FormsModule, IconComponent],
  template: `
    <button class="trigger" (click)="open.set(!open())" [attr.aria-expanded]="open()">
      <span class="coin" [attr.data-cat]="current()?.category">{{ current()?.icon || current()?.name?.[0] || '?' }}</span>
      <span class="name">{{ current()?.name ?? symbol() }}</span>
      <app-icon name="chevron-down" [size]="14" [class.flip]="open()" />
    </button>

    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="panel anim-pop">
        <div class="search">
          <app-icon name="search" [size]="18" />
          <input placeholder="Search assets" [ngModel]="q()" (ngModelChange)="q.set($event)" autofocus />
        </div>
        <div class="cats">
          @for (c of cats; track c.id) {
            <button [class.on]="cat() === c.id" (click)="cat.set(c.id)">{{ c.label }}</button>
          }
        </div>
        <div class="list">
          @for (a of list(); track a.symbol) {
            <div class="row" [class.on]="a.symbol === symbol()" (click)="pick(a)">
              <button class="star" [class.pinned]="isPinned(a.symbol)" (click)="togglePin(a.symbol, $event)" [attr.aria-label]="isPinned(a.symbol) ? 'Unpin' : 'Pin'">
                <app-icon [name]="isPinned(a.symbol) ? 'star-fill' : 'star'" [size]="18" />
              </button>
              <span class="coin sm" [attr.data-cat]="a.category">{{ a.icon || a.name[0] }}</span>
              <span class="a-name">{{ a.name }}<small>{{ a.source === 'otc' ? 'OTC' : 'Live' }}{{ a.fresh ? '' : ' · paused' }}</small></span>
              <span class="a-price num">{{ a.priceText }}</span>
              <span class="a-chg num" [class.up-text]="a.up" [class.down-text]="!a.up">{{ a.chg }}</span>
              @if (mode() === 'otc') { <span class="payout">{{ a.payout }}%</span> }
            </div>
          } @empty {
            <div class="empty">No assets match “{{ q() }}”</div>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './asset-selector.component.scss',
})
export class AssetSelectorComponent {
  private market = inject(MarketService);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly symbol = input.required<string>();
  readonly mode = input<'otc' | 'cfd'>('otc');
  readonly selected = output<string>();

  protected open = signal(false);
  protected q = signal('');
  protected cat = signal<'all' | Asset['category'] | 'pinned'>('all');
  protected cats: { id: 'all' | Asset['category'] | 'pinned'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pinned', label: '★' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'currency', label: 'Forex' },
    { id: 'commodity', label: 'Commodities' },
    { id: 'stock', label: 'Stocks' },
    { id: 'index', label: 'Indices' },
  ];

  protected current = computed(() => this.market.asset(this.symbol()));

  protected list = computed(() => {
    const q = this.q().trim().toLowerCase();
    const cat = this.cat();
    const pins = this.auth.user()?.pinnedAssets ?? [];
    const summary = this.market.summary();
    return this.market
      .assets()
      .filter((a) => (this.mode() === 'cfd' ? !!a.cfd : true))
      .filter((a) => (cat === 'all' ? true : cat === 'pinned' ? pins.includes(a.symbol) : a.category === cat))
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q))
      .map((a) => {
        const s = summary.get(a.symbol);
        const ch = s?.changePct ?? a.changePct;
        return { ...a, priceText: price(s?.price ?? a.price, a.precision), chg: pct(ch), up: ch >= 0 };
      })
      .sort((a, b) => (this.mode() === 'otc' ? b.payout - a.payout : 0));
  });

  protected isPinned(s: string) {
    return (this.auth.user()?.pinnedAssets ?? []).includes(s);
  }

  protected async togglePin(symbol: string, ev: Event) {
    ev.stopPropagation();
    const pins = this.auth.user()?.pinnedAssets ?? [];
    const next = pins.includes(symbol) ? pins.filter((p) => p !== symbol) : [...pins, symbol].slice(-12);
    this.auth.patchUser({ pinnedAssets: next });
    try {
      await this.api.put('/me/pins', { symbols: next });
    } catch {
      this.auth.patchUser({ pinnedAssets: pins });
      this.toast.error('Could not update pinned assets');
    }
  }

  protected pick(a: Asset) {
    this.selected.emit(a.symbol);
    this.open.set(false);
    this.q.set('');
  }
}
