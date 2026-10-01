import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiService } from '../../core/ui.service';
import { TradesService } from '../../core/trades.service';
import { AccountService } from '../../core/account.service';
import { ToastService } from '../../core/toast.service';
import { ApiService } from '../../core/api.service';
import { MarketService } from '../../core/market.service';
import { IconComponent } from '../../shared/icon.component';
import { SpotlightDirective } from '../../core/spotlight';
import { ApiError, Asset, Direction, Signal } from '../../core/models';
import { duration, money, price } from '../../core/format';

const PRESETS = [5, 15, 30, 60, 120, 300, 900, 1800, 3600, 14400];
const CHIPS = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000];

@Component({
  selector: 'app-trade-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RouterLink, SpotlightDirective],
  templateUrl: './trade-panel.component.html',
  styleUrl: './trade-panel.component.scss',
})
export class TradePanelComponent {
  protected ui = inject(UiService);
  protected trades = inject(TradesService);
  protected accounts = inject(AccountService);
  private toast = inject(ToastService);
  private api = inject(ApiService);
  private market = inject(MarketService);

  readonly asset = input<Asset | undefined>();
  readonly compact = input(false);

  protected presets = PRESETS;
  protected chips = CHIPS;
  protected timeOpen = signal(false);
  protected amountOpen = signal(false);
  protected aiOpen = signal(false);
  protected aiSignal = signal<Signal | null>(null);
  protected aiStats = signal<{ accuracy: number | null; hit: number; miss: number } | null>(null);
  protected aiLoading = signal(false);
  protected pressed = signal<Direction | null>(null);
  protected money = money;
  protected price = price;
  protected String = String;

  protected timeText = computed(() => duration(this.ui.durationSec()));
  protected amountText = computed(() => (this.ui.amount() / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  protected payoutPct = computed(() => this.asset()?.payout ?? 0);
  protected profit = computed(() => Math.floor((this.ui.amount() * this.payoutPct()) / 100));
  protected insufficient = computed(() => this.ui.amount() > this.accounts.available());
  protected tradable = computed(() => !!this.asset()?.fresh || this.market.summary().get(this.asset()?.symbol ?? '')?.fresh);

  protected h = computed(() => Math.floor(this.ui.durationSec() / 3600));
  protected m = computed(() => Math.floor((this.ui.durationSec() % 3600) / 60));
  protected s = computed(() => this.ui.durationSec() % 60);

  protected label(sec: number) {
    return sec < 60 ? `S${sec}` : sec < 3600 ? `M${sec / 60}` : `H${sec / 3600}`;
  }

  protected setDuration(sec: number) {
    this.ui.durationSec.set(Math.min(14400, Math.max(5, Math.round(sec))));
  }
  protected adjust(unit: 'h' | 'm' | 's', delta: number) {
    const mult = unit === 'h' ? 3600 : unit === 'm' ? 60 : unit === 's' ? 5 : 1;
    this.setDuration(this.ui.durationSec() + delta * mult);
  }

  protected setAmount(cents: number) {
    const a = this.asset();
    const min = a?.minTrade ?? 100;
    const max = a?.maxTrade ?? 100000;
    this.ui.amount.set(Math.min(max, Math.max(min, Math.round(cents))));
  }
  protected onAmountInput(v: string) {
    const n = Number(String(v).replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) this.setAmount(Math.round(n * 100));
  }
  protected step(dir: 1 | -1) {
    const a = this.ui.amount();
    const inc = a < 1000 ? 100 : a < 10000 ? 500 : a < 50000 ? 2500 : 10000;
    this.setAmount(a + dir * inc);
  }

  protected hover(d: Direction | null) {
    this.ui.hoverDirection.set(d);
  }

  async place(direction: Direction, source: 'manual' | 'ai' = 'manual') {
    const a = this.asset();
    if (!a) return;
    if (this.insufficient()) {
      this.toast.error('Insufficient balance for this amount');
      return;
    }
    this.pressed.set(direction);
    setTimeout(() => this.pressed.set(null), 380);
    try {
      await this.trades.place({ symbol: a.symbol, direction, amount: this.ui.amount(), durationSec: this.ui.durationSec(), source });
      this.aiOpen.set(false);
    } catch (e) {
      this.toast.error((e as ApiError).message ?? 'Could not place trade');
    }
  }

  protected async openAi() {
    this.aiOpen.set(!this.aiOpen());
    if (!this.aiOpen()) return;
    const sym = this.asset()?.symbol;
    if (!sym) return;
    this.aiLoading.set(true);
    try {
      const [list, stats] = await Promise.all([this.api.get<Signal[]>('/signals', { symbol: sym }), this.api.get<{ accuracy: number | null; hit: number; miss: number }>('/signals/stats')]);
      this.aiSignal.set(list.find((s) => s.result === 'pending' && new Date(s.expiresAt).getTime() > Date.now()) ?? null);
      this.aiStats.set(stats);
    } finally {
      this.aiLoading.set(false);
    }
  }
}
