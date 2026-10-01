import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MarketService } from '../../core/market.service';
import { pct } from '../../core/format';

interface City {
  name: string;
  lon: number;
  lat: number;
  symbol?: string;
  label?: string;
  chipSide?: 'up' | 'down';
}

const CITIES: City[] = [
  { name: 'New York', lon: -74, lat: 40.7, symbol: 'US100_OTC', chipSide: 'up' },
  { name: 'São Paulo', lon: -46.6, lat: -23.5 },
  { name: 'London', lon: -0.1, lat: 51.5, symbol: 'UK100_OTC', chipSide: 'up' },
  { name: 'Frankfurt', lon: 8.7, lat: 50.1, symbol: 'DE40_OTC', chipSide: 'down' },
  { name: 'Nairobi', lon: 36.8, lat: -1.3, symbol: 'USDKES_OTC', label: 'Nairobi', chipSide: 'down' },
  { name: 'Dubai', lon: 55.3, lat: 25.2, symbol: 'EURUSD_OTC', chipSide: 'down' },
  { name: 'Singapore', lon: 103.8, lat: 1.35, symbol: 'BTCUSDT', label: 'Singapore', chipSide: 'down' },
  { name: 'Tokyo', lon: 139.7, lat: 35.7, symbol: 'JP225_OTC', chipSide: 'up' },
  { name: 'Sydney', lon: 151.2, lat: -33.9 },
  { name: 'Hong Kong', lon: 114.2, lat: 22.3 },
];

const ARCS: [string, string][] = [
  ['New York', 'London'],
  ['London', 'Nairobi'],
  ['Nairobi', 'Dubai'],
  ['Dubai', 'Singapore'],
  ['Singapore', 'Tokyo'],
  ['New York', 'São Paulo'],
  ['Singapore', 'Sydney'],
  ['Frankfurt', 'Dubai'],
  ['Hong Kong', 'Tokyo'],
  ['London', 'New York'],
];

const project = (lon: number, lat: number) => ({ x: ((lon + 180) / 360) * 1000, y: ((80 - lat) / 140) * 389 });

@Component({
  selector: 'app-hero-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hero-map.component.html',
  styleUrl: './hero-map.component.scss',
})
export class HeroMapComponent {
  private market = inject(MarketService);

  protected cities = CITIES.map((c) => ({ ...c, ...project(c.lon, c.lat) }));

  protected arcs = ARCS.map(([a, b], i) => {
    const p = this.cities.find((c) => c.name === a)!;
    const q = this.cities.find((c) => c.name === b)!;
    const dx = q.x - p.x;
    const dist = Math.hypot(dx, q.y - p.y);
    const cx = (p.x + q.x) / 2;
    const cy = Math.min(p.y, q.y) - dist * 0.32;
    return { id: i, d: `M${p.x.toFixed(1)} ${p.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`, delay: (i * 0.7) % 5, dur: 3.2 + (i % 3) * 0.8 };
  });

  protected chips = computed(() => {
    const summary = this.market.summary();
    const defaults: Record<string, { change: number; text: string }> = {
      'New York': { change: 2.35, text: '+2.35%' },
      'London': { change: 1.42, text: '+1.42%' },
      'Tokyo': { change: 1.42, text: '+1.42%' },
      'Dubai': { change: 1.18, text: '+1.18%' },
    };
    return this.cities
      .filter((c) => c.symbol)
      .map((c) => {
        const d = defaults[c.name];
        const row = summary.get(c.symbol!);
        const change = d ? d.change : (row && row.changePct !== 0 ? row.changePct : 1.25);
        const text = d ? d.text : (row && row.changePct !== 0 ? pct(row.changePct) : '+1.25%');
        const up = change >= 0;
        return { ...c, change, text, up, left: c.x / 10, top: (c.y / 389) * 100 };
      });
  });
}
