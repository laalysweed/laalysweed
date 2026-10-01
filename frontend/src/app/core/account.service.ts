import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { SocketService } from './socket.service';
import { Account, User } from './models';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private socket = inject(SocketService);

  readonly accounts = signal<Account[]>([]);
  readonly active = computed(() => {
    const id = this.auth.user()?.activeAccountId;
    const list = this.accounts();
    return list.find((a) => a.id === id) ?? list.find((a) => a.type === 'demo') ?? null;
  });
  readonly real = computed(() => this.accounts().find((a) => a.type === 'real') ?? null);
  readonly demo = computed(() => this.accounts().find((a) => a.type === 'demo') ?? null);
  /** Total spendable on the active account (cash + bonus for real). */
  readonly available = computed(() => {
    const a = this.active();
    return a ? a.balance + (a.type === 'real' ? a.bonusBalance : 0) : 0;
  });

  constructor() {
    this.socket.on<Account[]>('accounts', (list) => {
      const names = new Map(this.accounts().map((a) => [a.id, a.tournamentName]));
      this.accounts.set(list.map((a) => ({ ...a, tournamentName: names.get(a.id) ?? a.tournamentName ?? null })));
    });
    effect(() => {
      if (this.auth.isLoggedIn()) untracked(() => void this.load());
      else this.accounts.set([]);
    });
  }

  async load() {
    const r = await this.api.get<{ user: User; accounts: Account[] }>('/me');
    this.accounts.set(r.accounts);
    this.auth.patchUser(r.user);
    return r;
  }

  async switchTo(accountId: string) {
    if (this.auth.user()?.activeAccountId === accountId) return;
    const previous = this.auth.user()?.activeAccountId ?? null;
    this.auth.patchUser({ activeAccountId: accountId }); // optimistic
    try {
      await this.api.post('/me/active-account', { accountId });
    } catch (e) {
      this.auth.patchUser({ activeAccountId: previous }); // server refused (e.g. tournament not running)
      throw e;
    }
  }

  label(a: Account | null) {
    if (!a) return '';
    if (a.type === 'tournament') return a.tournamentName ?? 'Tournament';
    return a.type === 'demo' ? 'DEMO' : 'REAL';
  }
}
