import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthDrawerService } from './auth-drawer.service';
import { AuthService, SignInStep } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { LogoComponent } from '../../shared/logo.component';
import { ApiError } from '../../core/models';

type Avail = { state: 'idle' | 'checking' | 'ok' | 'taken' | 'invalid'; msg: string };

@Component({
  selector: 'app-auth-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RouterLink, LogoComponent],
  templateUrl: './auth-drawer.component.html',
  styleUrl: './auth-drawer.component.scss',
  host: { '[class.open]': 'svc.open()', '(document:keydown.escape)': 'svc.close()' },
})
export class AuthDrawerComponent {
  protected svc = inject(AuthDrawerService);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  // form state
  protected fullName = signal('');
  protected username = signal('');
  protected email = signal('');
  protected password = signal('');
  protected password2 = signal('');
  protected referrer = signal('');
  protected terms = signal(false);
  protected identifier = signal('');
  protected code = signal('');
  protected showPw = signal(false);
  protected showPw2 = signal(false);
  protected busy = signal(false);
  protected error = signal<string | null>(null);
  protected sent = signal(false);
  protected ticket = signal('');
  protected touched = signal<Record<string, boolean>>({});

  protected userAvail = signal<Avail>({ state: 'idle', msg: '' });
  protected emailAvail = signal<Avail>({ state: 'idle', msg: '' });
  protected refAvail = signal<Avail>({ state: 'idle', msg: '' });

  protected strength = computed(() => {
    const p = this.password();
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p) || p.length >= 14) s++;
    return p ? Math.max(1, s) : 0;
  });
  protected strengthLabel = computed(() => ['', 'Weak', 'Fair', 'Good', 'Strong'][this.strength()]);
  protected pwValid = computed(() => this.password().length >= 8 && /[A-Za-z]/.test(this.password()) && /\d/.test(this.password()));
  protected pwMatch = computed(() => !!this.password() && this.password() === this.password2());
  protected nameValid = computed(() => this.fullName().trim().length >= 2);

  protected canSignup = computed(
    () =>
      this.nameValid() &&
      this.userAvail().state !== 'taken' &&
      this.userAvail().state !== 'invalid' &&
      this.emailAvail().state !== 'taken' &&
      this.emailAvail().state !== 'invalid' &&
      this.pwValid() &&
      this.pwMatch() &&
      this.terms() &&
      this.refAvail().state !== 'invalid' &&
      this.refAvail().state !== 'checking' &&
      !this.busy(),
  );

  private timers: Record<string, ReturnType<typeof setTimeout>> = {};

  constructor() {
    effect(() => {
      const r = this.svc.referrer();
      untracked(() => {
        if (r && !this.referrer()) {
          this.referrer.set(r);
          this.checkReferrer(r);
        }
      });
    });
    effect(() => {
      this.svc.mode();
      untracked(() => {
        this.error.set(null);
        this.sent.set(false);
      });
    });
  }

  protected touch(f: string) {
    this.touched.update((t) => ({ ...t, [f]: true }));
  }

  protected onUsername(v: string) {
    this.username.set(v);
    this.debounce('u', () => this.checkAvail('username', v.trim().toLowerCase(), this.userAvail));
  }
  protected onEmail(v: string) {
    this.email.set(v);
    this.debounce('e', () => this.checkAvail('email', v.trim().toLowerCase(), this.emailAvail));
  }
  protected onReferrer(v: string) {
    this.referrer.set(v);
    this.debounce('r', () => this.checkReferrer(v));
  }

  private debounce(key: string, fn: () => void) {
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(fn, 420);
  }

  private async checkAvail(kind: 'username' | 'email', value: string, target: ReturnType<typeof signal<Avail>>) {
    if (!value) return target.set({ state: 'idle', msg: '' });
    if (kind === 'username' && !/^[a-z0-9_]{3,20}$/.test(value)) return target.set({ state: 'invalid', msg: 'Use 3–20 letters, numbers or underscores' });
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return target.set({ state: 'invalid', msg: 'Enter a valid e-mail address' });
    target.set({ state: 'checking', msg: 'Checking…' });
    try {
      const r = await this.api.get<{ available: boolean; reason?: string }>('/auth/check', { [kind]: value });
      const current = kind === 'username' ? this.username().trim().toLowerCase() : this.email().trim().toLowerCase();
      if (current !== value) return; // stale response
      target.set(r.available ? { state: 'ok', msg: kind === 'username' ? 'Username is available' : 'Looks good' } : { state: 'taken', msg: r.reason ?? (kind === 'username' ? 'Username is taken' : 'An account with this e-mail exists') });
    } catch {
      target.set({ state: 'idle', msg: '' });
    }
  }

  private async checkReferrer(v: string) {
    const value = v.trim().toLowerCase();
    if (!value) return this.refAvail.set({ state: 'idle', msg: '' });
    this.refAvail.set({ state: 'checking', msg: 'Checking…' });
    try {
      const r = await this.api.get<{ valid: boolean }>(`/auth/referrer/${encodeURIComponent(value)}`);
      if (this.referrer().trim().toLowerCase() !== value) return;
      this.refAvail.set(r.valid ? { state: 'ok', msg: 'Referrer found' } : { state: 'invalid', msg: 'No trader with this username' });
    } catch {
      this.refAvail.set({ state: 'idle', msg: '' });
    }
  }

  protected async signup() {
    this.touched.set({ name: true, user: true, email: true, pw: true, pw2: true, terms: true });
    if (!this.nameValid()) {
      this.error.set('Please enter your full name (at least 2 letters)');
      return;
    }
    const u = this.username().trim().toLowerCase();
    if (!u || !/^[a-z0-9_]{3,20}$/.test(u)) {
      this.error.set('Username must be 3–20 letters, numbers or underscores');
      return;
    }
    const em = this.email().trim().toLowerCase();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) {
      this.error.set('Please enter a valid email address');
      return;
    }
    if (!this.pwValid()) {
      this.error.set('Password must be at least 8 characters with letters and numbers');
      return;
    }
    if (!this.password2()) {
      this.error.set('Please confirm your password');
      return;
    }
    if (this.password() !== this.password2()) {
      this.error.set('Passwords do not match');
      return;
    }
    if (!this.terms()) {
      this.error.set('Please accept the Terms & Conditions and Privacy Policy');
      return;
    }
    if (this.userAvail().state === 'taken') {
      this.error.set(this.userAvail().msg || 'Username is taken');
      return;
    }
    if (this.emailAvail().state === 'taken') {
      this.error.set(this.emailAvail().msg || 'An account with this email exists');
      return;
    }
    if (this.refAvail().state === 'invalid') {
      this.error.set(this.refAvail().msg || 'Invalid referrer username');
      return;
    }
    await this.run(async () => {
      this.newAccount = true;
      const r = await this.auth.register({
        fullName: this.fullName().trim(),
        username: u,
        email: em,
        password: this.password(),
        referrer: this.referrer().trim().toLowerCase() || undefined,
        acceptTerms: true,
      });
      this.handleStep(r);
    });
  }

  protected async login() {
    if (!this.identifier().trim() || !this.password()) return this.error.set('Enter your e-mail/username and password');
    await this.run(async () => {
      this.newAccount = false;
      this.handleStep(await this.auth.login(this.identifier().trim(), this.password()));
    });
  }

  /* ---------- e-mail code step ---------- */
  protected verifyEmail = signal('');
  protected resendIn = signal(0);
  private newAccount = false;
  private cooldownTimer?: ReturnType<typeof setInterval>;

  /** Routes a sign-in reply to the right screen: e-mail code, 2FA, or into the app. */
  private handleStep(r: SignInStep) {
    if ('verificationRequired' in r) {
      this.ticket.set(r.ticket);
      this.verifyEmail.set(r.email);
      this.code.set('');
      this.startCooldown(r.resendIn);
      this.svc.mode.set('verify');
      return;
    }
    if ('twoFactorRequired' in r) {
      this.ticket.set(r.ticket);
      this.code.set('');
      this.svc.mode.set('twofactor');
      return;
    }
    if (this.newAccount) this.toast.success('Welcome to Y2 Markets! Your $10,000 demo account is ready.');
    this.finish();
  }

  protected onCode(v: string) {
    const digits = (v ?? '').replace(/\D/g, '').slice(0, 6);
    this.code.set(digits);
    if (digits.length === 6 && !this.busy()) void this.verifyEmailCode();
  }

  protected async verifyEmailCode() {
    if (this.code().length !== 6) return this.error.set('Enter the 6-digit code from your e-mail');
    await this.run(async () => {
      const r = await this.auth.verifyCode(this.ticket(), this.code());
      this.toast.success('E-mail verified ✓');
      this.handleStep(r);
    }).finally(() => this.error() && this.code.set(''));
  }

  protected async resendCode() {
    if (this.resendIn() > 0) return;
    await this.run(async () => {
      const r = await this.auth.resendCode(this.ticket());
      if ('ok' in r) {
        this.code.set('');
        this.startCooldown(r.resendIn);
        this.toast.success(`A new code was sent to ${r.email}`);
        return;
      }
      this.handleStep(r);
    });
  }

  private startCooldown(sec: number) {
    clearInterval(this.cooldownTimer);
    this.resendIn.set(Math.max(0, sec));
    this.cooldownTimer = setInterval(() => {
      this.resendIn.update((s) => Math.max(0, s - 1));
      if (this.resendIn() === 0) clearInterval(this.cooldownTimer);
    }, 1000);
  }

  protected async verify2fa() {
    await this.run(async () => {
      await this.auth.login2fa(this.ticket(), this.code());
      this.finish();
    });
  }

  protected async forgot() {
    await this.run(async () => {
      await this.api.post('/auth/forgot', { email: this.email().trim() });
      this.sent.set(true);
    });
  }

  protected async reset() {
    if (this.password() !== this.password2()) return this.error.set('Passwords do not match');
    await this.run(async () => {
      await this.api.post('/auth/reset', { token: this.svc.resetToken(), password: this.password() });
      this.toast.success('Password updated, please log in');
      this.password.set('');
      this.svc.mode.set('login');
    });
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set((e as ApiError).message ?? 'Something went wrong');
    } finally {
      this.busy.set(false);
    }
  }

  private finish() {
    const next = this.svc.next();
    this.svc.close();
    this.password.set('');
    void this.router.navigateByUrl(next && next.startsWith('/') ? next : '/app/trading');
  }
}
