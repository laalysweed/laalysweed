import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AccountService } from '../../core/account.service';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { AnimatedNumberComponent } from '../../shared/animated-number.component';
import { SoundService } from '../../core/ui.service';
import { money } from '../../core/format';
import { Account, ApiError } from '../../core/models';

@Component({
  selector: 'app-account-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AnimatedNumberComponent, RouterLink],
  template: `
    <button class="trigger" (click)="open.set(!open())" [attr.aria-expanded]="open()">
      <span class="kind" [class.demo]="!isReal()" [class.real]="isReal()">{{ product() }} {{ accountTypeLabel() }} <span class="cur">USD</span></span>
      <span class="bal">
        <app-num [value]="accounts.available()" [flashOnChange]="true" />
        <app-icon name="chevron-down" [size]="14" [class.flip]="open()" />
      </span>
    </button>

    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="panel anim-pop" role="menu">
        <!-- CARD 1: OTC REAL (IMAGE 3) -->
        <div class="acc-card real-card" [class.active]="product() === 'OTC' && isReal()">
          <div class="acc-row" (click)="selectAccount('OTC', 'real')">
            <div class="acc-ico gold-ring">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="9" cy="12" r="5" stroke="#eab308" />
                <circle cx="15" cy="12" r="5" stroke="#eab308" />
              </svg>
            </div>
            <div class="acc-meta">
              <div class="acc-title">OTC Real</div>
              <div class="acc-bal">{{ fmt(realBalance()) }}</div>
            </div>
            <div class="cur-tag">USD</div>
          </div>

          <div class="acc-actions">
            <a class="btn-topup" routerLink="/app/finance/deposit" (click)="open.set(false)">
              <app-icon name="wallet" [size]="18" /> Top up
            </a>
            <a class="btn-sq" routerLink="/app/finance/deposit" (click)="open.set(false)" title="Deposit">
              <app-icon name="download" [size]="18" />
            </a>
            <button class="btn-sq" (click)="transferDemo()" title="Transfer">
              <app-icon name="transfer" [size]="18" />
            </button>
          </div>
        </div>

        <!-- CARD 2: OTC DEMO (IMAGE 3) -->
        <div class="acc-card" [class.active]="product() === 'OTC' && !isReal()" (click)="selectAccount('OTC', 'demo')">
          <div class="acc-row">
            <div class="acc-ico blue-cap">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" stroke="#38bdf8" />
                <path d="M6 12v5c3 3 9 3 12 0v-5" stroke="#38bdf8" />
              </svg>
            </div>
            <div class="acc-meta">
              <div class="acc-title">OTC Demo</div>
              <div class="acc-bal">{{ fmt(demoBalance()) }}</div>
            </div>
          </div>
        </div>

        <!-- CARD 3: CFD REAL (IMAGE 3) -->
        <div class="acc-card" [class.active]="product() === 'CFD' && isReal()" (click)="selectAccount('CFD', 'real')">
          <div class="acc-row">
            <div class="acc-ico green-shield">
              <app-icon name="shield" [size]="20" />
            </div>
            <div class="acc-meta">
              <div class="acc-title">CFD Real</div>
            </div>
          </div>
        </div>

        <!-- CARD 4: CFD DEMO (IMAGE 3) -->
        <div class="acc-card" [class.active]="product() === 'CFD' && !isReal()" (click)="selectAccount('CFD', 'demo')">
          <div class="acc-row">
            <div class="acc-ico green-shield">
              <app-icon name="shield" [size]="20" />
            </div>
            <div class="acc-meta">
              <div class="acc-title">CFD Demo</div>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: block;
      }
      .trigger {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        background: none;
        border: 0;
        padding: 4px 10px;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.18s ease;
      }
      .trigger:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .kind {
        font-size: 11.5px;
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 0.04em;
        white-space: nowrap;
        transition: color 0.18s ease;
      }
      .kind.demo {
        color: #38bdf8;
      }
      .kind.real {
        color: #eab308;
      }
      .cur {
        margin-left: 6px;
        color: #64748b;
      }
      .bal {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 21px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: -0.01em;
      }
      .bal app-icon {
        color: #94a3b8;
        transition: transform 0.22s ease;
      }
      .bal app-icon.flip {
        transform: rotate(180deg);
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 60;
      }

      /* PANEL MATCHING IMAGE 3 */
      .panel {
        position: absolute;
        z-index: 61;
        right: 0;
        top: calc(100% + 8px);
        width: 320px;
        padding: 10px;
        border-radius: 16px;
        background: #141c2b;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 16px 45px rgba(0, 0, 0, 0.7);
        display: flex;
        flex-direction: column;
        gap: 8px;
        transform-origin: top right;
      }

      .acc-card {
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        cursor: pointer;
        transition: all 180ms ease;
      }
      .acc-card:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
      }
      .acc-card.active {
        border-color: rgba(56, 189, 248, 0.35);
        background: rgba(56, 189, 248, 0.06);
      }

      .acc-row {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .acc-ico {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }

      .gold-ring {
        background: #231d10;
        border: 1.5px solid #785a15;
      }

      .blue-cap {
        background: #13273e;
        border: 1.5px solid #1e40af;
      }

      .green-shield {
        background: #10291d;
        border: 1.5px solid #166534;
        color: #22c55e;
      }

      .acc-meta {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .acc-title {
        font-size: 15px;
        font-weight: 700;
        color: #ffffff;
      }
      .acc-bal {
        font-size: 13.5px;
        color: #94a3b8;
        font-weight: 500;
      }

      .cur-tag {
        border: 1px dashed rgba(255, 255, 255, 0.25);
        border-radius: 6px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
        color: #94a3b8;
      }

      .acc-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }

      .btn-topup {
        flex: 1;
        height: 38px;
        border-radius: 8px;
        background: #16a34a;
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        text-decoration: none;
        box-shadow: 0 4px 12px rgba(22, 163, 74, 0.3);
        transition: all 180ms ease;
      }
      .btn-topup:hover {
        background: #15803d;
      }

      .btn-sq {
        width: 40px;
        height: 38px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.05);
        color: #38bdf8;
        display: grid;
        place-items: center;
        text-decoration: none;
        cursor: pointer;
        transition: all 180ms ease;
      }
      .btn-sq:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }

      @media (max-width: 899px) {
        .panel {
          position: fixed;
          left: 12px;
          right: 12px;
          top: 66px;
          width: auto;
        }
      }
    `,
  ],
})
export class AccountSwitcherComponent {
  protected accounts = inject(AccountService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private sound = inject(SoundService);
  readonly product = input('OTC');
  protected open = signal(false);
  protected fmt = money;

  protected isReal = computed(() => this.accounts.active()?.type === 'real');
  protected accountTypeLabel = computed(() => {
    const a = this.accounts.active();
    if (a?.type === 'tournament') return a.tournamentName?.toUpperCase() ?? 'TOURNAMENT';
    return a?.type === 'demo' ? 'DEMO' : 'REAL';
  });

  protected realBalance = computed(() => {
    const a = this.accounts.real();
    return a ? a.balance + a.bonusBalance : 0;
  });

  protected demoBalance = computed(() => {
    const a = this.accounts.demo();
    return a ? a.balance + a.bonusBalance : 5000000;
  });

  protected async selectAccount(product: 'OTC' | 'CFD', kind: 'real' | 'demo') {
    this.open.set(false);
    this.sound.playClick();
    let target = kind === 'real' ? this.accounts.real() : this.accounts.demo();
    if (!target) {
      await this.accounts.load();
      target = kind === 'real' ? this.accounts.real() : this.accounts.demo();
    }
    if (target) {
      await this.accounts.switchTo(target.id);
      this.toast.info(`Switched to ${product} ${kind === 'real' ? 'Real' : 'Demo'}`);
    }
    void this.router.navigateByUrl(product === 'OTC' ? '/app/trading' : '/app/cfd');
  }

  protected transferDemo() {
    this.open.set(false);
    this.sound.playClick();
    this.toast.info('Deposit to fund your OTC Real balance');
    void this.router.navigateByUrl('/app/finance/deposit');
  }
}

