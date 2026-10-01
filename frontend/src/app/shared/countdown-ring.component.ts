import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ClockService } from '../core/clock.service';

/** Circular countdown for an open trade. */
@Component({
  selector: 'app-countdown-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="17" class="track" />
      <circle cx="20" cy="20" r="17" class="bar" [attr.stroke]="color()" [attr.stroke-dasharray]="C" [attr.stroke-dashoffset]="offset()" />
    </svg>
    <span class="t">{{ label() }}</span>
  `,
  styles: [
    `:host{position:relative;display:inline-grid;place-items:center}
     svg{transform:rotate(-90deg)}
     .track{fill:none;stroke:rgba(255,255,255,.1);stroke-width:3}
     .bar{fill:none;stroke-width:3;stroke-linecap:round;transition:stroke-dashoffset .25s linear}
     .t{position:absolute;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums}`,
  ],
})
export class CountdownRingComponent {
  private clock = inject(ClockService);
  readonly start = input.required<string>();
  readonly end = input.required<string>();
  readonly color = input('#38BDF8');
  readonly size = input(40);
  protected readonly C = 2 * Math.PI * 17;

  private remainingMs = computed(() => Math.max(0, new Date(this.end()).getTime() - this.clock.now()));
  protected offset = computed(() => {
    const total = new Date(this.end()).getTime() - new Date(this.start()).getTime();
    return this.C * (1 - this.remainingMs() / Math.max(1, total));
  });
  protected label = computed(() => {
    const s = Math.ceil(this.remainingMs() / 1000);
    return s >= 3600 ? `${Math.floor(s / 3600)}h` : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
  });
}
