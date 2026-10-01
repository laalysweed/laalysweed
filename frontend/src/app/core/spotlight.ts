import { DestroyRef, Directive, ElementRef, Injectable, effect, inject, input, signal } from '@angular/core';

/**
 * Tiny spotlight engine for the guided tour.
 * Elements register with [spotlight]="key"; the service measures the current target every frame
 * while active, so the highlight animates smoothly between elements and follows layout changes.
 */
@Injectable({ providedIn: 'root' })
export class SpotlightService {
  // A key can be registered by several elements (e.g. desktop + mobile copies); the visible one wins.
  private targets = new Map<string, Set<HTMLElement>>();
  readonly rect = signal<DOMRect | null>(null);
  readonly activeKey = signal<string | null>(null);
  /** Incremented by the Help page to (re)start the guided tour. */
  readonly tourRequest = signal(0);
  private raf = 0;

  register(key: string, el: HTMLElement) {
    let set = this.targets.get(key);
    if (!set) this.targets.set(key, (set = new Set()));
    set.add(el);
  }
  unregister(key: string, el: HTMLElement) {
    this.targets.get(key)?.delete(el);
  }
  private visible(key: string): HTMLElement | undefined {
    for (const el of this.targets.get(key) ?? []) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
    }
    return undefined;
  }
  has(key: string) {
    return !!this.visible(key);
  }

  focus(key: string | null) {
    this.activeKey.set(key);
    cancelAnimationFrame(this.raf);
    if (!key) {
      this.rect.set(null);
      return;
    }
    const el = this.visible(key);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const loop = () => {
      const target = this.visible(key);
      const r = target?.getBoundingClientRect() ?? null;
      const prev = this.rect();
      if (!prev || !r || prev.x !== r.x || prev.y !== r.y || prev.width !== r.width || prev.height !== r.height) this.rect.set(r);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
}

@Directive({ selector: '[spotlight]' })
export class SpotlightDirective {
  readonly spotlight = input.required<string>();
  constructor() {
    const svc = inject(SpotlightService);
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    let current: string | null = null;
    effect(() => {
      if (current) svc.unregister(current, el);
      current = this.spotlight();
      svc.register(current, el);
    });
    inject(DestroyRef).onDestroy(() => current && svc.unregister(current, el));
  }
}
