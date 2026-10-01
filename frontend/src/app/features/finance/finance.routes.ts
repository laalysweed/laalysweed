import { Routes } from '@angular/router';
import { FinanceComponent } from './finance.component';

export const FINANCE_ROUTES: Routes = [
  {
    path: '',
    component: FinanceComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'deposit' },
      { path: 'deposit', loadComponent: () => import('./deposit.component').then((m) => m.DepositComponent), title: 'Deposit · Y2 Markets' },
      { path: 'withdrawal', loadComponent: () => import('./withdrawal.component').then((m) => m.WithdrawalComponent), title: 'Withdrawal · Y2 Markets' },
      { path: 'history', loadComponent: () => import('./finance-history.component').then((m) => m.FinanceHistoryComponent), title: 'Balance history · Y2 Markets' },
      { path: 'bonuses', loadComponent: () => import('./bonuses.component').then((m) => m.BonusesComponent), title: 'Bonuses · Y2 Markets' },
    ],
  },
];
