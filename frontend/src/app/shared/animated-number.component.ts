import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { money, price } from '../core/format';

/** Tweens between numeric values (money in cents by default) with an ease-out curve. */
@Component({
  selector: 'app-num',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.up]': 'flash() === "up"', '[class.down]': 'flash() === "down"' },
  template: `{{ text() }}`,
  styles: [':host{font-variant-numeric:tabular-nums;transition:color .4s var(--ease)} :host(.up){color:var(--buy)} :host(.down){color:var(--sell)}'],
})
export class AnimatedNumberComponent {
  readonly value = input.required<number>();
  readonly kind = input<'money' | 'price' | 'int'>('money');
  readonly precision = input(2);
  readonly duration = input(600);
  readonly flashOnChange = input(false);

  protected text = signal('');
  protected flash = signal<'up' | 'down' | null>(null);
  private current = 0;
  private raf = 0;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
    let first = true;
    effect(() => {
      const target = this.value();
      untracked(() => {
        if (first) {
          first = false;
          this.current = target;
          this.text.set(this.fmt(target));
          return;
        }
        if (this.flashOnChange() && target !== this.current) {
          this.flash.set(target > this.current ? 'up' : 'down');
          clearTimeout(this.flashTimer);
          this.flashTimer = setTimeout(() => this.flash.set(null), 700);
        }
        this.animate(this.current, target);
      });
    });
  }

  private animate(from: number, to: number) {
    cancelAnimationFrame(this.raf);
    const start = performance.now();
    const d = this.duration();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / d);
      const e = 1 - Math.pow(1 - t, 3);
      this.current = from + (to - from) * e;
      this.text.set(this.fmt(t === 1 ? to : this.current));
      if (t < 1) this.raf = requestAnimationFrame(step);
      else this.current = to;
    };
    this.raf = requestAnimationFrame(step);
  }

  private fmt(v: number) {
    if (this.kind() === 'money') return money(Math.round(v));
    if (this.kind() === 'int') return Math.round(v).toLocaleString('en-US');
    return price(v, this.precision());
  }
}
