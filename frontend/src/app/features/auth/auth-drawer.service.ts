import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

export type AuthMode = 'signup' | 'login' | 'forgot' | 'reset' | 'twofactor';

/** Drives the right-hand auth drawer. Also reacts to ?auth=login|signup|reset, ?ref= and ?token= URLs. */
@Injectable({ providedIn: 'root' })
export class AuthDrawerService {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly open = signal(false);
  readonly mode = signal<AuthMode>('signup');
  readonly referrer = signal('');
  readonly resetToken = signal('');
  readonly next = signal<string | null>(null);

  constructor() {
    try {
      const saved = sessionStorage.getItem('y2.ref');
      if (saved) this.referrer.set(saved);
    } catch {
      /* ignore */
    }
  }

  /** Reads landing-page query params once. */
  consumeQuery() {
    const q = this.route.snapshot.queryParamMap;
    const ref = q.get('ref');
    if (ref) {
      this.referrer.set(ref.toLowerCase());
      try {
        sessionStorage.setItem('y2.ref', ref.toLowerCase());
      } catch {
        /* ignore */
      }
    }
    const auth = q.get('auth') as AuthMode | null;
    if (auth === 'reset' && q.get('token')) this.resetToken.set(q.get('token')!);
    this.next.set(q.get('next'));
    if (auth && ['signup', 'login', 'reset', 'forgot'].includes(auth)) this.show(auth);
    else if (ref) this.show('signup');
  }

  show(mode: AuthMode) {
    this.mode.set(mode);
    this.open.set(true);
  }

  close() {
    this.open.set(false);
    if (this.route.snapshot.queryParamMap.has('auth') || this.route.snapshot.queryParamMap.has('token')) {
      void this.router.navigate([], { queryParams: { auth: null, token: null, next: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }
}
