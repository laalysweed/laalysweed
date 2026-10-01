import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { SpotlightService } from '../../core/spotlight';
import { LogoComponent } from '../../shared/logo.component';
import { IconComponent } from '../../shared/icon.component';

type Stage = 'welcome' | 'goodluck' | 'tour-intro' | 'tour' | null;

interface Step {
  key: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { key: 'asset', title: 'Choose an asset', text: 'Pick from crypto, forex, commodities, stocks and indices. The % shows your potential profit. Tap ☆ to pin favourites to the top bar.' },
  { key: 'chart', title: 'Live chart', text: 'Prices stream in real time. The vertical line with the flag marks when a new trade would expire. Your open trades are drawn right on the chart.' },
  { key: 'time', title: 'Trade duration', text: 'Set how long your trade runs, from 5 seconds up to 4 hours.' },
  { key: 'amount', title: 'Investment amount', text: 'Choose how much to invest in the trade. Use the quick chips or type any amount.' },
  { key: 'payout', title: 'Your payout', text: 'This is the profit you receive if your forecast is correct, shown as a percentage and in dollars.' },
  { key: 'buy', title: 'Price will go UP', text: 'Press BUY if you think the price will be higher at expiry. Hover to preview the winning zone on the chart.' },
  { key: 'sell', title: 'Price will go DOWN', text: 'Press SELL if you think the price will be lower at expiry.' },
  { key: 'rail', title: 'Your trades', text: 'Follow open trades with live countdowns, and review closed trades with a tick-by-tick replay.' },
  { key: 'account', title: 'Demo or real', text: 'Switch between your $10,000 practice account and your real account at any time.' },
  { key: 'topup', title: 'Top up', text: 'Ready for real trading? Deposit with M-Pesa, USDT or card in a few taps.' },
];

@Component({
  selector: 'app-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LogoComponent, IconComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  protected spot = inject(SpotlightService);

  protected stage = signal<Stage>(null);
  protected stepIndex = signal(0);
  protected steps = signal<Step[]>([]);
  protected step = computed(() => this.steps()[this.stepIndex()] ?? null);
  protected firstName = computed(() => this.auth.user()?.fullName.split(' ')[0] ?? 'trader');

  /** Popover placement relative to the highlighted rect. */
  protected pop = computed(() => {
    const r = this.spot.rect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = Math.min(340, W - 24);
    if (!r) return { left: (W - w) / 2, top: H / 2 - 100, w, arrow: 'none' };
    const spaceBelow = H - r.bottom;
    const spaceRight = W - r.right;
    if (spaceRight > w + 40 && r.height > 200) return { left: r.right + 18, top: Math.min(H - 240, Math.max(12, r.top + 20)), w, arrow: 'left' };
    if (spaceBelow > 230) return { left: clamp(r.left + r.width / 2 - w / 2, 12, W - w - 12), top: r.bottom + 16, w, arrow: 'top' };
    if (r.left > w + 40) return { left: r.left - w - 18, top: clamp(r.top, 12, H - 240), w, arrow: 'right' };
    return { left: clamp(r.left + r.width / 2 - w / 2, 12, W - w - 12), top: Math.max(12, r.top - 220), w, arrow: 'bottom' };
  });

  constructor() {
    let lastReq = this.spot.tourRequest();
    effect(() => {
      const n = this.spot.tourRequest();
      if (n !== lastReq) {
        lastReq = n;
        untracked(() => this.stage.set('tour-intro'));
      }
    });
    effect(() => {
      const u = this.auth.user();
      if (!u) return;
      untracked(() => {
        if (this.stage() !== null) return;
        if (!u.onboarding.welcomeSeen) this.stage.set('welcome');
        else if (!u.onboarding.goodLuckSeen) this.stage.set('goodluck');
      });
    });
  }

  private save(p: Partial<{ welcomeSeen: boolean; goodLuckSeen: boolean; tourStep: number; tourDone: boolean }>) {
    const u = this.auth.user();
    if (u) this.auth.patchUser({ onboarding: { ...u.onboarding, ...p } });
    void this.api.patch('/me/onboarding', p).catch(() => undefined);
  }

  protected continueWelcome() {
    this.save({ welcomeSeen: true });
    this.stage.set('goodluck');
  }

  protected goodLuck(choice: 'deposit' | 'tutorial' | 'trade') {
    this.save({ goodLuckSeen: true });
    if (choice === 'deposit') {
      this.stage.set(null);
      void this.router.navigateByUrl('/app/finance/deposit');
    } else if (choice === 'tutorial') {
      this.stage.set('tour-intro');
    } else this.stage.set(null);
  }

  protected async startTour() {
    if (!this.router.url.startsWith('/app/trading')) await this.router.navigateByUrl('/app/trading');
    // Give the trading view a moment to render its targets.
    setTimeout(() => {
      const available = STEPS.filter((s) => this.spot.has(s.key));
      this.steps.set(available);
      const resume = this.auth.user()?.onboarding.tourStep ?? 0;
      this.stepIndex.set(resume < available.length ? resume : 0);
      this.stage.set('tour');
      this.spot.focus(this.step()?.key ?? null);
    }, 350);
  }

  protected next() {
    if (this.stepIndex() >= this.steps().length - 1) return this.endTour();
    this.stepIndex.update((i) => i + 1);
    this.save({ tourStep: this.stepIndex() });
    this.spot.focus(this.step()!.key);
  }

  protected prev() {
    if (this.stepIndex() === 0) return;
    this.stepIndex.update((i) => i - 1);
    this.spot.focus(this.step()!.key);
  }

  protected endTour() {
    this.save({ tourDone: true, tourStep: 0 });
    this.spot.focus(null);
    this.stage.set(null);
  }

  protected skip() {
    this.save({ tourDone: true });
    this.stage.set(null);
  }

  /** Allows re-running the tour from the Help page. */
  restart() {
    this.save({ tourStep: 0, tourDone: false });
    void this.startTour();
  }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
