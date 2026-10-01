import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterNextRender, computed, inject, signal, viewChild, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LogoComponent } from '../../shared/logo.component';
import { IconComponent } from '../../shared/icon.component';
import { HeroMapComponent } from './hero-map.component';
import { AuthDrawerService } from '../auth/auth-drawer.service';
import { AuthService } from '../../core/auth.service';
import { MarketService } from '../../core/market.service';
import { SocketService } from '../../core/socket.service';
import { Asset } from '../../core/models';
import { pct, price } from '../../core/format';
import { I18nService } from '../../core/i18n.service';

const NAV_IDS = ['markets', 'trading', 'platforms', 'partners'];

@Component({
  selector: 'app-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LogoComponent, IconComponent, HeroMapComponent, RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent implements OnInit {
  protected drawer = inject(AuthDrawerService);
  protected auth = inject(AuthService);
  protected market = inject(MarketService);
  protected i18n = inject(I18nService);
  private socket = inject(SocketService);
  private router = inject(Router);
  private host = inject(ElementRef<HTMLElement>);

  protected nav = computed(() => [
    { id: 'markets', label: this.i18n.t().navMarkets },
    { id: 'trading', label: this.i18n.t().navTrading },
    { id: 'platforms', label: this.i18n.t().navPlatforms },
    { id: 'partners', label: this.i18n.t().navPartners },
  ]);
  protected activeNav = signal<string | null>(null);
  protected indicator = signal<{ left: number; width: number; visible: boolean }>({ left: 0, width: 0, visible: false });
  protected mobileMenu = signal(false);
  protected langOpen = signal(false);
  protected scrolled = signal(false);
  protected category = signal<Asset['category'] | 'all'>('all');
  protected year = new Date().getFullYear();

  private navLinks = viewChildren<ElementRef<HTMLAnchorElement>>('navLink');
  private hero = viewChild<ElementRef<HTMLElement>>('hero');

  protected categories = computed(() => [
    { id: 'all' as const, label: this.i18n.t().all },
    { id: 'crypto' as const, label: this.i18n.t().crypto },
    { id: 'currency' as const, label: this.i18n.t().forex },
    { id: 'commodity' as const, label: this.i18n.t().commodities },
    { id: 'stock' as const, label: this.i18n.t().stocks },
    { id: 'index' as const, label: this.i18n.t().indices },
  ]);

  protected rows = computed(() => {
    const cat = this.category();
    const summary = this.market.summary();
    return this.market
      .assets()
      .filter((a) => cat === 'all' || a.category === cat)
      .slice(0, 10)
      .map((a) => {
        const s = summary.get(a.symbol);
        const p = s?.price ?? a.price;
        const ch = s?.changePct ?? a.changePct;
        return { ...a, priceText: price(p, a.precision), changeText: pct(ch), up: ch >= 0 };
      });
  });

  protected topMarketCards = computed(() => {
    const summary = this.market.summary();
    const items = [
      { sym: 'BTC/USD', name: 'BTC/USD', defaultP: 63753.20, defaultC: 2.35, icon: '₿', color: '#2dd4bf', path: 'M0,35 Q30,10 60,30 T120,25 T180,15 T240,5' },
      { sym: 'ETH/USD', name: 'ETH/USD', defaultP: 3240.10, defaultC: 1.72, icon: 'Ξ', color: '#38bdf8', path: 'M0,38 Q35,25 70,32 T140,20 T200,12 T240,6' },
      { sym: 'XAU/USD', name: 'XAU/USD', defaultP: 2341.80, defaultC: 0.82, icon: 'G', color: '#2dd4bf', path: 'M0,32 Q40,40 80,22 T150,28 T210,14 T240,8' },
      { sym: 'AAPL.O', name: 'AAPL.O', defaultP: 192.23, defaultC: 0.68, icon: '', color: '#ffffff', path: 'M0,28 Q50,26 100,30 T180,24 T240,18' },
    ];
    return items.map((it) => {
      const match = this.market.assets().find((a) => a.symbol.includes(it.sym.replace('/', '')));
      const s = match ? summary.get(match.symbol) : undefined;
      const p = s?.price ?? it.defaultP;
      const ch = s?.changePct ?? it.defaultC;
      return {
        ...it,
        priceText: p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        changeText: `+${ch.toFixed(2)}%`,
        up: ch >= 0,
      };
    });
  });

  protected scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected selectLang(code: string) {
    this.i18n.setLanguage(code);
    this.langOpen.set(false);
  }

  protected features = computed(() => [
    { icon: 'bolt', title: this.i18n.t().f1Title, text: this.i18n.t().f1Text },
    { icon: 'wallet', title: this.i18n.t().f2Title, text: this.i18n.t().f2Text },
    { icon: 'shield', title: this.i18n.t().f3Title, text: this.i18n.t().f3Text },
    { icon: 'globe', title: this.i18n.t().f4Title, text: this.i18n.t().f4Text },
    { icon: 'trophy', title: this.i18n.t().f5Title, text: this.i18n.t().f5Text },
    { icon: 'social', title: this.i18n.t().f6Title, text: this.i18n.t().f6Text },
  ]);

  constructor() {
    const destroy = inject(DestroyRef);
    this.socket.joinRoom('summary');
    destroy.onDestroy(() => this.socket.leaveRoom('summary'));

    afterNextRender(() => {
      // Scroll spy for the navbar underline.
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) this.activeNav.set(e.target.id);
          this.moveIndicator();
        },
        { rootMargin: '-45% 0px -50% 0px' },
      );
      for (const id of NAV_IDS) {
        const el = document.getElementById(id);
        if (el) io.observe(el);
      }
      const onScroll = () => {
        this.scrolled.set(window.scrollY > 20);
        if (window.scrollY < 200) {
          this.activeNav.set(null);
          this.moveIndicator();
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });

      // Mouse parallax (rAF-throttled, writes CSS vars only).
      let raf = 0;
      const heroEl = this.hero()?.nativeElement;
      const onMove = (ev: MouseEvent) => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const r = heroEl!.getBoundingClientRect();
          heroEl!.style.setProperty('--mx', (((ev.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
          heroEl!.style.setProperty('--my', (((ev.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
        });
      };
      heroEl?.addEventListener('mousemove', onMove);

      destroy.onDestroy(() => {
        io.disconnect();
        window.removeEventListener('scroll', onScroll);
        heroEl?.removeEventListener('mousemove', onMove);
      });
    });
  }

  ngOnInit() {
    this.drawer.consumeQuery();
    void this.market.loadAssets();
  }

  protected hoverNav(i: number | null) {
    const links = this.navLinks();
    const navItems = this.nav();
    const target = i === null ? links[navItems.findIndex((n) => n.id === this.activeNav())] : links[i];
    if (!target) return this.indicator.update((x) => ({ ...x, visible: false }));
    const el = target.nativeElement;
    this.indicator.set({ left: el.offsetLeft, width: el.offsetWidth, visible: true });
  }

  private moveIndicator() {
    this.hoverNav(null);
  }

  protected go(id: string, ev?: Event) {
    ev?.preventDefault();
    this.mobileMenu.set(false);
    this.host.nativeElement.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected start(mode: 'signup' | 'login' = 'signup') {
    this.mobileMenu.set(false);
    if (this.auth.isLoggedIn()) void this.router.navigateByUrl('/app/trading');
    else this.drawer.show(mode);
  }

  protected trade(symbol: string) {
    if (this.auth.isLoggedIn()) void this.router.navigate(['/app/trading'], { queryParams: { symbol } });
    else this.drawer.show('signup');
  }
}
