import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AccountService } from '../../core/account.service';
import { SocketService } from '../../core/socket.service';
import { ToastService } from '../../core/toast.service';
import { ClockService } from '../../core/clock.service';
import { IconComponent } from '../../shared/icon.component';
import { ApiError, Tournament } from '../../core/models';
import { dateTime, money } from '../../core/format';

@Component({
  selector: 'app-tournaments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="page">
      <h1>Tournaments</h1>
      <p class="muted lead">Everyone starts with the same tournament balance. Trade any asset; the highest balance when the clock runs out wins real cash prizes, paid to your real account.</p>
      <div class="list">
        @for (t of list(); track t.id) {
          <article class="t card-solid anim-rise" [attr.data-status]="t.status">
            <div class="t-head">
              <span class="trophy"><app-icon name="trophy" [size]="30" /></span>
              <div><h3>{{ t.name }}</h3><small class="muted">{{ t.description }}</small></div>
              <span class="badge" [class.green]="t.status === 'running'" [class.blue]="t.status === 'upcoming'">{{ t.status }}</span>
            </div>
            <div class="facts">
              <div><span>Prize pool</span><b class="gradient-text">{{ money(t.prizePool) }}</b></div>
              <div><span>Entry</span><b>{{ t.entryFee ? money(t.entryFee) : 'Free' }}</b></div>
              <div><span>Start balance</span><b>{{ money(t.startingBalance) }}</b></div>
              <div><span>Players</span><b>{{ t.participants }}</b></div>
              <div><span>{{ t.status === 'upcoming' ? 'Starts in' : t.status === 'running' ? 'Ends in' : 'Ended' }}</span><b class="num">{{ t.status === 'finished' ? dt(t.endsAt) : countdown(t.status === 'upcoming' ? t.startsAt : t.endsAt) }}</b></div>
            </div>
            <div class="prizes">@for (p of t.prizes; track $index) { <span>#{{ $index + 1 }} {{ money(p) }}</span> }</div>
            <div class="actions">
              @if (t.joined) {
                @if (t.status === 'running') { <button class="btn btn-buy" (click)="play(t)">Trade in tournament</button> }
                @else { <span class="badge green">Joined</span> }
              } @else if (t.status !== 'finished') {
                <button class="btn btn-brand" (click)="join(t)" [disabled]="busy() === t.id">{{ t.entryFee ? 'Join for ' + money(t.entryFee) : 'Join free' }}</button>
              }
              <button class="btn btn-ghost" (click)="board(t)">Leaderboard</button>
            </div>
          </article>
        } @empty {
          <div class="empty">No tournaments scheduled right now. Check back soon!</div>
        }
      </div>
    </div>

    @if (selected(); as s) {
      <div class="back anim-fade" (click)="selected.set(null)"></div>
      <div class="modal anim-pop">
        <header><h3>{{ s.name }}</h3><button class="icon-btn" (click)="selected.set(null)"><app-icon name="close" [size]="16" /></button></header>
        @if (s.myRank) { <p class="muted">Your rank: <b>#{{ s.myRank }}</b></p> }
        <div class="lb">
          @for (r of s.leaderboard ?? []; track r.rank) {
            <div class="lb-row" [class.me]="r.me" [class.top]="r.rank <= 3"><span class="rank">{{ r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : '#' + r.rank }}</span><b>{{ r.username }}</b><span class="muted">{{ r.country }}</span><span class="spacer"></span><b class="num">{{ money(r.balance) }}</b></div>
          } @empty { <div class="empty">No players yet. Be the first!</div> }
        </div>
      </div>
    }
  `,
  styles: [
    `.lead{max-width:760px;margin:-8px 0 22px}
     .list{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}@media(max-width:640px){.list{grid-template-columns:1fr}}
     .t{background:rgba(22,28,42,.92);display:flex;flex-direction:column;gap:16px;transition:transform .25s var(--ease),border-color .25s var(--ease)}
     .t:hover{transform:translateY(-3px);border-color:rgba(245,184,65,.35)}.t[data-status='finished']{opacity:.7}
     .t-head{display:flex;gap:14px;align-items:flex-start}.t-head h3{font-size:20px}.t-head .badge{margin-left:auto;text-transform:capitalize}
     .trophy{display:grid;place-items:center;flex:none;width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,rgba(245,184,65,.3),rgba(245,184,65,.08));color:#fbbf24}
     .facts{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.facts div{padding:10px;border-radius:10px;background:rgba(0,0,0,.2)}
     .facts span{display:block;font-size:11px;color:var(--muted)}.facts b{font-size:14.5px}@media(max-width:640px){.facts{grid-template-columns:repeat(2,1fr)}}
     .prizes{display:flex;gap:6px;flex-wrap:wrap}.prizes span{font-size:12px;padding:4px 10px;border-radius:999px;background:rgba(245,184,65,.1);color:#fcd34d}
     .actions{display:flex;gap:10px;align-items:center}
     .empty{padding:40px;text-align:center;color:var(--muted)}
     .back{position:fixed;inset:0;z-index:95;background:rgba(6,9,15,.6)}
     .modal{position:fixed;z-index:96;top:50%;left:50%;translate:-50% -50%;width:min(520px,calc(100vw - 24px));max-height:84vh;overflow-y:auto;padding:20px;border-radius:18px;background:#1a2030;border:1px solid var(--border-strong);box-shadow:var(--shadow-2)}
     .modal header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
     .lb-row{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:10px}.lb-row:nth-child(odd){background:rgba(255,255,255,.03)}
     .lb-row.me{background:rgba(47,128,237,.18);border:1px solid rgba(47,128,237,.5)}.rank{width:36px}`,
  ],
})
export class TournamentsComponent {
  private api = inject(ApiService);
  private accounts = inject(AccountService);
  private socket = inject(SocketService);
  private toast = inject(ToastService);
  private clock = inject(ClockService);
  private router = inject(Router);
  protected list = signal<Tournament[]>([]);
  protected selected = signal<Tournament | null>(null);
  protected busy = signal<string | null>(null);
  protected money = money;
  protected dt = dateTime;

  constructor() {
    void this.load();
    this.socket.joinRoom('tournaments');
    const off = this.socket.on('tournament:update', () => void this.load());
    inject(DestroyRef).onDestroy(() => {
      off();
      this.socket.leaveRoom('tournaments');
    });
  }

  private async load() {
    this.list.set(await this.api.get<Tournament[]>('/tournaments'));
  }

  protected countdown(iso: string) {
    const s = Math.max(0, Math.floor((new Date(iso).getTime() - this.clock.now()) / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s % 60}s`;
  }

  protected async join(t: Tournament) {
    this.busy.set(t.id);
    try {
      const r = await this.api.post<{ accountId: string }>(`/tournaments/${t.id}/join`);
      await this.accounts.load();
      this.toast.success(`You joined ${t.name}!`);
      await this.load();
      if (t.status === 'running') await this.play({ ...t, accountId: r.accountId });
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(null);
    }
  }

  protected async play(t: Tournament) {
    if (!t.accountId) return;
    try {
      await this.accounts.switchTo(t.accountId);
      this.toast.info(`Trading in ${t.name}. Switch back to Demo or Real from the balance menu.`);
      void this.router.navigateByUrl('/app/trading');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }

  protected async board(t: Tournament) {
    this.selected.set(await this.api.get<Tournament>(`/tournaments/${t.id}`));
  }
}
