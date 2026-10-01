import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { LogoComponent } from '../../shared/logo.component';
import { IconComponent } from '../../shared/icon.component';
import { ApiError } from '../../core/models';

@Component({
  selector: 'app-verify-email',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LogoComponent, IconComponent],
  template: `
    <div class="box card anim-pop">
      <app-logo [size]="44" />
      @switch (state()) {
        @case ('loading') {
          <div class="spinner big"></div>
          <p>Verifying your e-mail…</p>
        }
        @case ('ok') {
          <div class="ok"><app-icon name="check" [size]="34" /></div>
          <h2>E-mail verified</h2>
          <p class="muted">Your account is fully activated. Withdrawals are now enabled.</p>
          <a class="btn btn-brand pill lg" [routerLink]="auth.isLoggedIn() ? '/app/trading' : '/'" [queryParams]="auth.isLoggedIn() ? {} : { auth: 'login' }">Continue</a>
        }
        @case ('error') {
          <div class="bad"><app-icon name="warn" [size]="34" /></div>
          <h2>Link not valid</h2>
          <p class="muted">{{ message() }}</p>
          <a class="btn btn-ghost pill lg" routerLink="/">Back to home</a>
        }
      }
    </div>
  `,
  styles: [
    `:host{min-height:100vh;display:grid;place-items:center;padding:16px;background:url(/img/scene-aurora.svg) center/cover}
     .box{width:min(460px,100%);text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;padding:40px 28px;background:rgba(15,20,32,.82)}
     .ok,.bad{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;margin-top:10px}
     .ok{background:rgba(34,197,94,.15);color:var(--buy);box-shadow:0 0 0 8px rgba(34,197,94,.06)}
     .bad{background:rgba(239,68,68,.12);color:var(--sell)}
     .big{width:40px;height:40px;margin-top:16px} p{margin:0}`,
  ],
})
export class VerifyEmailComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  readonly token = input<string>('');
  protected state = signal<'loading' | 'ok' | 'error'>('loading');
  protected message = signal('');

  async ngOnInit() {
    try {
      await this.api.post('/auth/verify-email', { token: this.token() });
      this.auth.patchUser({ emailVerified: true });
      this.state.set('ok');
    } catch (e) {
      this.message.set((e as ApiError).message);
      this.state.set('error');
    }
  }
}
