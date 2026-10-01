import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { HistoryRow } from '../../core/models';
import { METHOD_LABELS, STATUS_LABELS, dateTime, signedMoney, statusTone } from '../../core/format';

type Kind = 'all' | 'deposits' | 'withdrawals' | 'internal';
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Component({
  selector: 'app-finance-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="filters anim-rise">
      <div class="kinds">
        @for (k of kinds; track k.id) {
          <button [class.on]="kind() === k.id" (click)="kind.set(k.id); load()">{{ k.label }}</button>
        }
      </div>
      <div class="range">
        <app-icon name="clock" [size]="18" />
        <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)" />
        <span>–</span>
        <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" />
      </div>
      <button class="btn btn-primary apply" (click)="load()">Apply</button>
      <button class="btn btn-ghost" (click)="csv()" [disabled]="!rows().length"><app-icon name="download" [size]="18" /> CSV</button>
    </div>

    @if (loading()) {
      <div class="card-solid"><div class="skeleton" style="height: 200px"></div></div>
    } @else if (rows().length) {
      <div class="card-solid table-wrap flush anim-fade">
        <table class="table">
          <thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td>{{ dt(r.createdAt) }}</td>
                <td class="cap">{{ r.kind }}</td>
                <td>{{ label(r.method) }}</td>
                <td class="num" [class.up-text]="r.amount > 0" [class.down-text]="r.amount < 0"><b>{{ signed(r.amount) }}</b></td>
                <td><span class="badge" [class]="tone(r.status)">{{ status(r.status) }}</span></td>
                <td class="muted">{{ r.reference || '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="empty big anim-fade">No transactions found for this filter and date range.</div>
    }
  `,
  styleUrl: './finance.scss',
})
export class FinanceHistoryComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  protected kinds: { id: Kind; label: string }[] = [
    { id: 'deposits', label: 'Deposits' },
    { id: 'withdrawals', label: 'Withdrawal' },
    { id: 'internal', label: 'Internal transfers' },
    { id: 'all', label: 'All Types' },
  ];
  protected kind = signal<Kind>('all');
  protected from = signal(iso(new Date(Date.now() - 90 * 86_400_000)));
  protected to = signal(iso(new Date()));
  protected rows = signal<HistoryRow[]>([]);
  protected loading = signal(true);
  protected dt = dateTime;
  protected signed = signedMoney;
  protected tone = statusTone;
  protected status = (s: string) => STATUS_LABELS[s] ?? s;
  protected label = (m: string) => METHOD_LABELS[m] ?? m.replace(/_/g, ' ');

  constructor() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      this.rows.set(await this.api.get<HistoryRow[]>('/finance/history', { type: this.kind(), from: this.from(), to: this.to() }));
    } finally {
      this.loading.set(false);
    }
  }

  protected async csv() {
    try {
      const blob = await this.api.blob('/finance/history.csv', { type: this.kind(), from: this.from(), to: this.to() });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `y2markets-history-${this.to()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.toast.error('Export failed');
    }
  }
}
