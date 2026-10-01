import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { SoundService } from '../../core/ui.service';
import { LogoComponent } from '../../shared/logo.component';
import { IconComponent } from '../../shared/icon.component';
import { StackTableDirective } from '../../shared/stack-table.directive';
import { AuditChartComponent } from './audit-chart.component';
import { Account, ApiError, ChatMsg, Deposit, Trade, Tournament, User, Withdrawal, WithdrawalPopupConfig } from '../../core/models';
import { METHOD_LABELS, STATUS_LABELS, dateTime, money, price, signedMoney, statusTone } from '../../core/format';

type Tab = 'dashboard' | 'users' | 'kyc' | 'deposits' | 'withdrawals' | 'crypto' | 'assets' | 'bonuses' | 'ledger' | 'trades' | 'chat' | 'tournaments';

interface AdminUser extends User {
  blocked: boolean;
  lastLoginAt: string | null;
  lastIp: string | null;
  real: Account | null;
  referrer?: string | null;
}
interface Ledger {
  id: string;
  userId: string;
  username?: string;
  accountType: string;
  type: string;
  bucket: string;
  amount: number;
  balanceAfter: number;
  refKind: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
}
interface UserDetail {
  user: AdminUser;
  accounts: Account[];
  ledger: Ledger[];
  trades: Trade[];
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  kyc: { id: string; docType: string; originalName: string; mime: string; createdAt: string }[];
}
interface AdminAsset {
  _id: string;
  symbol: string;
  name: string;
  category: string;
  source: string;
  payout: number;
  enabled: boolean;
  minTradeCents: number;
  maxTradeCents: number;
  price: number | null;
  fresh: boolean;
  precision: number;
  cfd?: { enabled: boolean; spread: number; leverage: number; contractSize: number };
}
interface Audit {
  trade: Trade & { username?: string; fromCash: number; fromBonus: number; idempotencyKey: string };
  openTick: { id: string; ts: string; price: number } | null;
  closeTick: { id: string; ts: string; price: number } | null;
  derivedCloseTick: { id: string; ts: string; price: number } | null;
  recomputed: { closePrice: number; status: string; payout: number } | null;
  verified: boolean;
  ledger: Ledger[];
  ticks: { t: number; p: number; id: string }[];
}
interface CryptoWalletRow {
  code: string;
  coin: string;
  name: string;
  network: string;
  address: string;
  priceSymbol?: string;
  popular: boolean;
  enabled: boolean;
}
interface Conversation {
  userId: string;
  username: string;
  fullName: string;
  last: ChatMsg;
  unread: number;
}

@Component({
  selector: 'app-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LogoComponent, IconComponent, AuditChartComponent, StackTableDirective],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent {
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private toast = inject(ToastService);
  private sound = inject(SoundService);
  protected auth = inject(AuthService);

  protected tab = signal<Tab>('dashboard');
  protected navOpen = signal(false);
  protected tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'kyc', label: 'KYC', icon: 'shield' },
    { id: 'deposits', label: 'Deposits', icon: 'deposit' },
    { id: 'withdrawals', label: 'Withdrawals', icon: 'withdraw' },
    { id: 'assets', label: 'Assets & payouts', icon: 'chart-candle' },
    { id: 'crypto', label: 'Payments & limits', icon: 'wallet' },
    { id: 'bonuses', label: 'Bonus config', icon: 'gift' },
    { id: 'ledger', label: 'Ledger', icon: 'book' },
    { id: 'trades', label: 'Trade audit', icon: 'terminal' },
    { id: 'chat', label: 'Support chat', icon: 'chat' },
    { id: 'tournaments', label: 'Tournaments', icon: 'trophy' },
  ];

  protected money = money;
  protected signed = signedMoney;
  protected price = price;
  protected dt = dateTime;
  protected tone = statusTone;
  protected statusLabel = (s: string) => STATUS_LABELS[s] ?? s;
  protected methodLabel = (m: string) => METHOD_LABELS[m] ?? m;
  protected Math = Math;

  // dashboard
  protected stats = signal<Record<string, number> | null>(null);
  // users
  protected userQ = signal('');
  protected users = signal<{ total: number; rows: AdminUser[] }>({ total: 0, rows: [] });
  protected detail = signal<UserDetail | null>(null);
  protected adj = signal({ accountId: '', bucket: 'cash', amount: 0, note: '' });
  // kyc
  protected kyc = signal<{ user: User; documents: UserDetail['kyc'] }[]>([]);
  protected kycNote = signal('');
  protected preview = signal<{ url: string; mime: string; safe: SafeResourceUrl } | null>(null);
  private sanitizer = inject(DomSanitizer);
  // finance
  protected depStatus = signal(''); // all deposits by default
  // withdrawals
  protected deposits = signal<Deposit[]>([]);
  protected wStatus = signal('pending_review');
  protected withdrawals = signal<Withdrawal[]>([]);
  protected note = signal('');
  protected txRef = signal('');
  // withdrawal popups
  protected globalPopup = signal<WithdrawalPopupConfig>({
    enabled: false,
    title: 'Important Withdrawal Notice',
    message: '',
    type: 'info',
    blocking: false,
    buttonText: 'Understood',
    buttonAction: 'close',
  });
  protected userPopup = signal<WithdrawalPopupConfig>({
    enabled: false,
    title: '',
    message: '',
    type: 'warning',
    blocking: false,
    buttonText: 'Understood',
    buttonAction: 'close',
  });
  protected previewPopup = signal<WithdrawalPopupConfig | null>(null);
  protected popupTypes = [
    { id: 'info' as const, label: 'Info (Cyan)' },
    { id: 'warning' as const, label: 'Warning (Amber)' },
    { id: 'error' as const, label: 'Error / Alert (Red)' },
    { id: 'success' as const, label: 'Success (Green)' },
  ];
  protected popupActions = [
    { id: 'close' as const, label: 'Close popup' },
    { id: 'support' as const, label: 'Open Support Chat' },
    { id: 'kyc' as const, label: 'Go to KYC Profile' },
    { id: 'deposit' as const, label: 'Go to Deposit' },
  ];
  // assets
  protected assets = signal<AdminAsset[]>([]);
  // bonuses
  protected bonusJson = signal('');
  // ledger / trades
  protected ledgerFilter = signal({ userId: '', type: '', accountType: '' });
  protected ledger = signal<{ total: number; rows: Ledger[] }>({ total: 0, rows: [] });
  protected tradeFilter = signal({ userId: '', symbol: '', status: '', accountType: '' });
  protected trades = signal<{ total: number; rows: Trade[] }>({ total: 0, rows: [] });
  protected audit = signal<Audit | null>(null);
  // chat
  protected convos = signal<Conversation[]>([]);
  protected chatUser = signal<Conversation | null>(null);
  protected chatMsgs = signal<ChatMsg[]>([]);
  protected reply = signal('');
  // tournaments
  protected tournaments = signal<Tournament[]>([]);
  protected tForm = signal({ name: '', description: '', startsAt: '', endsAt: '', entryFee: 0, startingBalance: 1000, prizes: '50,25,10' });

  protected busy = signal(false);
  protected tabLabel = computed(() => this.tabs.find((t) => t.id === this.tab())?.label ?? '');

  constructor() {
    effect(() => {
      const t = this.tab();
      untracked(() => void this.loadTab(t));
    });
    const offs = [
      this.socket.on<Deposit>('admin:deposit', (d) => this.onDepositEvent(d)),
      this.socket.on('admin:withdrawal', () => this.tab() === 'withdrawals' && void this.loadTab('withdrawals')),
      this.socket.on('admin:kyc', () => this.tab() === 'kyc' && void this.loadTab('kyc')),
      this.socket.on<{ userId: string; message: ChatMsg }>('admin:chat', (e) => {
        if (this.chatUser()?.userId === e.userId) this.chatMsgs.update((l) => [...l, e.message]);
        if (this.tab() === 'chat') void this.loadConvos();
        else this.toast.info('New support message');
      }),
    ];
    inject(DestroyRef).onDestroy(() => offs.forEach((o) => o()));
  }

  protected go(t: Tab) {
    this.tab.set(t);
    this.navOpen.set(false);
  }

  private async loadTab(t: Tab) {
    try {
      switch (t) {
        case 'dashboard': {
          const [st, recent] = await Promise.all([this.api.get<Record<string, number>>('/admin/stats'), this.api.get<Deposit[]>('/admin/deposits', { limit: 12 })]);
          this.stats.set(st);
          this.recentDeposits.set(recent);
          break;
        }
        case 'users':
          await this.searchUsers();
          break;
        case 'kyc':
          this.kyc.set(await this.api.get('/admin/kyc', { status: 'pending' }));
          break;
        case 'deposits':
          this.deposits.set(await this.api.get('/admin/deposits', { status: this.depStatus() || undefined }));
          break;
        case 'withdrawals': {
          const [w, pop] = await Promise.all([
            this.api.get<Withdrawal[]>('/admin/withdrawals', { status: this.wStatus() || undefined }),
            this.api.get<WithdrawalPopupConfig>('/admin/settings/withdrawal-popup').catch(() => null),
          ]);
          this.withdrawals.set(w);
          if (pop) this.globalPopup.set(pop);
          break;
        }
        case 'assets':
          this.assets.set(await this.api.get('/admin/assets'));
          break;
        case 'crypto': {
          const [w, l] = await Promise.all([this.api.get<CryptoWalletRow[]>('/admin/settings/crypto'), this.api.get<{ minDeposit: number; maxDeposit: number; minWithdrawal: number }>('/admin/settings/limits')]);
          this.wallets.set(w);
          this.limits.set({ minDeposit: l.minDeposit / 100, maxDeposit: l.maxDeposit / 100, minWithdrawal: l.minWithdrawal / 100 });
          break;
        }
        case 'bonuses':
          this.bonusJson.set(JSON.stringify(await this.api.get('/admin/settings/bonuses'), null, 2));
          break;
        case 'ledger':
          await this.loadLedger();
          break;
        case 'trades':
          await this.loadTrades();
          break;
        case 'chat':
          await this.loadConvos();
          break;
        case 'tournaments':
          this.tournaments.set(await this.api.get('/admin/tournaments'));
          break;
      }
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }

  private async act<T>(fn: () => Promise<T>, ok?: string) {
    this.busy.set(true);
    try {
      const r = await fn();
      if (ok) this.toast.success(ok);
      return r;
    } catch (e) {
      this.toast.error((e as ApiError).message);
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------- users ----------------
  protected async searchUsers() {
    this.users.set(await this.api.get('/admin/users', { q: this.userQ() }));
  }
  protected async openUser(id: string) {
    const d = await this.api.get<UserDetail>(`/admin/users/${id}`);
    this.detail.set(d);
    this.adj.set({ accountId: d.accounts.find((a) => a.type === 'real')?.id ?? '', bucket: 'cash', amount: 0, note: '' });
    if (d.user.withdrawalPopup) {
      this.userPopup.set({ ...d.user.withdrawalPopup });
    } else {
      this.userPopup.set({
        enabled: false,
        title: 'Account Verification Required',
        message: '',
        type: 'warning',
        blocking: false,
        buttonText: 'Understood',
        buttonAction: 'close',
      });
    }
  }

  protected async saveUserPopup() {
    const d = this.detail();
    if (!d) return;
    await this.act(() => this.api.patch(`/admin/users/${d.user.id}/withdrawal-popup`, this.userPopup()), 'Custom withdrawal popup saved for user');
    await this.openUser(d.user.id);
  }

  protected async saveGlobalPopup() {
    await this.act(() => this.api.put('/admin/settings/withdrawal-popup', this.globalPopup()), 'Global withdrawal popup saved');
  }

  protected updateGlobalPopup<K extends keyof WithdrawalPopupConfig>(k: K, v: WithdrawalPopupConfig[K]) {
    this.globalPopup.update((p) => ({ ...p, [k]: v }));
  }

  protected updateUserPopup<K extends keyof WithdrawalPopupConfig>(k: K, v: WithdrawalPopupConfig[K]) {
    this.userPopup.update((p) => ({ ...p, [k]: v }));
  }
  protected async patchUser(id: string, body: Record<string, unknown>) {
    await this.act(() => this.api.patch(`/admin/users/${id}`, body), 'User updated');
    await this.openUser(id);
    await this.searchUsers();
  }
  protected async adjust() {
    const d = this.detail();
    const a = this.adj();
    if (!d) return;
    await this.act(() => this.api.post(`/admin/users/${d.user.id}/adjust`, { ...a, amount: Math.round(Number(a.amount) * 100) }), 'Balance adjusted (ledger entry written)');
    await this.openUser(d.user.id);
  }
  protected setAdj(k: 'accountId' | 'bucket' | 'amount' | 'note', v: string | number) {
    this.adj.update((x) => ({ ...x, [k]: v }));
  }

  // ---------------- kyc ----------------
  protected async viewDoc(id: string, mime: string) {
    const blob = await this.api.blob(`/admin/kyc/file/${id}`);
    const prev = this.preview();
    if (prev) URL.revokeObjectURL(prev.url);
    const url = URL.createObjectURL(blob);
    // blob: URL created locally from an authenticated admin download
    this.preview.set({ url, mime, safe: this.sanitizer.bypassSecurityTrustResourceUrl(url) });
  }
  protected async reviewKyc(userId: string, status: 'approved' | 'rejected') {
    await this.act(() => this.api.post(`/admin/kyc/${userId}/review`, { status, note: this.kycNote() || undefined }), `KYC ${status}`);
    this.kycNote.set('');
    await this.loadTab('kyc');
  }

  // ---------------- deposits / withdrawals ----------------
  protected async depositAction(d: Deposit, action: 'approve' | 'reject') {
    if (action === 'reject' && !this.note()) return this.toast.error('Enter a rejection note first');
    await this.act(() => this.api.post(`/admin/deposits/${d.id}/${action}`, action === 'reject' ? { note: this.note() } : {}), `Deposit ${action}d`);
    await this.loadTab('deposits');
  }
  protected async wAction(w: Withdrawal, action: 'approve' | 'reject' | 'mark-paid') {
    if (action === 'reject' && !this.note()) return this.toast.error('Enter a rejection note first');
    if (action === 'mark-paid' && !this.txRef()) return this.toast.error('Enter the payout transaction reference');
    const body = action === 'reject' ? { note: this.note() } : action === 'mark-paid' ? { txRef: this.txRef() } : {};
    await this.act(() => this.api.post(`/admin/withdrawals/${w.id}/${action}`, body), action === 'approve' ? 'Approved: payout started' : action === 'reject' ? 'Rejected: funds returned' : 'Marked as paid');
    await this.loadTab('withdrawals');
  }

  // ---------------- assets ----------------
  protected async saveAsset(a: AdminAsset) {
    await this.act(
      () =>
        this.api.patch(`/admin/assets/${a.symbol}`, {
          payout: Number(a.payout),
          enabled: a.enabled,
          minTradeCents: Math.round(Number(a.minTradeCents)),
          maxTradeCents: Math.round(Number(a.maxTradeCents)),
          ...(a.cfd ? { cfd: { enabled: a.cfd.enabled, spread: Number(a.cfd.spread), leverage: Number(a.cfd.leverage) } } : {}),
        }),
      `${a.name} saved`,
    );
  }

  // ---------------- bonuses ----------------
  protected formatBonusJson() {
    try {
      const parsed = JSON.parse(this.bonusJson());
      this.bonusJson.set(JSON.stringify(parsed, null, 2));
      this.toast.success('JSON formatted');
    } catch {
      this.toast.error('Invalid JSON syntax');
    }
  }

  // ---------------- live deposits ----------------
  protected recentDeposits = signal<Deposit[]>([]);
  /** Every deposit change arrives here instantly (created, paid, cancelled, failed, approved). */
  private onDepositEvent(d: Deposit) {
    const upsert = (list: Deposit[]) => [d, ...list.filter((x) => x.id !== d.id)];
    this.recentDeposits.update((l) => upsert(l).slice(0, 12));
    if (this.tab() === 'deposits' && (!this.depStatus() || this.depStatus() === d.status)) this.deposits.update(upsert);
    if (this.tab() === 'dashboard') void this.api.get<Record<string, number>>('/admin/stats').then((s) => this.stats.set(s));
    const who = d.username ?? 'A user';
    const amt = money(d.amount);
    if (d.status === 'completed') {
      this.sound.playDeposit();
      this.toast.success(`💰 ${who} deposited ${amt} via ${this.methodLabel(d.method)}`);
    } else if (d.status === 'cancelled') this.toast.info(`${who} cancelled a ${amt} deposit`);
    else if (d.status === 'failed') this.toast.error(`${who}'s ${amt} deposit failed: ${d.failureReason ?? 'not completed'}`);
    else if (d.status === 'awaiting_review') this.toast.info(`${who} submitted a ${amt} crypto deposit for review`);
    else if (d.status === 'processing') this.toast.info(`${who} started a ${amt} M-Pesa deposit`);
  }

  // ---------------- limits ----------------
  protected limits = signal({ minDeposit: 10, maxDeposit: 10000, minWithdrawal: 10 });
  protected setLimit(k: 'minDeposit' | 'maxDeposit' | 'minWithdrawal', v: number) {
    this.limits.update((l) => ({ ...l, [k]: Number(v) }));
  }
  protected async saveLimits() {
    const l = this.limits();
    await this.act(
      () => this.api.put('/admin/settings/limits', { minDeposit: Math.round(l.minDeposit * 100), maxDeposit: Math.round(l.maxDeposit * 100), minWithdrawal: Math.round(l.minWithdrawal * 100) }),
      'Limits saved: users see them immediately',
    );
  }

  // ---------------- crypto wallets ----------------
  protected wallets = signal<CryptoWalletRow[]>([]);
  protected editWallet(i: number, k: keyof CryptoWalletRow, v: string | boolean) {
    this.wallets.update((l) => l.map((w, idx) => (idx === i ? { ...w, [k]: typeof v === 'string' ? v.trim() : v } : w)));
  }
  protected addWallet() {
    this.wallets.update((l) => [...l, { code: 'coin' + (l.length + 1), coin: 'COIN', name: 'New coin', network: 'Network', address: '', popular: false, enabled: false }]);
  }
  protected removeWallet(i: number) {
    this.wallets.update((l) => l.filter((_, idx) => idx !== i));
  }
  protected async saveWallets() {
    const saved = await this.act(() => this.api.put<CryptoWalletRow[]>('/admin/settings/crypto', this.wallets()), 'Crypto wallets saved');
    if (saved) this.wallets.set(saved);
  }

  protected async saveBonuses() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.bonusJson());
    } catch {
      return this.toast.error('Invalid JSON');
    }
    await this.act(() => this.api.put('/admin/settings/bonuses', parsed), 'Bonus configuration saved');
  }

  // ---------------- ledger / trades ----------------
  protected async loadLedger() {
    const f = this.ledgerFilter();
    this.ledger.set(await this.api.get('/admin/ledger', { userId: f.userId || undefined, type: f.type || undefined, accountType: f.accountType || undefined, limit: 200 }));
  }
  protected setLedger(k: 'userId' | 'type' | 'accountType', v: string) {
    this.ledgerFilter.update((x) => ({ ...x, [k]: v }));
  }
  protected async loadTrades() {
    const f = this.tradeFilter();
    this.trades.set(await this.api.get('/admin/trades', { userId: f.userId || undefined, symbol: f.symbol || undefined, status: f.status || undefined, accountType: f.accountType || undefined, limit: 200 }));
  }
  protected setTradeF(k: 'userId' | 'symbol' | 'status' | 'accountType', v: string) {
    this.tradeFilter.update((x) => ({ ...x, [k]: v }));
  }
  protected async openAudit(id: string) {
    this.audit.set(await this.api.get(`/admin/trades/${id}/audit`));
  }

  // ---------------- chat ----------------
  private async loadConvos() {
    this.convos.set(await this.api.get('/admin/chat/conversations'));
  }
  protected async openChat(c: Conversation) {
    this.chatUser.set(c);
    this.chatMsgs.set(await this.api.get(`/admin/chat/${c.userId}`));
    void this.loadConvos();
  }
  protected async sendReply() {
    const c = this.chatUser();
    const text = this.reply().trim();
    if (!c || !text) return;
    const m = await this.act(() => this.api.post<ChatMsg>(`/admin/chat/${c.userId}`, { text }));
    if (m) {
      this.chatMsgs.update((l) => [...l, m]);
      this.reply.set('');
    }
  }

  // ---------------- tournaments ----------------
  protected setT(k: string, v: string | number) {
    this.tForm.update((x) => ({ ...x, [k]: v }));
  }
  protected async createTournament() {
    const f = this.tForm();
    await this.act(
      () =>
        this.api.post('/admin/tournaments', {
          name: f.name,
          description: f.description,
          startsAt: new Date(f.startsAt).toISOString(),
          endsAt: new Date(f.endsAt).toISOString(),
          entryFee: Math.round(Number(f.entryFee) * 100),
          startingBalance: Math.round(Number(f.startingBalance) * 100),
          prizes: f.prizes
            .split(',')
            .map((p) => Math.round(Number(p.trim()) * 100))
            .filter((p) => p > 0),
        }),
      'Tournament created',
    );
    await this.loadTab('tournaments');
  }
  protected async deleteTournament(id: string) {
    await this.act(() => this.api.delete(`/admin/tournaments/${id}`), 'Tournament deleted');
    await this.loadTab('tournaments');
  }
}
