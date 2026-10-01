import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { AuthResponse, User } from './models';

/** Server reply to a sign-in action: a session, a 2FA challenge, or an e-mail code to enter. */
export type SignInStep =
  | AuthResponse
  | { twoFactorRequired: true; ticket: string }
  | { verificationRequired: true; ticket: string; email: string; resendIn: number };

/**
 * Holds the in-memory access token (15 min) and current user.
 * The refresh token lives in an httpOnly cookie; `refresh()` is de-duplicated so parallel
 * 401s trigger exactly one refresh request.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly user = signal<User | null>(null);
  readonly token = signal<string | null>(null);
  readonly ready = signal(false);
  readonly isLoggedIn = computed(() => !!this.user());
  readonly isAdmin = computed(() => this.user()?.role === 'admin');

  private refreshing: Promise<string | null> | null = null;

  /** Called once at startup: restores the session from the refresh cookie if present. */
  async restore() {
    await this.refresh();
    this.ready.set(true);
  }

  refresh(): Promise<string | null> {
    if (!this.refreshing) {
      this.refreshing = firstValueFrom(this.http.post<AuthResponse | null>(`${this.api.base}/auth/refresh`, {}, { withCredentials: true }))
        .then((r) => {
          if (!r?.accessToken) throw new Error('no session');
          this.setSession(r);
          return r.accessToken;
        })
        .catch(() => {
          this.clear();
          return null;
        })
        .finally(() => setTimeout(() => (this.refreshing = null), 0));
    }
    return this.refreshing;
  }

  setSession(r: AuthResponse) {
    this.token.set(r.accessToken);
    this.user.set(r.user);
  }

  patchUser(p: Partial<User>) {
    const u = this.user();
    if (u) this.user.set({ ...u, ...p });
  }

  async login(identifier: string, password: string) {
    return this.signInStep(await this.api.post<SignInStep>('/auth/login', { identifier, password }));
  }

  /** Enter the 6-digit e-mail code; may lead to a 2FA challenge or straight into the app. */
  async verifyCode(ticket: string, code: string) {
    return this.signInStep(await this.api.post<SignInStep>('/auth/verify-code', { ticket, code }));
  }

  /** Sends a new code. If e-mail is paused the server signs the user in instead (returns a session). */
  async resendCode(ticket: string) {
    const r = await this.api.post<SignInStep | { ok: true; email: string; resendIn: number }>('/auth/resend-code', { ticket });
    return 'ok' in r ? r : this.signInStep(r);
  }

  private signInStep(r: SignInStep) {
    if ('accessToken' in r) this.setSession(r);
    return r;
  }

  async login2fa(ticket: string, code: string) {
    const r = await this.api.post<AuthResponse>('/auth/login/2fa', { ticket, code });
    this.setSession(r);
    return r;
  }

  async register(body: { fullName: string; username: string; email: string; password: string; referrer?: string; acceptTerms: boolean }) {
    return this.signInStep(await this.api.post<SignInStep>('/auth/register', body));
  }

  async logout() {
    await this.api.post('/auth/logout').catch(() => undefined);
    this.clear();
    await this.router.navigateByUrl('/');
  }

  clear() {
    this.token.set(null);
    this.user.set(null);
  }
}
