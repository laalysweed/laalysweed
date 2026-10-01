import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icon.component';
import { UiService } from '../../core/ui.service';
import { SpotlightService } from '../../core/spotlight';

const FAQ = [
  { cat: 'Getting started', q: 'What is a demo account?', a: 'Every new account gets $10,000 of virtual funds to practise with. Demo trades use the same live prices as real trades. You can reset the demo balance anytime from the account switcher.' },
  { cat: 'Getting started', q: 'How does a fixed-time trade work?', a: 'Choose an asset, an amount and a duration, then press BUY if you think the price will be higher at expiry or SELL if lower. If you are right you receive your stake plus the payout % shown. If the price is exactly the same at expiry, your stake is refunded.' },
  { cat: 'Trading', q: 'Which price is used to open and close my trade?', a: "Our server uses its own latest recorded tick when your order arrives (never the price in your browser), and closes the trade at the last recorded tick at or before expiry. Every tick is stored, and you can replay any trade from the trade details." },
  { cat: 'Trading', q: 'What are OTC assets?', a: 'OTC instruments are priced by our independent pricing engine and are available 24/7, including weekends. The engine has no access to client positions or balances, and every generated price is recorded for audit.' },
  { cat: 'Trading', q: 'What is Pro mode and CFD trading?', a: 'Pro mode switches the chart to candlesticks with indicators and drawing tools. CFD trading (Trading → CFD Trading) lets you buy or sell in lots with leverage, stop-loss and take-profit, and close positions whenever you like.' },
  { cat: 'Trading', q: 'How do AI signals work?', a: 'The assistant scans 1-minute candles for EMA(9/21) crossovers and RSI(14) extremes. Every signal is later checked against the real outcome, and the 7-day accuracy is displayed honestly. Signals are informational, not financial advice.' },
  { cat: 'Deposits & withdrawals', q: 'How do I deposit with M-Pesa?', a: 'Go to Finance → Deposit, choose M-Pesa, enter the amount and your Safaricom number. You will receive a prompt on your phone; enter your PIN and the funds are credited automatically, usually within a minute.' },
  { cat: 'Deposits & withdrawals', q: 'What are the minimum amounts and fees?', a: 'The minimum deposit and withdrawal is $10. We charge no commission on deposits or withdrawals.' },
  { cat: 'Deposits & withdrawals', q: 'How long do withdrawals take?', a: 'Withdrawals are reviewed by our finance team, usually within a few hours, and then paid to your M-Pesa or USDT wallet. You need a verified e-mail address, and funds go only to accounts in your name.' },
  { cat: 'Bonuses', q: 'How do bonuses work?', a: 'Bonuses are optional. Bonus funds are kept in a separate balance from your deposit and convert to cash once you reach the turnover shown. You can cancel a bonus at any time; only the bonus balance is removed.' },
  { cat: 'Bonuses', q: "What is the Trader's Box?", a: 'An optional reward for your first deposit of $25 or more. The odds of every reward are shown before you opt in, and the draw happens on our server with a cryptographically secure random number generator.' },
  { cat: 'Account & security', q: 'How do I secure my account?', a: 'Enable two-factor authentication in Profile, use a unique password and log out of devices you no longer use from the Active sessions list.' },
  { cat: 'Account & security', q: 'Why do I need to verify my identity?', a: 'Identity verification (KYC) protects you and helps us prevent fraud and money laundering. Upload your ID and a selfie in Profile; our team reviews documents quickly.' },
];

@Component({
  selector: 'app-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RouterLink],
  template: `
    <div class="page">
      <h1>Help centre</h1>
      <div class="search card-solid"><app-icon name="search" [size]="20" /><input placeholder="Search questions…" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
      <div class="quick grid-3">
        <button class="card-solid" (click)="tour()"><app-icon name="play" [size]="26" /><b>Take the guided tour</b><small class="muted">A 1-minute walkthrough of the terminal</small></button>
        <button class="card-solid" (click)="ui.chatOpen.set(true)"><app-icon name="chat" [size]="26" /><b>Chat with support</b><small class="muted">We reply in minutes, 24/7</small></button>
        <a class="card-solid" routerLink="/legal/risk"><app-icon name="warn" [size]="26" /><b>Risk disclosure</b><small class="muted">Understand the risks of trading</small></a>
      </div>
      @for (g of groups(); track g.cat) {
        <h3>{{ g.cat }}</h3>
        <div class="faq">
          @for (f of g.items; track f.q) {
            <div class="item" [class.open]="open() === f.q">
              <button (click)="open.set(open() === f.q ? null : f.q)">{{ f.q }}<app-icon name="chevron-down" [size]="18" /></button>
              <div class="ans"><div><p>{{ f.a }}</p></div></div>
            </div>
          }
        </div>
      } @empty {
        <div class="empty">No results for “{{ q() }}”. <button class="link" (click)="ui.chatOpen.set(true)">Ask support</button></div>
      }
    </div>
  `,
  styles: [
    `.search{display:flex;gap:12px;align-items:center;padding:0 18px;height:58px;margin-bottom:16px;background:rgba(22,28,42,.92)}
     .search input{flex:1;background:none;border:0;outline:none;font-size:17px}.search app-icon{color:var(--muted)}
     .quick{margin-bottom:10px}.quick>*{display:flex;flex-direction:column;gap:6px;align-items:flex-start;text-align:left;background:rgba(22,28,42,.92);color:var(--text);transition:transform .25s var(--ease),border-color .25s var(--ease)}
     .quick>*:hover{transform:translateY(-3px);border-color:rgba(56,189,248,.4)}.quick app-icon{color:var(--brand-b)}
     h3{font-family:var(--font-ui);font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 0 10px}
     .faq{display:flex;flex-direction:column;gap:8px}
     .item{border-radius:12px;background:rgba(22,28,42,.92);border:1px solid var(--border);transition:border-color .25s var(--ease)}
     .item.open{border-color:rgba(56,189,248,.35)}
     .item>button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 20px;background:none;border:0;text-align:left;font-size:16px;font-weight:600}
     .item app-icon{transition:transform .3s var(--ease);flex:none}.item.open app-icon{transform:rotate(180deg)}
     .ans{display:grid;grid-template-rows:0fr;transition:grid-template-rows .32s var(--ease)}.item.open .ans{grid-template-rows:1fr}
     .ans>div{overflow:hidden}.ans p{margin:0;padding:0 20px 18px;color:#c5cedc;line-height:1.65}
     .empty{padding:40px;text-align:center;color:var(--muted)}.link{background:none;border:0;color:var(--brand-a);font-weight:600}`,
  ],
})
export class HelpComponent {
  protected ui = inject(UiService);
  private spot = inject(SpotlightService);
  private router = inject(Router);
  protected q = signal('');
  protected open = signal<string | null>(null);
  protected groups = computed(() => {
    const q = this.q().trim().toLowerCase();
    const items = FAQ.filter((f) => !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
    const cats = [...new Set(items.map((i) => i.cat))];
    return cats.map((cat) => ({ cat, items: items.filter((i) => i.cat === cat) }));
  });

  protected tour() {
    this.spot.tourRequest.update((n) => n + 1);
    void this.router.navigateByUrl('/app/trading');
  }
}
