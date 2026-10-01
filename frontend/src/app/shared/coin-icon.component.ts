import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Round crypto coin badge (USDT, BTC, ETH, BNB, SOL…) drawn with SVG, no image files. */
@Component({
  selector: 'app-coin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true">
      @switch (sym()) {
        @case ('USDT') {
          <circle cx="20" cy="20" r="20" fill="#26A17B" />
          <path d="M11 11h18v5h-6.5v3.1c4.3.3 7.5 1.3 7.5 2.4s-3.2 2.1-7.5 2.4V31h-5v-7.1c-4.3-.3-7.5-1.3-7.5-2.4s3.2-2.1 7.5-2.4V16H11z" fill="#fff" />
          <ellipse cx="20" cy="21.5" rx="6.4" ry="1.3" fill="#26A17B" />
        }
        @case ('BTC') {
          <circle cx="20" cy="20" r="20" fill="#F7931A" />
          <text x="20" y="27.5" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Arial, sans-serif" transform="rotate(12 20 20)">₿</text>
        }
        @case ('ETH') {
          <circle cx="20" cy="20" r="20" fill="#fff" />
          <path d="M20 6l-8 14 8 4.6 8-4.6z" fill="#343434" />
          <path d="M20 6v18.6l8-4.6z" fill="#8C8C8C" />
          <path d="M20 26.3l-8-4.7L20 34l8-12.4z" fill="#3C3C3B" />
          <path d="M20 26.3V34l8-12.4z" fill="#8C8C8C" />
        }
        @case ('BNB') {
          <circle cx="20" cy="20" r="20" fill="#F3BA2F" />
          <g fill="#fff">
            <path d="M20 9l3.2 3.2-6.4 6.4-3.2-3.2zM26.4 15.4l3.2 3.2-9.6 9.6-3.2-3.2zM13.6 15.4l3.2 3.2-3.2 3.2-3.2-3.2zM20 24.9l3.2 3.2L20 31.3l-3.2-3.2z" />
            <path d="M20 16.8l3.2 3.2-3.2 3.2-3.2-3.2z" />
          </g>
        }
        @case ('SOL') {
          <circle cx="20" cy="20" r="20" fill="#0F1420" />
          <defs>
            <linearGradient id="solg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF" /><stop offset="1" stop-color="#14F195" /></linearGradient>
          </defs>
          <g fill="url(#solg)">
            <path d="M12.5 25.5h13.8l2.6-2.6H15.1zM12.5 14.5h13.8l2.6 2.6H15.1zM15.1 21.3h13.8l-2.6-2.6H12.5z" />
          </g>
        }
        @default {
          <circle cx="20" cy="20" r="20" fill="url(#cg)" />
          <defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2DD4BF" /><stop offset="1" stop-color="#2F80ED" /></linearGradient></defs>
          <text x="20" y="25.5" text-anchor="middle" font-size="13" font-weight="800" fill="#fff" font-family="Arial, sans-serif">{{ sym().slice(0, 4) }}</text>
        }
      }
    </svg>
  `,
  styles: [':host{display:inline-grid;place-items:center;flex:none;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.35)}'],
})
export class CoinIconComponent {
  readonly coin = input.required<string>();
  readonly size = input(40);
  protected sym = computed(() => this.coin().toUpperCase());
}
