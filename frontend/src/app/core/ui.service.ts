import { Injectable, effect, signal } from '@angular/core';
import { Direction } from './models';

export type RightPanel = 'trades' | 'signals' | 'social' | 'pending' | null;
export type ChartType = 'area' | 'candles' | 'bars' | 'line';
export type Scene = 'mountains' | 'aurora' | 'sunrise' | 'none';

const KEY = 'y2.ui.v1';

interface Persisted {
  symbol: string;
  cfdSymbol: string;
  mode: 'classic' | 'pro';
  timeframe: number;
  window: number;
  chartType: ChartType;
  durationSec: number;
  amount: number;
  indicators: string[];
  scene: Scene;
  rightPanel: RightPanel;
}

const defaults: Persisted = {
  symbol: 'BTCUSD_OTC',
  cfdSymbol: 'BTCUSDT',
  mode: 'classic',
  timeframe: 60,
  window: 120,
  chartType: 'area',
  durationSec: 30,
  amount: 1000,
  indicators: [],
  scene: 'mountains',
  rightPanel: 'trades',
};

function load(): Persisted {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted>) };
  } catch {
    return defaults;
  }
}

/** Terminal UI state (per device). */
@Injectable({ providedIn: 'root' })
export class UiService {
  private init = load();
  readonly symbol = signal(this.init.symbol);
  readonly cfdSymbol = signal(this.init.cfdSymbol);
  readonly mode = signal<'classic' | 'pro'>(this.init.mode);
  readonly timeframe = signal(this.init.timeframe); // candle size (Pro mode)
  readonly window = signal(this.init.window); // visible seconds (Classic mode)
  readonly chartType = signal<ChartType>(this.init.chartType);
  readonly durationSec = signal(this.init.durationSec);
  readonly amount = signal(this.init.amount);
  readonly indicators = signal<string[]>(this.init.indicators);
  readonly scene = signal<Scene>(this.init.scene);
  readonly rightPanel = signal<RightPanel>(this.init.rightPanel);

  // ephemeral
  readonly hoverDirection = signal<Direction | null>(null);
  readonly chatOpen = signal(false);
  readonly mobileNav = signal(false);
  readonly mobileSheet = signal(false);
  readonly assetPicker = signal(false);
  readonly crosshair = signal(true);
  readonly drawTool = signal<'none' | 'hline' | 'trend'>('none');
  readonly clearDrawings = signal(0);

  constructor() {
    effect(() => {
      const v: Persisted = {
        symbol: this.symbol(),
        cfdSymbol: this.cfdSymbol(),
        mode: this.mode(),
        timeframe: this.timeframe(),
        window: this.window(),
        chartType: this.chartType(),
        durationSec: this.durationSec(),
        amount: this.amount(),
        indicators: this.indicators(),
        scene: this.scene(),
        rightPanel: this.rightPanel(),
      };
      try {
        localStorage.setItem(KEY, JSON.stringify(v));
      } catch {
        /* private mode */
      }
    });
  }

  toggleIndicator(id: string) {
    this.indicators.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  sceneUrl(s: Scene = this.scene()) {
    if (s === 'none') return 'none';
    if (s === 'mountains') return 'url(/img/terminal-bg.jpg)';
    if (s === 'sunrise') return 'url(/img/hero-bg.jpg)';
    return `url(/img/scene-${s}.svg)`;
  }
}

/**
 * Trading sound effects, synthesised with Web Audio (no files, no latency).
 * Soft bell/marimba tones go through a master bus with a gentle compressor and a short
 * generated reverb so they sound "sweet" rather than beepy.
 *
 * Browsers only allow audio after a user gesture, so the context is created and resumed on the
 * first tap/click/key anywhere on the page; sounds triggered later by the server (win/loss) then work.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private reverb: GainNode | null = null;
  readonly enabled = signal<boolean>(typeof window !== 'undefined' ? localStorage.getItem('y2.sound.enabled') !== 'false' : true);

  constructor() {
    effect(() => {
      try {
        localStorage.setItem('y2.sound.enabled', String(this.enabled()));
      } catch {
        /* private mode */
      }
    });
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.initCtx();
        if (this.ctx?.state === 'running') {
          window.removeEventListener('pointerdown', unlock, true);
          window.removeEventListener('keydown', unlock, true);
        }
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
  }

  toggle() {
    this.enabled.update((v) => !v);
    if (this.enabled()) this.playClick();
  }

  private initCtx(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      comp.connect(ctx.destination);
      const bus = ctx.createGain();
      bus.gain.value = 0.9;
      bus.connect(comp);
      // Short, airy reverb from a generated impulse response.
      const conv = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 1.2);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      conv.connect(wet).connect(comp);
      this.ctx = ctx;
      this.bus = bus;
      this.reverb = conv as unknown as GainNode;
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** One bell/marimba note: sine fundamental + soft inharmonic partials, fast attack, exponential decay. */
  private bell(freq: number, at: number, dur: number, vol: number, bright = 1) {
    const ctx = this.ctx!;
    const partials: [number, number][] = [
      [1, 1],
      [2.01, 0.28 * bright],
      [3.99, 0.1 * bright],
    ];
    for (const [mult, amp] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * mult, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol * amp, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur / mult ** 0.5);
      osc.connect(g);
      g.connect(this.bus!);
      g.connect(this.reverb as unknown as AudioNode);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    }
  }

  private play(fn: (now: number) => void) {
    if (!this.enabled()) return;
    const ctx = this.initCtx();
    if (!ctx || !this.bus) return;
    fn(ctx.currentTime + 0.01);
  }

  /** Trade placed: a rising two-note chime for BUY, falling for SELL. */
  playTradeOpen(direction: 'up' | 'down' = 'up') {
    this.play((t) => {
      const [a, b] = direction === 'up' ? [659.25, 987.77] : [987.77, 659.25]; // E5 ↔ B5
      this.bell(a, t, 0.35, 0.16);
      this.bell(b, t + 0.085, 0.55, 0.18);
    });
  }

  /** Winning trade: sparkling major arpeggio with a soft shimmer on top. */
  playWin() {
    this.play((t) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.bell(f, t + i * 0.07, 0.9, 0.15));
      this.bell(2093, t + 0.3, 1.1, 0.05, 0.4);
    });
  }

  /** Losing trade: mellow, quiet descending minor third (not harsh). */
  playLoss() {
    this.play((t) => {
      this.bell(440, t, 0.45, 0.1, 0.5);
      this.bell(349.23, t + 0.14, 0.7, 0.09, 0.4);
    });
  }

  /** Draw / refund: a single neutral chime. */
  playDraw() {
    this.play((t) => this.bell(587.33, t, 0.6, 0.12, 0.6));
  }

  /** Successful deposit: bright "cha-ching". */
  playDeposit() {
    this.play((t) => {
      this.bell(1318.5, t, 0.25, 0.12);
      this.bell(1760, t + 0.09, 0.9, 0.16);
      this.bell(2637, t + 0.1, 0.8, 0.05, 0.3);
    });
  }

  /** Last seconds before expiry: soft wooden tick. */
  playTick() {
    this.play((t) => this.bell(1400, t, 0.08, 0.05, 0.2));
  }

  playClick() {
    this.play((t) => this.bell(1200, t, 0.05, 0.04, 0.1));
  }
}


