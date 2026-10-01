import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { AccountService } from './account.service';
import { ToastService } from './toast.service';
import { SoundService } from './ui.service';
import { ApiError, Direction, Trade } from './models';
import { signedMoney, uuid } from './format';

@Injectable({ providedIn: 'root' })
export class TradesService {
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private accounts = inject(AccountService);
  private toast = inject(ToastService);
  private sound = inject(SoundService);

  readonly open = signal<Trade[]>([]);
  readonly closed = signal<Trade[]>([]);
  /** Trade ids currently playing their win/loss flash before moving to "Closed". */
  readonly flashing = signal<Map<string, Trade>>(new Map());
  readonly placing = signal<Direction | null>(null);
  readonly openForSymbol = (symbol: string) => computed(() => this.open().filter((t) => t.symbol === symbol));

  constructor() {
    effect(() => {
      const acc = this.accounts.active();
      if (acc) untracked(() => void this.load(acc.id));
    });
    this.socket.on<Trade>('trade:opened', (t) => {
      if (t.accountId !== this.accounts.active()?.id) return;
      this.open.update((list) => (list.some((x) => x.id === t.id) ? list : [t, ...list]));
      if (t.source === 'copy' || t.source === 'pending') {
        this.sound.playTradeOpen(t.direction);
        this.toast.info(`${t.source === 'copy' ? 'Copied' : 'Pending'} trade opened on ${t.symbol}`);
      }
    });
    this.socket.on<Trade>('trade:closed', (t) => this.onClosed(t));

    // Soft ticks during the last 3 seconds of any open trade (one tick per second).
    let lastTick = 0;
    setInterval(() => {
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      if (sec === lastTick) return;
      const soon = this.open().some((t) => {
        const left = new Date(t.expiresAt).getTime() - now;
        return t.status === 'open' && left > 0 && left <= 3000;
      });
      if (soon) {
        lastTick = sec;
        this.sound.playTick();
      }
    }, 200);
  }

  async load(accountId: string) {
    const [open, closed] = await Promise.all([
      this.api.get<Trade[]>('/trades', { status: 'open', accountId }),
      this.api.get<Trade[]>('/trades', { status: 'closed', accountId, limit: 60 }),
    ]);
    this.open.set(open);
    this.closed.set(closed);
  }

  async loadMoreClosed() {
    const acc = this.accounts.active();
    const last = this.closed()[this.closed().length - 1];
    if (!acc || !last) return 0;
    const more = await this.api.get<Trade[]>('/trades', { status: 'closed', accountId: acc.id, before: last.openedAt, limit: 60 });
    this.closed.update((c) => [...c, ...more]);
    return more.length;
  }

  async place(p: { symbol: string; direction: Direction; amount: number; durationSec: number; source?: 'manual' | 'ai' }) {
    const acc = this.accounts.active();
    if (!acc) throw new Error('No account');
    this.placing.set(p.direction);
    try {
      const t = await this.api.post<Trade>('/trades', { ...p, accountId: acc.id, idempotencyKey: uuid() });
      this.open.update((list) => (list.some((x) => x.id === t.id) ? list : [t, ...list]));
      this.sound.playTradeOpen(p.direction);
      return t;
    } catch (e) {
      // The selected tournament has ended or not started: fall back to the demo account.
      if ((e as ApiError).code === 'TOURNAMENT_CLOSED' && this.accounts.demo()) {
        await this.accounts.switchTo(this.accounts.demo()!.id);
        throw { code: 'TOURNAMENT_CLOSED', message: 'That tournament is not running, so we switched you to your Demo account. Press BUY or SELL again.' } as ApiError;
      }
      throw e;
    } finally {
      this.placing.set(null);
    }
  }

  private onClosed(t: Trade) {
    if (t.accountId !== this.accounts.active()?.id) return;
    this.flashing.update((m) => new Map(m).set(t.id, t));
    this.open.update((list) => list.map((x) => (x.id === t.id ? t : x)));
    if (t.status === 'won') {
      this.sound.playWin();
      this.toast.success(`${t.symbol}: you won ${signedMoney(t.profit)}`);
    } else if (t.status === 'lost') {
      this.sound.playLoss();
    } else {
      this.sound.playDraw();
    }
    setTimeout(() => {
      this.open.update((list) => list.filter((x) => x.id !== t.id));
      this.closed.update((list) => [t, ...list.filter((x) => x.id !== t.id)]);
      this.flashing.update((m) => {
        const n = new Map(m);
        n.delete(t.id);
        return n;
      });
    }, 1400);
  }
}
