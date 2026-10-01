import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from './models';

type Params = Record<string, string | number | boolean | undefined | null>;

/** Promise-based wrapper around HttpClient. All errors are normalised to ApiError. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  readonly base = (() => {
    if (typeof window !== 'undefined') {
      const custom = (window as unknown as { __API_URL__?: string }).__API_URL__;
      if (custom) return `${custom.replace(/\/+$/, '')}/api`;
      if (!/^(localhost|127\.|192\.168\.)/.test(window.location.hostname)) {
        return window.location.hostname.endsWith('y2markets.site')
          ? 'https://api.y2markets.site/api'
          : 'https://laalysweed.onrender.com/api';
      }
    }
    return '/api';
  })();

  get<T>(path: string, params?: Params) {
    return this.run(this.http.get<T>(this.base + path, { params: this.params(params), withCredentials: true }));
  }
  post<T>(path: string, body: unknown = {}) {
    return this.run(this.http.post<T>(this.base + path, body, { withCredentials: true }));
  }
  put<T>(path: string, body: unknown = {}) {
    return this.run(this.http.put<T>(this.base + path, body, { withCredentials: true }));
  }
  patch<T>(path: string, body: unknown = {}) {
    return this.run(this.http.patch<T>(this.base + path, body, { withCredentials: true }));
  }
  delete<T>(path: string) {
    return this.run(this.http.delete<T>(this.base + path, { withCredentials: true }));
  }
  upload<T>(path: string, form: FormData) {
    return this.run(this.http.post<T>(this.base + path, form, { withCredentials: true }));
  }
  blob(path: string, params?: Params) {
    return this.run(this.http.get(this.base + path, { params: this.params(params), responseType: 'blob', withCredentials: true }));
  }

  private params(p?: Params) {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v));
    return hp;
  }

  private async run<T>(obs: import('rxjs').Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(obs);
    } catch (e) {
      throw toApiError(e);
    }
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof HttpErrorResponse) {
    const body = e.error as { error?: ApiError } | null;
    if (body?.error?.message) return body.error;
    if (e.status === 0) return { code: 'NETWORK', message: 'Cannot reach the server. Check your connection.' };
    return { code: `HTTP_${e.status}`, message: e.statusText || 'Request failed' };
  }
  if ((e as ApiError)?.message) return e as ApiError;
  return { code: 'UNKNOWN', message: 'Something went wrong' };
}
