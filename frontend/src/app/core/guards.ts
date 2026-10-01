import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';
import { AuthService } from './auth.service';

/** Waits for the initial session restore before deciding. */
const whenReady = () => {
  const auth = inject(AuthService);
  return toObservable(auth.ready).pipe(filter(Boolean), take(1));
};

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return whenReady().pipe(
    map(() => (auth.isLoggedIn() ? true : router.createUrlTree(['/'], { queryParams: { auth: 'login', next: state.url } }))),
  );
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return whenReady().pipe(map(() => (auth.isAdmin() ? true : router.createUrlTree(auth.isLoggedIn() ? ['/app'] : ['/']))));
};
