import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Y2 Markets logo matching reference image:
 * Stylized neon-blue "Y2", 3 rising chart bars, swooping trend arrow, and "MARKETS" wordmark.
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="logo-container" [style.height.px]="size()">
      <svg [attr.height]="size()" viewBox="0 0 100 82" class="y2-mark" aria-hidden="true">
        <defs>
          <!-- Primary neon cyan-to-deep-blue gradient -->
          <linearGradient id="y2grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#00F0FF" />
            <stop offset="45%" stop-color="#0099FF" />
            <stop offset="100%" stop-color="#0044FF" />
          </linearGradient>

          <!-- Outer glowing rim gradient -->
          <linearGradient id="y2rim" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#80FFFF" />
            <stop offset="60%" stop-color="#00D4FF" />
            <stop offset="100%" stop-color="#0066FF" />
          </linearGradient>

          <!-- Arrow gradient -->
          <linearGradient id="arrowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#00D4FF" />
            <stop offset="100%" stop-color="#00F0FF" />
          </linearGradient>

          <!-- Neon bloom glow filter -->
          <filter id="neonGlow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g filter="url(#neonGlow)">
          <!-- Stylized letter 'Y' -->
          <path
            d="M8 12 L24 12 L34 32 L44 12 L60 12 L43 42 L43 56 L31 56 L31 42 Z"
            fill="url(#y2grad)"
            stroke="url(#y2rim)"
            stroke-width="1.6"
            stroke-linejoin="round"
          />

          <!-- Three vertical chart bars between Y and 2 -->
          <rect x="36" y="40" width="4.5" height="15" rx="1.5" fill="url(#y2grad)" stroke="url(#y2rim)" stroke-width="1" />
          <rect x="43" y="32" width="4.5" height="23" rx="1.5" fill="url(#y2grad)" stroke="url(#y2rim)" stroke-width="1" />
          <rect x="50" y="24" width="4.5" height="31" rx="1.5" fill="url(#y2grad)" stroke="url(#y2rim)" stroke-width="1" />

          <!-- Stylized number '2' -->
          <path
            d="M52 24 C52 14, 62 8, 76 8 C88 8, 96 14, 96 24 C96 34, 88 40, 74 48 L88 48 C94 48, 96 50, 96 56 L54 56 C52 56, 52 52, 56 48 L76 34 C82 30, 84 27, 84 22 C84 17, 80 15, 76 15 C70 15, 66 18, 64 24 Z"
            fill="url(#y2grad)"
            stroke="url(#y2rim)"
            stroke-width="1.6"
            stroke-linejoin="round"
          />

          <!-- Swooping rising chart trend arrow -->
          <path
            d="M14 54 C32 52, 54 36, 86 8"
            fill="none"
            stroke="url(#arrowGrad)"
            stroke-width="3.6"
            stroke-linecap="round"
          />
          <!-- Arrowhead pointing up-right -->
          <path
            d="M86 8 L72 10 L79 21 Z"
            fill="#00F0FF"
            stroke="url(#y2rim)"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </g>

        <!-- "MARKETS" text underneath -->
        @if (!wordmark()) {
          <text
            x="50"
            y="74"
            text-anchor="middle"
            font-family="system-ui, -apple-system, sans-serif"
            font-size="11.5"
            font-weight="700"
            letter-spacing="5"
            fill="#a6b8d4"
            class="stacked-markets"
          >MARKETS</text>
        }
      </svg>

      @if (wordmark()) {
        <span class="word" [style.font-size.px]="size() * 0.58">Markets</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        user-select: none;
      }
      .logo-container {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .y2-mark {
        display: block;
        width: auto;
        height: 100%;
        filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.35));
      }
      .stacked-markets {
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
      }
      .word {
        font-family: var(--font-head);
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #fff;
        line-height: 1;
        margin-left: 2px;
      }
    `,
  ],
})
export class LogoComponent {
  readonly size = input(44);
  readonly wordmark = input(true);
}
