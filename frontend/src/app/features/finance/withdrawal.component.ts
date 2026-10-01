import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AccountService } from '../../core/account.service';
import { AuthService } from '../../core/auth.service';
import { SocketService } from '../../core/socket.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { ApiError, Withdrawal, WithdrawalPopupConfig } from '../../core/models';
import { METHOD_LABELS, STATUS_LABELS, dateTime, money, statusTone } from '../../core/format';

@Component({
  selector: 'app-withdrawal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RouterLink],
  template: `
    <div class="fin-grid">
      <div class="main">
        @if (!auth.user()?.emailVerified) {
          <div class="gate card-solid anim-rise">
            <app-icon name="lock" [size]="28" />
            <div><b>Verify your e-mail to withdraw</b><p class="muted">We sent a link to {{ auth.user()?.email }}. For your security, withdrawals are enabled once your e-mail is confirmed.</p></div>
            <button class="btn btn-primary" (click)="resend()" [disabled]="sent()">{{ sent() ? 'Link sent' : 'Resend link' }}</button>
          </div>
        }
        <div class="card-solid anim-rise">
          <div class="balances">
            <div><span>Available to withdraw</span><b class="up-text">{{ money(accounts.real()?.balance ?? 0) }}</b></div>
            <div><span>Bonus funds (not withdrawable)</span><b>{{ money(accounts.real()?.bonusBalance ?? 0) }}</b></div>
          </div>
          <div class="seg3">
            @for (m of methods; track m.id) {
              <button [class.on]="method() === m.id" (click)="method.set(m.id)"><b>{{ m.label }}</b><small>{{ m.eta }}</small></button>
            }
          </div>
          <div class="field">
            <label>Amount (USD)</label>
            <div class="with-max">
              <input class="input big num" type="number" min="10" [ngModel]="amount()" (ngModelChange)="amount.set($event)" />
              <button class="btn btn-soft sm" (click)="amount.set((accounts.real()?.balance ?? 0) / 100)">Max</button>
            </div>
            <span class="hint">Minimum {{ money(minW()) }} · No commission@if (method() === 'mpesa') { · ≈ KES {{ kes().toLocaleString() }} }</span>
          </div>
          @if (method() === 'mpesa') {
            <div class="field"><label>M-Pesa number (in your name)</label><input class="input big" inputmode="tel" placeholder="07XX XXX XXX" [ngModel]="phone()" (ngModelChange)="phone.set($event)" /></div>
          } @else {
            <div class="field"><label>{{ method() === 'usdt_trc20' ? 'TRON (TRC-20)' : 'BNB Smart Chain (BEP20)' }} wallet address</label>
              <input class="input big" [placeholder]="method() === 'usdt_trc20' ? 'T…' : '0x…'" [ngModel]="address()" (ngModelChange)="address.set($event)" /></div>
          }
          @if (error()) { <div class="alert">{{ error() }}</div> }
          <button class="btn btn-primary lg block" (click)="submit()" [disabled]="busy() || !auth.user()?.emailVerified">
            @if (busy()) { <span class="spinner"></span> } @else { Request withdrawal }
          </button>
          <p class="muted small">Requests are reviewed by our finance team, usually within a few hours. Funds are deducted from your balance once the withdrawal is approved.</p>
        </div>

        <h3 class="sub-title">Your withdrawals</h3>
        <div class="card-solid table-wrap flush">
          <table class="table">
            <thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Destination</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (w of list(); track w.id) {
                <tr>
                  <td>{{ dt(w.createdAt) }}</td><td>{{ label(w.method) }}</td><td class="num">{{ money(w.amount) }}</td>
                  <td class="muted">{{ w.phone ?? (w.address ? w.address.slice(0, 10) + '…' : '') }}</td>
                  <td><span class="badge" [class]="tone(w.status)">{{ status(w.status) }}</span>@if (w.reviewNote) { <small class="muted note">{{ w.reviewNote }}</small> }</td>
                  <td>@if (w.status === 'pending_review') { <button class="btn btn-soft sm" (click)="cancel(w)">Cancel</button> }</td>
                </tr>
              } @empty {
                <tr><td colspan="6"><div class="empty">No withdrawals yet</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
      <aside class="info">
        <div class="info-card">
          <div class="row"><span>Minimum withdrawal:</span><b>{{ money(minW()) }}</b></div>
          <div class="row"><span>Commission:</span><b class="up-text">No commission</b></div>
          <div class="row"><span>Identity:</span><b>{{ auth.user()?.kycStatus === 'approved' ? 'Verified' : 'Not verified' }}</b></div>
        </div>
        <p class="muted">Withdrawals are paid only to accounts in your own name.</p>
        <a routerLink="/app/profile">Verify identity</a>
      </aside>
    </div>

    @if (showPopup() && displayPopup(); as p) {
      <div class="popup-backdrop" (click)="!p.blocking && showPopup.set(false)"></div>
      <div class="w-user-popup-modal anim-pop" [class]="'tone-' + p.type">
        <header>
          <div class="p-title">
            <app-icon [name]="p.type === 'error' ? 'close' : p.type === 'warning' ? 'alert' : p.type === 'success' ? 'check' : 'info'" [size]="24" />
            <h3>{{ p.title || 'Withdrawal Notice' }}</h3>
          </div>
          @if (!p.blocking) {
            <button class="icon-btn" (click)="showPopup.set(false)"><app-icon name="close" [size]="16" /></button>
          }
        </header>
        <div class="p-body">
          <p class="p-msg">{{ p.message }}</p>
          @if (p.blocking) {
            <div class="p-block-notice">
              <app-icon name="lock" [size]="18" />
              <span>Withdrawals are currently locked for your account.</span>
            </div>
          }
        </div>
        <footer>
          <button class="btn btn-primary block lg" (click)="handlePopupAction(p.buttonAction)">
            {{ p.buttonText || 'Understood' }}
          </button>
        </footer>
      </div>
    }
  `,
  styleUrl: './finance.scss',
})
export class WithdrawalComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  protected accounts = inject(AccountService);
  protected auth = inject(AuthService);
  private socket = inject(SocketService);
  private toast = inject(ToastService);

  protected methods = [
    { id: 'mpesa' as const, label: 'M-Pesa', eta: 'B2C · minutes' },
    { id: 'usdt_trc20' as const, label: 'USDT TRC-20', eta: 'Manual · hours' },
    { id: 'usdt_bep20' as const, label: 'USDT BEP20', eta: 'Manual · hours' },
  ];
  protected method = signal<'mpesa' | 'usdt_trc20' | 'usdt_bep20'>('mpesa');
  protected amount = signal(10);
  protected phone = signal(this.auth.user()?.phone ?? '');
  protected address = signal('');
  protected busy = signal(false);
  protected sent = signal(false);
  protected error = signal<string | null>(null);
  protected list = signal<Withdrawal[]>([]);
  protected kes = computed(() => Math.floor(Number(this.amount() || 0) * 129));
  protected money = money;
  /** Minimum withdrawal set by admins (cents); updates live when they change it. */
  protected minW = signal(1000);
  protected dt = dateTime;
  protected tone = statusTone;
  protected status = (s: string) => STATUS_LABELS[s] ?? s;
  protected label = (m: string) => METHOD_LABELS[m] ?? m;

  // Admin configurable withdrawal popup & display state
  protected popup = signal<WithdrawalPopupConfig | null>(null);
  protected displayPopup = signal<WithdrawalPopupConfig | null>(null);
  protected showPopup = signal(false);

  constructor() {
    void this.api.get<Withdrawal[]>('/finance/withdrawals').then((l) => this.list.set(l));
    const loadLimits = () => void this.api.get<{ limits: { minWithdrawal: number } }>('/finance/methods').then((r) => this.minW.set(r.limits.minWithdrawal));
    loadLimits();
    const offLimits = this.socket.on<{ minWithdrawal: number }>('settings:limits', (l) => this.minW.set(l.minWithdrawal));
    inject(DestroyRef).onDestroy(offLimits);

    const loadPopup = () => {
      void this.api.get<{ active: boolean; popup: WithdrawalPopupConfig | null }>('/finance/withdrawal-popup').then((res) => {
        if (res?.active && res.popup) {
          this.popup.set(res.popup);
        } else {
          this.popup.set(null);
        }
      });
    };
    loadPopup();
    const offPopup = this.socket.on('settings:withdrawal-popup', () => loadPopup());
    inject(DestroyRef).onDestroy(offPopup);

    const off = this.socket.on<Withdrawal>('withdrawal:update', (w) => {
      this.list.update((l) => (l.some((x) => x.id === w.id) ? l.map((x) => (x.id === w.id ? w : x)) : [w, ...l]));
      if (w.status === 'paid') this.toast.success(`Withdrawal of ${money(w.amount)} paid`);
      if (w.status === 'rejected' || w.status === 'failed') this.toast.error(`Withdrawal ${w.status}: funds returned to your balance`);
    });
    inject(DestroyRef).onDestroy(off);
  }

  protected async submit() {
    // If the admin configured a blocking notice, show the popup now upon clicking the withdrawal button
    if (this.popup()?.blocking) {
      this.displayPopup.set(this.popup());
      this.showPopup.set(true);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const created = await this.api.post<Withdrawal>('/finance/withdrawals', {
        method: this.method(),
        amount: Math.round(Number(this.amount()) * 100),
        phone: this.method() === 'mpesa' ? this.phone() : undefined,
        address: this.method() !== 'mpesa' ? this.address() : undefined,
      });
      if (created) {
        this.list.update((l) => [created, ...l]);
      }

      // Show popup instead of toast notification
      const activeCustom = this.popup();
      if (activeCustom && activeCustom.enabled) {
        this.displayPopup.set(activeCustom);
      } else {
        this.displayPopup.set({
          enabled: true,
          title: 'Withdrawal Received',
          message: 'Your withdrawal request has been received and is pending review by our finance team. Your balance will be deducted once the withdrawal is approved.',
          type: 'success',
          blocking: false,
          buttonText: 'Understood',
          buttonAction: 'close',
        });
      }
      this.showPopup.set(true);
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected handlePopupAction(action?: string) {
    this.showPopup.set(false);
    if (action === 'support') {
      void this.router.navigate(['/app/help']);
    } else if (action === 'kyc') {
      void this.router.navigate(['/app/profile']);
    } else if (action === 'deposit') {
      void this.router.navigate(['/app/finance/deposit']);
    }
  }

  protected async cancel(w: Withdrawal) {
    await this.api.post(`/finance/withdrawals/${w.id}/cancel`).catch((e: ApiError) => this.toast.error(e.message));
  }

  protected async resend() {
    await this.api.post('/auth/resend-verification');
    this.sent.set(true);
    this.toast.info('Verification e-mail sent');
  }
}

