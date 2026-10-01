import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

type Handler = (payload: never) => void;

/**
 * One Socket.IO connection for the whole app. Reconnects with a fresh token when the user logs in/out
 * or the access token rotates; rooms are re-joined automatically on reconnect.
 */
@Injectable({ providedIn: 'root' })
export class SocketService {
  private auth = inject(AuthService);
  private socket: Socket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private symbolRefs = new Map<string, number>();
  private rooms = new Set<string>();
  private lastToken: string | null | undefined = undefined;
  readonly connected = signal(false);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      const ready = this.auth.ready();
      if (!ready) return;
      untracked(() => this.ensure(token));
    });
  }

  private ensure(token: string | null) {
    // Token rotation only matters if the identity changed (login/logout); otherwise keep the socket.
    const identityChanged = (this.lastToken ? 1 : 0) !== (token ? 1 : 0) || this.lastToken === undefined;
    this.lastToken = token;
    if (this.socket && !identityChanged) {
      (this.socket.auth as { token?: string | null }).token = token;
      return;
    }
    this.socket?.disconnect();
    const apiUrl =
      typeof window !== 'undefined' && (window as unknown as { __API_URL__?: string }).__API_URL__
        ? (window as unknown as { __API_URL__: string }).__API_URL__.replace(/\/+$/, '')
        : undefined;
    const s = io(apiUrl || undefined, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: this.auth.token() }),
      reconnectionDelay: 800,
      reconnectionDelayMax: 6000,
    });
    this.socket = s;
    s.on('connect', () => {
      this.connected.set(true);
      for (const sym of this.symbolRefs.keys()) s.emit('market:subscribe', sym);
      for (const r of this.rooms) s.emit(`${r}:subscribe`);
    });
    s.on('disconnect', () => this.connected.set(false));
    s.on('connect_error', async (err) => {
      // Middleware rejections are not retried automatically: refresh the token, then reconnect.
      if (err.message === 'TOKEN_EXPIRED') {
        await this.auth.refresh();
        if (this.socket === s) setTimeout(() => s.connect(), 300);
      }
    });
    s.onAny((event: string, payload: unknown) => {
      this.handlers.get(event)?.forEach((h) => (h as (p: unknown) => void)(payload));
    });
  }

  on<T>(event: string, handler: (payload: T) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as Handler);
    return () => set!.delete(handler as Handler);
  }

  emit(event: string, payload?: unknown) {
    this.socket?.emit(event, payload);
  }

  /** Reference-counted symbol room subscription. */
  subscribeSymbol(symbol: string) {
    const n = this.symbolRefs.get(symbol) ?? 0;
    this.symbolRefs.set(symbol, n + 1);
    if (n === 0) this.socket?.emit('market:subscribe', symbol);
  }

  unsubscribeSymbol(symbol: string) {
    const n = (this.symbolRefs.get(symbol) ?? 0) - 1;
    if (n <= 0) {
      this.symbolRefs.delete(symbol);
      this.socket?.emit('market:unsubscribe', symbol);
    } else this.symbolRefs.set(symbol, n);
  }

  joinRoom(room: 'summary' | 'signals' | 'tournaments') {
    this.rooms.add(room);
    this.socket?.emit(`${room}:subscribe`);
  }

  leaveRoom(room: 'summary' | 'signals' | 'tournaments') {
    this.rooms.delete(room);
    this.socket?.emit(`${room}:unsubscribe`);
  }
}
