import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Glowing candlestick loader (same markup/styles as the boot loader in index.html). */
@Component({
  selector: 'app-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.overlay]': 'overlay()', role: 'status', 'aria-label': 'Loading' },
  template: `
    <div class="y2-loader">
      <div class="y2-candles">
        <span class="red" style="--i: 0; --o: -4px; --h: 30px"><b></b></span>
        <span class="red dim" style="--i: 1; --o: 4px; --h: 34px"><b></b></span>
        <span class="green dim" style="--i: 2; --o: 14px; --h: 18px"><b></b></span>
        <span class="green" style="--i: 3; --o: 0px; --h: 40px"><b></b></span>
        <span class="green bright" style="--i: 4; --o: -12px; --h: 36px"><b></b></span>
      </div>
      @if (label()) {
        <div class="y2-word">{{ label() }}</div>
      }
    </div>
  `,
  styles: [
    `:host{display:grid;place-items:center;padding:40px}
     :host(.overlay){position:fixed;inset:0;z-index:900;background:rgba(15,20,32,.92);backdrop-filter:blur(6px);animation:fade-in .3s var(--ease) both}`,
  ],
})
export class LoaderComponent {
  readonly overlay = input(false);
  readonly label = input<string | null>('Y2 MARKETS');
}
