import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { SoundService, UiService } from '../../core/ui.service';
import { AccountService } from '../../core/account.service';
import { IconComponent } from '../../shared/icon.component';
import { ApiError, BonusOverview, CryptoCoin, Deposit, PaymentMethod } from '../../core/models';
import { CoinIconComponent } from '../../shared/coin-icon.component';
import { money } from '../../core/format';

interface MethodsResponse {
  country: string;
  methods: PaymentMethod[];
  limits: { minDeposit: number; maxDeposit?: number; minWithdrawal: number };
  kesPerUsd: number;
  commission: number;
}

export const COUNTRIES = [
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'IN', name: 'India' },
  { code: 'OT', name: 'Other' },
];

@Component({
  selector: 'app-deposit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RouterLink, CoinIconComponent],
  templateUrl: './deposit.component.html',
  styleUrl: './finance.scss',
})
export class DepositComponent {
  private api = inject(ApiService);
  private socket = inject(SocketService);
  protected auth = inject(AuthService);
  private toast = inject(ToastService);
  protected ui = inject(UiService);
  private sound = inject(SoundService);
  private accounts = inject(AccountService);

  protected countries = COUNTRIES;
  protected step = signal<1 | 2 | 3>(1);
  protected country = signal(this.auth.user()?.country ?? 'KE');
  protected data = signal<MethodsResponse | null>(null);
  protected bonus = signal<BonusOverview | null>(null);
  protected q = signal('');
  protected view = signal<'grid' | 'list'>('grid');
  protected showAll = signal(false);
  protected method = signal<PaymentMethod | null>(null);
  protected amount = signal(50);
  protected phone = signal(this.auth.user()?.phone ?? '');
  protected offer = signal<'first50' | 'welcome100' | null>(null);
  protected termsOpen = signal<string | null>(null);
  protected acceptTerms = signal(false);
  protected box = signal(false);
  protected busy = signal(false);
  protected error = signal<string | null>(null);
  protected dep = signal<Deposit | null>(null);
  protected txHash = signal('');
  protected money = money;
  protected result = (code: string | null | undefined) => DEPOSIT_RESULT[code ?? 'error'] ?? DEPOSIT_RESULT['error']!;
  protected chips = computed(() => {
    const minCents = this.method()?.minDeposit ?? this.data()?.limits?.minDeposit ?? 1000;
    const min = minCents % 100 === 0 ? minCents / 100 : Number((minCents / 100).toFixed(2));
    const base = [10, 25, 50, 100, 250, 500];
    return [min, ...base.filter((c) => c !== min)];
  });

  protected methods = computed(() => {
    const list = this.data()?.methods ?? [];
    const q = this.q().trim().toLowerCase();
    const filtered = list.filter((m) => !q || m.name.toLowerCase().includes(q));
    return this.showAll() || q ? filtered : filtered.filter((m) => m.popular).slice(0, 6);
  });
  protected cents = computed(() => Math.round(Number(this.amount() || 0) * 100));
  protected kes = computed(() => Math.ceil((this.cents() / 100) * (this.data()?.kesPerUsd ?? 129)));
  protected selectedOffer = computed(() => this.bonus()?.offers.find((o) => o.key === this.offer()) ?? null);
  protected bonusAmount = computed(() => {
    const o = this.selectedOffer();
    if (!o || this.cents() < o.minDeposit) return 0;
    return Math.min(o.maxBonus, Math.floor((this.cents() * o.pct) / 100));
  });
  protected boxEligible = computed(() => !!this.bonus()?.tradersBox.enabled && !!this.bonus()?.tradersBox.eligible && this.cents() >= (this.bonus()?.tradersBox.minDeposit ?? 0));
  protected valid = computed(() => {
    const m = this.method();
    if (!m) return false;
    if (this.cents() < m.minDeposit) return false;
    if (this.cents() > (this.data()?.limits.maxDeposit ?? Infinity)) return false;
    if (m.id === 'mpesa' && !/^(\+?254|0)?[17]\d{8}$/.test(this.phone().replace(/\s/g, ''))) return false;
    if (this.offer() && !this.acceptTerms()) return false;
    return true;
  });

  constructor() {
    void this.load();
    const off = this.socket.on<Deposit>('deposit:update', (d) => {
      if (d.id !== this.dep()?.id) return;
      this.applyUpdate(d);
    });
    // Fallback if a socket event is missed: re-check an open deposit every 4 s until it is final.
    const poll = setInterval(async () => {
      const d = this.dep();
      if (!d || !['pending', 'processing'].includes(d.status)) return;
      try {
        this.applyUpdate(await this.api.get<Deposit>(`/finance/deposits/${d.id}`));
      } catch {
        /* network blip: try again next tick */
      }
    }, 2000);
    // Admin changed the limits: refresh minimums / maximums on screen right away.
    const offLimits = this.socket.on<{ minDeposit: number; maxDeposit: number; minWithdrawal: number }>('settings:limits', () => void this.load());
    inject(DestroyRef).onDestroy(() => {
      offLimits();
      off();
      clearInterval(poll);
    });
  }

  /** Only a confirmed provider callback turns a deposit "completed"; then the balance refreshes instantly. */
  private applyUpdate(d: Deposit) {
    const prev = this.dep();
    if (!prev || prev.status === d.status) {
      if (prev) this.dep.set({ ...prev, ...d });
      return;
    }
    this.dep.set({ ...prev, ...d });
    if (d.status === 'completed') {
      this.sound.playDeposit();
      this.toast.success(`Deposit of ${money(d.amount)} credited`);
      void this.accounts.load();
    } else if (d.status === 'failed' || d.status === 'cancelled') {
      this.sound.playLoss();
    }
  }

  protected async load() {
    const [m, b] = await Promise.all([this.api.get<MethodsResponse>('/finance/methods', { country: this.country() }), this.api.get<BonusOverview>('/bonuses')]);
    this.data.set(m);
    this.bonus.set(b);
  }

  protected setCountry(c: string) {
    this.country.set(c);
    void this.load();
  }

  protected logoText(logo: string, name: string) {
    const map: Record<string, string> = { mpesa: 'M-PESA', crypto: '₿', usdt: '₮', visa: 'VISA', bybit: 'BYBIT', airtel: 'airtel' };
    return map[logo] ?? name[0];
  }

  protected pick(m: PaymentMethod) {
    if (!m.available) return; // locked methods cannot be selected
    this.method.set(m);
    this.amount.set(m.id === 'crypto' ? 100 : Math.max(this.amount(), m.minDeposit / 100));
    this.step.set(2);
    this.error.set(null);
    if (m.id === 'crypto') void this.loadCoins();
  }

  // ---------------- Cryptocurrency deposits ----------------
  protected cryptoChips = computed(() => {
    const minCents = this.method()?.minDeposit ?? this.data()?.limits?.minDeposit ?? 1000;
    const min = minCents % 100 === 0 ? minCents / 100 : Number((minCents / 100).toFixed(2));
    const base = [50, 100, 250, 500, 1000];
    return [min, ...base.filter((c) => c !== min)];
  });
  protected coins = signal<CryptoCoin[] | null>(null);
  protected copied = signal(false);
  private coinTimer: ReturnType<typeof setTimeout> | undefined;

  /** Coins + approximate amount of each coin for the chosen USD amount. */
  private async loadCoins() {
    try {
      this.coins.set(await this.api.get<CryptoCoin[]>('/finance/crypto', { amount: this.cents() }));
    } catch {
      this.coins.set([]);
    }
  }

  protected setCryptoAmount(v: number | string) {
    this.amount.set(Number(v) || 0);
    clearTimeout(this.coinTimer);
    this.coinTimer = setTimeout(() => void this.loadCoins(), 350);
  }

  protected async pickCoin(c: CryptoCoin) {
    const m = this.method();
    if (!m || this.busy()) return;
    if (this.cents() < m.minDeposit) {
      this.error.set(`Minimum deposit is $${m.minDeposit / 100}`);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const d = await this.api.post<Deposit>('/finance/deposits', { method: 'crypto', coin: c.code, amount: this.cents(), country: this.country() });
      this.dep.set(d);
      this.copied.set(false);
      this.step.set(3);
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected fmtCoin(n: number | null | undefined) {
    if (n == null) return '';
    return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : n.toPrecision(4);
  }

  protected shortAddr(a: string) {
    return a.length > 22 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a;
  }

  /** Copy that also works on plain http (e.g. testing on a phone over Wi-Fi), where navigator.clipboard is missing. */
  protected async copyAddress(text: string) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      /* fall back below */
    }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    }
    if (ok) {
      this.copied.set(true);
      this.sound.playClick();
      this.toast.success('Address copied');
      setTimeout(() => this.copied.set(false), 2500);
    } else this.toast.error('Could not copy. Please long-press the address to copy it.');
  }

  protected toggleOffer(k: 'first50' | 'welcome100') {
    this.offer.set(this.offer() === k ? null : k);
    this.acceptTerms.set(false);
    this.termsOpen.set(this.offer());
  }

  protected async submit() {
    const m = this.method();
    if (!m || !this.valid()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const d = await this.api.post<Deposit>('/finance/deposits', {
        method: m.id,
        amount: this.cents(),
        phone: m.id === 'mpesa' ? this.phone() : undefined,
        bonusOffer: this.offer(),
        bonusTermsVersion: this.offer() ? this.bonus()?.termsVersion : undefined,
        tradersBox: this.box() && this.boxEligible(),
        country: this.country(),
      });
      this.dep.set(d);
      this.step.set(3);
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async submitTx() {
    const d = this.dep();
    if (!d) return;
    this.busy.set(true);
    try {
      this.dep.set({ ...d, ...(await this.api.post<Deposit>(`/finance/deposits/${d.id}/tx`, { txHash: this.txHash().trim() })) });
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(text: string) {
    void navigator.clipboard?.writeText(text).then(() => this.toast.info('Copied to clipboard'));
  }

  protected restart() {
    this.step.set(1);
    this.dep.set(null);
    this.method.set(null);
    this.offer.set(null);
    this.acceptTerms.set(false);
    this.box.set(false);
    this.txHash.set('');
    this.coins.set(null);
    void this.load();
  }

  protected pctText(p: number) {
    return p >= 0.1 ? `${(p * 100).toFixed(0)}%` : `${(p * 100).toFixed(1)}%`;
  }
}

/** Title + icon for each M-Pesa result, shown instantly on the payment screen. */
export const DEPOSIT_RESULT: Record<string, { title: string; icon: string }> = {
  cancelled: { title: 'Payment cancelled', icon: 'close' },
  insufficient_funds: { title: 'Insufficient M-Pesa balance', icon: 'wallet' },
  wrong_pin: { title: 'Wrong M-Pesa PIN', icon: 'lock' },
  timeout: { title: 'M-Pesa prompt expired', icon: 'clock' },
  unreachable: { title: 'Phone not reachable', icon: 'warn' },
  busy: { title: 'M-Pesa is busy on your line', icon: 'clock' },
  amount_mismatch: { title: 'Amount did not match', icon: 'warn' },
  error: { title: 'Payment not completed', icon: 'warn' },
};
