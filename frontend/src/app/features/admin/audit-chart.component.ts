import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, viewChild } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { ColorType, LineSeries, LineStyle, SeriesMarker, Time, UTCTimestamp, createChart, createSeriesMarkers } from 'lightweight-charts';

/** Tick replay used by the admin trade audit: every recorded tick around the trade, with open/close markers. */
@Component({
  selector: 'app-audit-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #el class="el"></div>`,
  styles: [':host{display:block;height:280px;position:relative}.el{position:absolute;inset:0}'],
})
export class AuditChartComponent {
  readonly ticks = input.required<{ t: number; p: number }[]>();
  readonly openAt = input.required<string>();
  readonly expiresAt = input.required<string>();
  readonly openPrice = input.required<number>();
  readonly closePrice = input<number | null>(null);
  readonly up = input(true);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('el');
  private auth = inject(AuthService);

  constructor() {
    let chart: ReturnType<typeof createChart> | null = null;
    inject(DestroyRef).onDestroy(() => chart?.remove());
    afterNextRender(() => {
      chart = createChart(this.el().nativeElement, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8A93A6', attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,.05)' } },
        timeScale: { timeVisible: true, secondsVisible: true, borderVisible: false },
        rightPriceScale: { borderVisible: false },
      });
      const s = chart.addSeries(LineSeries, { color: '#38BDF8', lineWidth: 2, priceLineVisible: false });
      const off = (this.auth.user()?.timezoneOffset ?? 180) * 60; // show times in the viewer's time zone
      const data: { time: UTCTimestamp; value: number }[] = [];
      for (const k of this.ticks()) {
        const time = (Math.floor(k.t / 1000) + off) as UTCTimestamp;
        if (data.length && data[data.length - 1]!.time === time) data[data.length - 1]!.value = k.p;
        else data.push({ time, value: k.p });
      }
      s.setData(data);
      s.createPriceLine({ price: this.openPrice(), color: this.up() ? '#22C55E' : '#EF4444', lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'open' });
      const cp = this.closePrice();
      if (cp != null) s.createPriceLine({ price: cp, color: '#F5B841', lineStyle: LineStyle.Dotted, lineWidth: 1, title: 'close' });
      const t1 = (Math.floor(new Date(this.openAt()).getTime() / 1000) + off) as UTCTimestamp;
      const t2 = (Math.floor(new Date(this.expiresAt()).getTime() / 1000) + off) as UTCTimestamp;
      const markers: SeriesMarker<Time>[] = [
        { time: t1, position: 'belowBar', color: '#22C55E', shape: 'arrowUp', text: 'open' },
        { time: t2, position: 'aboveBar', color: '#F5B841', shape: 'arrowDown', text: 'expiry' },
      ];
      createSeriesMarkers(s, markers.filter((mk) => data.some((d) => d.time >= (mk.time as number))));
      chart.timeScale().fitContent();
    });
  }
}
