import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

const TITLES: Record<string, string> = { deposit: 'Account top-up', withdrawal: 'Withdrawal', history: 'Balance history', bonuses: 'Bonuses' };

@Component({
  selector: 'app-finance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink],
  template: `
    <div class="page">
      <h1>{{ title() }}</h1>
      <nav class="tabs">
        <button routerLink="deposit" [class.active]="tab() === 'deposit'">Deposit</button>
        <button routerLink="withdrawal" [class.active]="tab() === 'withdrawal'">Withdrawal</button>
        <button routerLink="history" [class.active]="tab() === 'history'">History</button>
        <button routerLink="bonuses" [class.active]="tab() === 'bonuses'">Bonuses</button>
      </nav>
      <div class="outlet"><router-outlet /></div>
    </div>
  `,
  styles: [`.tabs{margin-bottom:26px;flex-wrap:wrap} .outlet{animation:fade-in .3s var(--ease)} @media(max-width:640px){.tabs button{padding:0 14px;height:40px;font-size:12px}}`],
})
export class FinanceComponent {
  private router = inject(Router);
  private url = signal(this.router.url);
  protected tab = computed(() => this.url().split('?')[0]!.split('/').pop() ?? 'deposit');
  protected title = computed(() => TITLES[this.tab()] ?? 'Finance');
  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => this.url.set((e as NavigationEnd).urlAfterRedirects));
  }
}
