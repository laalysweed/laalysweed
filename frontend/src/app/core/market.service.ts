import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { Asset, Candle, SummaryRow, Tick } from './models';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private api = inject(ApiService);
  private socket = inject(SocketService);

  readonly assets = signal<Asset[]>([]);
  readonly assetMap = computed(() => new Map(this.assets().map((a) => [a.symbol, a])));
  readonly summary = signal<Map<string, SummaryRow>>(new Map());
  readonly ticks$ = new Subject<Tick>();

  private prices = new Map<string, WritableSignal<number | null>>();
  private sentiments = new Map<string, WritableSignal<{ up: number; down: number }>>();
  private loading: Promise<void> | null = null;

  constructor() {
    this.socket.on<Tick>('tick', (t) => {
      this.priceSignal(t.s).set(t.p);
      this.ticks$.next(t);
    });
    this.socket.on<SummaryRow[]>('market:summary', (rows) => {
      this.summary.set(new Map(rows.map((r) => [r.symbol, r])));
      for (const r of rows) if (r.price) this.priceSignal(r.symbol).set(r.price);
    });
    this.socket.on<{ symbol: string; up: number; down: number }>('sentiment', (s) => this.sentimentSignal(s.symbol).set({ up: s.up, down: s.down }));
  }

  loadAssets(force = false) {
    if (!this.loading || force) {
      this.loading = this.api.get<Asset[]>('/market/assets').then((a) => {
        this.assets.set(a);
        for (const x of a) if (x.price != null) this.priceSignal(x.symbol).set(x.price);
      });
    }
    return this.loading;
  }

  asset(symbol: string) {
    return this.assetMap().get(symbol);
  }

  private priceSignal(symbol: string) {
    let s = this.prices.get(symbol);
    if (!s) this.prices.set(symbol, (s = signal<number | null>(null)));
    return s;
  }

  private sentimentSignal(symbol: string) {
    let s = this.sentiments.get(symbol);
    if (!s) this.sentiments.set(symbol, (s = signal({ up: 50, down: 50 })));
    return s;
  }

  price(symbol: string): Signal<number | null> {
    return this.priceSignal(symbol).asReadonly();
  }

  sentiment(symbol: string): Signal<{ up: number; down: number }> {
    return this.sentimentSignal(symbol).asReadonly();
  }

  changePct(symbol: string) {
    return this.summary().get(symbol)?.changePct ?? this.asset(symbol)?.changePct ?? 0;
  }

  subscribe(symbol: string) {
    this.socket.subscribeSymbol(symbol);
  }
  unsubscribe(symbol: string) {
    this.socket.unsubscribeSymbol(symbol);
  }

  candles(symbol: string, tf: number, limit = 300) {
    return this.api.get<Candle[]>('/market/candles', { symbol, tf, limit });
  }
}
