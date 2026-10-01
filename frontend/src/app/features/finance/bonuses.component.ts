import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { ApiError, BonusOverview, UserBonus } from '../../core/models';
import { dateTime, money } from '../../core/format';

@Component({
  selector: 'app-bonuses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  template: `
    @if (data(); as d) {
      @if (active(); as b) {
        <div class="card-solid active-bonus anim-rise">
          <div class="row"><span class="badge green">Active</span><h3>{{ b.offer === 'first50' ? '50% first-deposit bonus' : 'Welcome bonus' }}</h3><span class="spacer"></span><b class="big">{{ money(b.amount) }}</b></div>
          <div class="turnover">
            <div class="bar"><i [style.width.%]="progress()"></i></div>
            <div class="row"><span class="muted">Trading turnover</span><span class="spacer"></span><b class="num">{{ money(b.turnoverDone) }} / {{ money(b.turnoverRequired) }}</b><span class="pct">{{ progress().toFixed(1) }}%</span></div>
          </div>
          <p class="muted">When turnover reaches the target, your remaining bonus balance converts to withdrawable cash automatically. Terms version {{ b.termsVersion }}.</p>
          @if (confirming()) {
            <div class="confirm anim-pop">
              <p>Cancel this bonus? Your remaining bonus balance (including bonus funds in open trades) will be removed. Your cash balance is not affected.</p>
              <div class="row"><button class="btn btn-ghost" (click)="confirming.set(false)">Keep bonus</button><button class="btn btn-sell" (click)="cancel(b)" [disabled]="busy()">Yes, cancel bonus</button></div>
            </div>
          } @else {
            <button class="btn btn-ghost" (click)="confirming.set(true)">Cancel bonus</button>
          }
        </div>
      }

      <h3 class="sub-title">Available offers</h3>
      <div class="grid-2">
        @for (o of d.offers; track o.key) {
          <div class="card-solid offer-card anim-rise" [class.dim]="!o.eligible">
            <div class="row"><span class="pc-ico sm"><app-icon name="gift" [size]="22" /></span><h3>{{ o.title }}</h3></div>
            <p class="muted">{{ o.summary }}</p>
            <details><summary>Full terms</summary><ol>@for (t of o.terms; track $index) { <li>{{ t }}</li> }</ol></details>
            @if (o.eligible) { <a class="btn btn-brand pill" routerLink="/app/finance/deposit">Deposit & claim</a> } @else { <span class="badge">Not available on this account</span> }
          </div>
        }
      </div>

      <h3 class="sub-title">Trader's Box</h3>
      <div class="card-solid">
        <div class="grid-2">
          <div>
            <table class="odds">
              <tr><th>Reward</th><th>Probability</th></tr>
              @for (r of d.tradersBox.odds; track r.label) { <tr><td>{{ r.label }}</td><td>{{ (r.probability * 100).toFixed(1) }}%</td></tr> }
            </table>
            <small class="muted">Expected value: {{ money(d.tradersBox.expectedValue) }} · minimum first deposit {{ money(d.tradersBox.minDeposit) }}</small>
          </div>
          <div>
            <ul class="terms-list">@for (t of d.tradersBox.terms; track $index) { <li>{{ t }}</li> }</ul>
            @for (r of d.rolls; track r.id) {
              <div class="roll"><span>🎁</span><b>{{ r.label }}</b><span class="muted">roll {{ r.roll }}/{{ r.weightTotal }} · {{ dt(r.createdAt) }}</span></div>
            }
          </div>
        </div>
      </div>

      @if (history().length) {
        <h3 class="sub-title">Bonus history</h3>
        <div class="card-solid table-wrap flush">
          <table class="table">
            <thead><tr><th>Date</th><th>Offer</th><th>Amount</th><th>Status</th><th>Converted</th><th>Forfeited</th></tr></thead>
            <tbody>
              @for (b of history(); track b.id) {
                <tr><td>{{ dt(b.createdAt) }}</td><td>{{ b.offer }}</td><td class="num">{{ money(b.amount) }}</td>
                  <td><span class="badge" [class.green]="b.status === 'completed'" [class.red]="b.status === 'cancelled'">{{ b.status }}</span></td>
                  <td class="num">{{ b.convertedAmount != null ? money(b.convertedAmount) : '—' }}</td><td class="num">{{ b.forfeitedAmount != null ? money(b.forfeitedAmount) : '—' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    } @else {
      <div class="skeleton" style="height: 240px"></div>
    }
  `,
  styleUrl: './finance.scss',
})
export class BonusesComponent {
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private toast = inject(ToastService);
  protected data = signal<BonusOverview | null>(null);
  protected confirming = signal(false);
  protected busy = signal(false);
  protected active = computed(() => this.data()?.bonuses.find((b) => b.status === 'active') ?? null);
  protected history = computed(() => this.data()?.bonuses.filter((b) => b.status !== 'active') ?? []);
  protected progress = computed(() => {
    const b = this.active();
    return b ? Math.min(100, (b.turnoverDone / b.turnoverRequired) * 100) : 0;
  });
  protected money = money;
  protected dt = dateTime;

  constructor() {
    void this.load();
    const off = this.socket.on<UserBonus>('bonus:update', () => void this.load());
    inject(DestroyRef).onDestroy(off);
  }

  private async load() {
    this.data.set(await this.api.get<BonusOverview>('/bonuses'));
  }

  protected async cancel(b: UserBonus) {
    this.busy.set(true);
    try {
      this.data.set(await this.api.post<BonusOverview>(`/bonuses/${b.id}/cancel`));
      this.toast.info('Bonus cancelled');
      this.confirming.set(false);
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }
}
