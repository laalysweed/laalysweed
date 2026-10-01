import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap, throwError, catchError } from 'rxjs';
import { AuthService } from './auth.service';

const SKIP = ['/auth/refresh', '/auth/login', '/auth/register'];

/** Attaches the access token and transparently refreshes it once on 401, then retries. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isApi = req.url.includes('/api/') || req.url.endsWith('/api') || req.url.startsWith('/api');
  const isSkip = SKIP.some((p) => req.url.includes(p));
  if (!isApi || isSkip) return next(req);

  const withToken = (t: string | null) => (t ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req);

  return next(withToken(auth.token())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.token()) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((t) => {
          if (!t) {
            auth.clear();
            return throwError(() => err);
          }
          return next(withToken(t));
        }),
      );
    }),
  );
};
