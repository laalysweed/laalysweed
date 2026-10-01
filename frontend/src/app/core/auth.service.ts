import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { AuthResponse, User } from './models';

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
    const r = await this.api.post<AuthResponse | { twoFactorRequired: true; ticket: string }>('/auth/login', { identifier, password });
    if ('twoFactorRequired' in r) return r;
    this.setSession(r);
    return r;
  }

  async login2fa(ticket: string, code: string) {
    const r = await this.api.post<AuthResponse>('/auth/login/2fa', { ticket, code });
    this.setSession(r);
    return r;
  }

  async register(body: { fullName: string; username: string; email: string; password: string; referrer?: string; acceptTerms: boolean }) {
    const r = await this.api.post<AuthResponse>('/auth/register', body);
    this.setSession(r);
    return r;
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
