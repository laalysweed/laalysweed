import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { LogoComponent } from '../../shared/logo.component';
import { IconComponent } from '../../shared/icon.component';
import { AccountSwitcherComponent } from './account-switcher.component';
import { AccountMenuComponent } from './account-menu.component';
import { ChatPanelComponent } from './chat-panel.component';
import { OnboardingComponent } from '../onboarding/onboarding.component';
import { SpotlightDirective } from '../../core/spotlight';
import { AuthService } from '../../core/auth.service';
import { UiService, SoundService } from '../../core/ui.service';
import { MarketService } from '../../core/market.service';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { ChatMsg } from '../../core/models';
import { pct } from '../../core/format';

interface NavItem {
  id: string;
  label: string;
  icon: string;
  link?: string;
  badge?: () => number;
}

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, LogoComponent, IconComponent, AccountSwitcherComponent, AccountMenuComponent, ChatPanelComponent, OnboardingComponent, SpotlightDirective],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected auth = inject(AuthService);
  protected ui = inject(UiService);
  protected sound = inject(SoundService);
  protected market = inject(MarketService);
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private router = inject(Router);

  protected tradingMenu = signal(false);
  protected financeMenu = signal(false);
  protected url = signal(this.router.url);
  protected unread = signal(0);

  protected isTrading = computed(() => this.url().startsWith('/app/trading') || this.url().startsWith('/app/cfd'));
  protected product = computed(() => (this.url().startsWith('/app/cfd') ? 'CFD' : 'OTC'));

  protected nav: NavItem[] = [
    { id: 'trading', label: 'Trading', icon: 'trading' },
    { id: 'finance', label: 'Finance', icon: 'finance', link: '/app/finance' },
    { id: 'profile', label: 'Profile', icon: 'profile', link: '/app/profile' },
    { id: 'referrals', label: 'Referrals', icon: 'referrals', link: '/app/referrals' },
    { id: 'chat', label: 'Chat', icon: 'chat', badge: () => this.unread() },
    { id: 'tournaments', label: 'Tournaments', icon: 'trophy', link: '/app/tournaments' },
    { id: 'history', label: 'History', icon: 'history', link: '/app/history' },
    { id: 'help', label: 'Help', icon: 'help', link: '/app/help' },
  ];

  protected mobileNav = computed(() => this.nav.filter((n) => ['trading', 'finance', 'chat', 'history', 'profile'].includes(n.id)));

  protected promos = computed(() => {
    const dismissed = this.auth.user()?.dismissedPromos ?? [];
    return [
      { id: 'bonus50', icon: 'gift', title: 'GET 50% BONUS', sub: 'On your first deposit', link: '/app/finance/deposit' },
      { id: 'tradersbox', icon: 'dice', title: "TRADER'S BOX", sub: 'receive a random reward', link: '/app/finance/bonuses' },
    ].filter((p) => !dismissed.includes(p.id));
  });

  protected pinned = computed(() =>
    (this.auth.user()?.pinnedAssets ?? [])
      .map((s) => this.market.asset(s))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({ ...a, change: pct(this.market.changePct(a.symbol)), up: this.market.changePct(a.symbol) >= 0 })),
  );

  constructor() {
    void this.market.loadAssets();
    const destroy = inject(DestroyRef);
    const sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.url.set((e as NavigationEnd).urlAfterRedirects);
      this.ui.mobileNav.set(false);
      this.tradingMenu.set(false);
      this.financeMenu.set(false);
    });
    destroy.onDestroy(() => sub.unsubscribe());

    // Chat badge: unread support messages.
    void this.api.get<{ count: number }>('/chat/unread').then((r) => this.unread.set(r.count));
    const off = this.socket.on<ChatMsg>('chat:message', (m) => {
      if (m.from === 'support' && !this.ui.chatOpen()) this.unread.update((n) => n + 1);
    });
    this.socket.joinRoom('summary');
    destroy.onDestroy(() => {
      off();
      this.socket.leaveRoom('summary');
    });
  }

  protected navClick(item: NavItem, ev: Event) {
    if (item.id === 'trading') {
      ev.preventDefault();
      this.tradingMenu.update((v) => !v);
      this.financeMenu.set(false);
      this.sound.playClick();
      return;
    }
    if (item.id === 'finance') {
      ev.preventDefault();
      this.financeMenu.update((v) => !v);
      this.tradingMenu.set(false);
      this.sound.playClick();
      return;
    }
    if (item.id === 'chat') {
      ev.preventDefault();
      this.openChat();
      return;
    }
    this.tradingMenu.set(false);
    this.financeMenu.set(false);
    this.sound.playClick();
  }

  protected openChat() {
    this.ui.chatOpen.set(true);
    this.unread.set(0);
    this.tradingMenu.set(false);
    this.financeMenu.set(false);
    this.sound.playClick();
  }

  protected goTrading(kind: 'otc' | 'cfd') {
    this.tradingMenu.set(false);
    this.sound.playClick();
    void this.router.navigateByUrl(kind === 'otc' ? '/app/trading' : '/app/cfd');
  }

  protected goFinance(path: string) {
    this.financeMenu.set(false);
    this.sound.playClick();
    void this.router.navigateByUrl(path);
  }

  protected selectPinned(symbol: string) {
    if (this.market.asset(symbol)?.cfd && this.url().startsWith('/app/cfd')) this.ui.cfdSymbol.set(symbol);
    else {
      this.ui.symbol.set(symbol);
      if (!this.url().startsWith('/app/trading')) void this.router.navigateByUrl('/app/trading');
    }
  }

  protected async dismissPromo(id: string, ev: Event) {
    ev.preventDefault();
    ev.stopPropagation();
    this.auth.patchUser({ dismissedPromos: [...(this.auth.user()?.dismissedPromos ?? []), id] });
    await this.api.post('/me/promos/dismiss', { promo: id }).catch(() => undefined);
  }

  protected isActive(item: NavItem) {
    const u = this.url();
    if (item.id === 'trading') return this.isTrading();
    if (item.id === 'chat') return this.ui.chatOpen();
    return !!item.link && u.startsWith(item.link);
  }
}
