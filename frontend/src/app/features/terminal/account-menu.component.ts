import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { AccountService } from '../../core/account.service';
import { ApiService } from '../../core/api.service';
import { UiService, Scene } from '../../core/ui.service';
import { IconComponent } from '../../shared/icon.component';
import { money, signedMoney } from '../../core/format';

interface Stats {
  today: { trades: number; turnover: number; profit: number };
}

@Component({
  selector: 'app-account-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './account-menu.component.html',
  styleUrl: './account-menu.component.scss',
})
export class AccountMenuComponent {
  protected auth = inject(AuthService);
  protected accounts = inject(AccountService);
  protected ui = inject(UiService);
  private api = inject(ApiService);

  protected open = signal(false);
  protected hideEmail = signal(false);
  protected stats = signal<Stats | null>(null);
  protected refreshing = signal(false);
  protected picker = signal(false);
  protected money = money;
  protected signed = signedMoney;

  protected initials = computed(() =>
    (this.auth.user()?.fullName ?? '?')
      .split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
  );
  protected isReal = computed(() => this.accounts.active()?.type === 'real');
  protected scenes: { id: Scene; label: string }[] = [
    { id: 'mountains', label: 'Mountains' },
    { id: 'aurora', label: 'Aurora' },
    { id: 'sunrise', label: 'Sunrise' },
    { id: 'none', label: 'Plain' },
  ];

  protected toggle() {
    this.open.update((v) => !v);
    if (this.open()) void this.loadStats();
  }

  protected async loadStats() {
    this.refreshing.set(true);
    try {
      this.stats.set(await this.api.get<Stats>('/me/stats'));
    } finally {
      this.refreshing.set(false);
    }
  }

  protected async togglePublic(v: boolean) {
    this.auth.patchUser({ isPublic: v });
    await this.api.patch('/me', { isPublic: v });
  }

  protected close() {
    this.open.set(false);
    this.picker.set(false);
  }

  protected logout() {
    this.close();
    void this.auth.logout();
  }
}
