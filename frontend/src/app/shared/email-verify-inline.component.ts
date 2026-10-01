import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { ApiError } from '../core/models';

/** For signed-in users whose e-mail is unverified: e-mails a 6-digit code and confirms it in place. */
@Component({
  selector: 'app-email-verify-inline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (!sentTo()) {
      <button class="btn btn-primary sm" (click)="send()" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send verification code' }}</button>
    } @else {
      <div class="ev">
        <small class="muted">Enter the 6-digit code sent to <b>{{ sentTo() }}</b></small>
        <div class="ev-row">
          <input class="input ev-code" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code" aria-label="Verification code" [ngModel]="code()" (ngModelChange)="onCode($event)" />
          <button class="btn btn-primary" (click)="verify()" [disabled]="busy() || code().length !== 6">Verify</button>
        </div>
        <button class="link" (click)="send()" [disabled]="busy() || wait() > 0">{{ wait() > 0 ? 'Resend in ' + wait() + 's' : 'Resend code' }}</button>
      </div>
    }
    @if (error()) { <div class="ev-err">{{ error() }}</div> }
  `,
  styles: [
    `
      :host { display: block; margin-top: 8px; }
      .ev { display: flex; flex-direction: column; gap: 8px; }
      .ev-row { display: flex; gap: 8px; }
      .ev-code { flex: 1; min-width: 0; text-align: center; font-size: 20px; font-weight: 700; letter-spacing: 0.4em; }
      .link:disabled { opacity: 0.55; }
      .ev-err { margin-top: 6px; color: #f87171; font-size: 13px; }
    `,
  ],
})
export class EmailVerifyInlineComponent implements OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  protected sentTo = signal('');
  protected code = signal('');
  protected wait = signal(0);
  protected busy = signal(false);
  protected error = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  protected onCode(v: string) {
    this.code.set((v ?? '').replace(/\D/g, '').slice(0, 6));
    if (this.code().length === 6) void this.verify();
  }

  protected async send() {
    await this.run(async () => {
      const r = await this.api.post<{ verified?: boolean; email?: string; resendIn?: number }>('/auth/resend-verification');
      if (r.verified) return this.done();
      this.sentTo.set(r.email ?? 'your e-mail');
      this.code.set('');
      this.countdown(r.resendIn ?? 60);
    });
  }

  protected async verify() {
    if (this.busy() || this.code().length !== 6) return;
    await this.run(async () => {
      await this.api.post('/auth/verify-email-code', { code: this.code() });
      this.done();
    });
    if (this.error()) this.code.set('');
  }

  private done() {
    this.auth.patchUser({ emailVerified: true });
    this.toast.success('E-mail verified ✓');
  }

  private countdown(sec: number) {
    clearInterval(this.timer);
    this.wait.set(sec);
    this.timer = setInterval(() => {
      this.wait.update((s) => Math.max(0, s - 1));
      if (!this.wait()) clearInterval(this.timer);
    }, 1000);
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
}
