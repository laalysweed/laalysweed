import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { AnimatedNumberComponent } from '../../shared/animated-number.component';
import { dateTime, money } from '../../core/format';

interface Referrals {
  code: string;
  link: string;
  commissionPct: number;
  stats: { invited: number; depositors: number; totalCommission: number };
  referrals: { username: string; country: string; joinedAt: string; deposited: boolean }[];
  commissions: { id: string; amount: number; createdAt: string }[];
}

@Component({
  selector: 'app-referrals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AnimatedNumberComponent],
  template: `
    <div class="page">
      <h1>Referrals</h1>
      @if (data(); as d) {
        <div class="hero card anim-rise">
          <div>
            <h2>Earn {{ d.commissionPct }}% of every deposit</h2>
            <p class="muted">Invite friends with your personal link. When they deposit, you earn a {{ d.commissionPct }}% commission paid instantly to your real account.</p>
            <div class="link-box">
              <code>{{ d.link }}</code>
              <button class="btn btn-brand" (click)="copy(d.link)"><app-icon name="copy" [size]="18" /> Copy link</button>
            </div>
            <div class="share">
              <a class="btn btn-soft sm" [href]="'https://wa.me/?text=' + enc('Join me on Y2 Markets: ' + d.link)" target="_blank" rel="noopener">WhatsApp</a>
              <a class="btn btn-soft sm" [href]="'https://t.me/share/url?url=' + enc(d.link)" target="_blank" rel="noopener">Telegram</a>
              <a class="btn btn-soft sm" [href]="'https://twitter.com/intent/tweet?text=' + enc('Trading on Y2 Markets ' + d.link)" target="_blank" rel="noopener">X</a>
              <span class="muted">Referral code: <b>{{ d.code }}</b></span>
            </div>
          </div>
        </div>
        <div class="grid-3 stats">
          <div class="card-solid"><span>Invited</span><b><app-num [value]="d.stats.invited" kind="int" /></b></div>
          <div class="card-solid"><span>Made a deposit</span><b><app-num [value]="d.stats.depositors" kind="int" /></b></div>
          <div class="card-solid"><span>Total commission</span><b class="up-text"><app-num [value]="d.stats.totalCommission" /></b></div>
        </div>
        <div class="grid-2">
          <div class="card-solid">
            <h3>Your referrals</h3>
            @for (r of d.referrals; track $index) {
              <div class="r-row"><span class="ava">{{ r.username[0]?.toUpperCase() }}</span><div><b>{{ r.username }}</b><small class="muted">{{ r.country }} · joined {{ dt(r.joinedAt) }}</small></div>
                <span class="badge" [class.green]="r.deposited">{{ r.deposited ? 'Deposited' : 'Registered' }}</span></div>
            } @empty { <div class="empty">No referrals yet. Share your link to get started.</div> }
          </div>
          <div class="card-solid">
            <h3>Commission history</h3>
            @for (c of d.commissions; track c.id) {
              <div class="r-row"><app-icon name="gift" [size]="20" /><span class="muted">{{ dt(c.createdAt) }}</span><b class="up-text">+{{ money(c.amount) }}</b></div>
            } @empty { <div class="empty">No commissions yet.</div> }
          </div>
        </div>
      } @else {
        <div class="skeleton" style="height: 220px"></div>
      }
    </div>
  `,
  styles: [
    `.hero{padding:32px;background:linear-gradient(120deg,rgba(45,212,191,.14),rgba(56,189,248,.08) 55%,rgba(22,28,42,.8));margin-bottom:16px}
     .hero h2{font-size:28px;margin-bottom:8px}.hero p{max-width:640px}
     .link-box{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:18px 0 12px;padding:8px 8px 8px 16px;border-radius:12px;background:rgba(0,0,0,.25);max-width:680px}
     .link-box code{flex:1;min-width:0;word-break:break-all}
     .share{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
     .stats{margin-bottom:16px}.stats span{display:block;color:var(--muted);font-size:13px}.stats b{font-size:28px;font-family:var(--font-head)}
     .card-solid{background:rgba(22,28,42,.92)} h3{font-family:var(--font-ui);font-size:17px;margin-bottom:10px}
     .r-row{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--border)} .r-row small{display:block}.r-row>:last-child{margin-left:auto}
     .ava{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#2dd4bf,#2f80ed);color:#07131a;font-weight:800}
     .empty{padding:24px;text-align:center;color:var(--muted)}`,
  ],
})
export class ReferralsComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  protected data = signal<Referrals | null>(null);
  protected money = money;
  protected dt = dateTime;
  protected enc = encodeURIComponent;

  constructor() {
    void this.api.get<Referrals>('/referrals').then((d) => this.data.set(d));
  }

  protected copy(t: string) {
    void navigator.clipboard?.writeText(t).then(() => this.toast.success('Link copied'));
  }
}
