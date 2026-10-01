import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { inject } from '@angular/core';

/** Inline stroke icon set (24×24, currentColor). Paths are static strings defined here, never user input. */
const P: Record<string, string> = {
  trading: '<ellipse cx="10" cy="6" rx="6" ry="2.5"/><path d="M4 6v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6"/><path d="M4 10v4c0 1.4 2.7 2.5 6 2.5"/><path d="M4 14v4c0 1.4 2.7 2.5 6 2.5"/><circle cx="17" cy="16.5" r="4.5"/><path d="M17 14.3v4.4M15.6 15.2h2.1a.9.9 0 010 1.8h-1.4a.9.9 0 000 1.8h2.1"/>',
  finance: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M3 8.5h18"/><path d="M12 21v-7M9 17l3-3 3 3"/>',
  profile: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3.2"/><path d="M6.2 18.5c1.3-2.2 3.4-3.3 5.8-3.3s4.5 1.1 5.8 3.3"/>',
  referrals: '<circle cx="8" cy="9" r="3.2"/><circle cx="16.5" cy="10" r="2.8"/><path d="M2.5 19c.8-3 2.9-4.6 5.5-4.6s4.7 1.6 5.5 4.6M13.5 15.3c.9-.6 1.9-.9 3-.9 2.2 0 3.9 1.4 4.6 4"/><path d="M18 3.5l2.5-1M20.5 2.5v2.6"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z" stroke-linejoin="round"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 5.5H4.5a3 3 0 003.6 3.9M16 5.5h3.5a3 3 0 01-3.6 3.9"/><path d="M12 13v4M8.5 20h7M9.5 17h5v3h-5z"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 115 .9c-.6 1-2.5 1.5-2.5 3"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" stroke-linejoin="round"/>',
  'star-fill': '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" stroke-linejoin="round"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8C10.5 5 7 4.5 7 6.5S10 8 12 8zM12 8c1.5-3 5-3.5 5-1.5S14 8 12 8z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 016.5 5H18v3"/><rect x="4" y="7.5" width="17" height="12" rx="2.5"/><path d="M16 13.5h2.5"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'arrow-ur': '<path d="M7 17L17 7M9 7h8v8"/>',
  'arrow-dr': '<path d="M7 7l10 10M17 9v8H9"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  'chart-line': '<path d="M3.5 17l5-6 4 3.5 7.5-9"/>',
  'chart-candle': '<path d="M7 3v18M17 3v18"/><rect x="5" y="7" width="4" height="8" rx="1"/><rect x="15" y="9" width="4" height="6" rx="1"/>',
  'chart-bars': '<path d="M7 4v16M5 8h2M7 15h2M17 4v16M15 7h2M17 13h2"/>',
  'chart-area': '<path d="M3.5 17l5-6 4 3.5 7.5-9V20h-17z" fill="currentColor" fill-opacity=".18"/><path d="M3.5 17l5-6 4 3.5 7.5-9"/>',
  crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/>',
  hline: '<path d="M3 12h18"/><circle cx="7" cy="12" r="1.6" fill="currentColor"/><circle cx="17" cy="12" r="1.6" fill="currentColor"/>',
  trend: '<path d="M4 19L20 5"/><circle cx="4.5" cy="18.5" r="1.8" fill="currentColor"/><circle cx="19.5" cy="5.5" r="1.8" fill="currentColor"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>',
  signals: '<circle cx="12" cy="12" r="2"/><path d="M8.2 8.2a5.4 5.4 0 000 7.6M15.8 8.2a5.4 5.4 0 010 7.6M5.3 5.3a9.5 9.5 0 000 13.4M18.7 5.3a9.5 9.5 0 010 13.4"/>',
  social: '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="8" r="3"/><path d="M2.5 19c.6-3 2.7-4.7 5.5-4.7s4.9 1.7 5.5 4.7M11 19c.6-3 2.7-4.7 5.5-4.7S21.4 16 22 19"/>',
  pending: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.5 1.5M10 3.5h4M12 3.5v3"/>',
  code: '<path d="M9 5.5c-2 0-2 1.5-2 3s0 3.5-2 3.5c2 0 2 2 2 3.5s0 3 2 3M15 5.5c2 0 2 1.5 2 3s0 3.5 2 3.5c-2 0-2 2-2 3.5s0 3-2 3"/>',
  swap: '<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>',
  pro: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7 15l3.5-4 3 2.5L17 9"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.7 3.4M6.6 6.6A16.6 16.6 0 002.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  logout: '<path d="M14 4.5h4.5a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5H14M10 16.5L5.5 12 10 7.5M5.5 12H15"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.5 5.6 12 3z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  withdraw: '<path d="M12 20V9M7 14l5-5 5 5M5 4.5h14"/>',
  deposit: '<path d="M12 4v11M7 10l5 5 5-5M5 19.5h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".7" fill="currentColor"/>',
  warn: '<path d="M12 4l9 16H3z" stroke-linejoin="round"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".7" fill="currentColor"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z" stroke-linejoin="round"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" stroke-linejoin="round"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 000-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 007 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 000 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 002.6-1.5l2.4 1 2-3.4z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.6 3.3-5.6 6.5-5.6s5.8 2 6.5 5.6M16 4.8a3.5 3.5 0 010 6.4M18.5 14.8c1.6.9 2.6 2.6 3 5.2"/>',
  file: '<path d="M6 3h8l4 4v14H6z" stroke-linejoin="round"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.6M20 4v4.5h-4.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  cards: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18M7 14.5h3"/>',
  dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M4 20.5A2.5 2.5 0 016.5 18H20v3H6.5"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z" fill="currentColor"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17"/>',
  reticle: '<circle cx="12" cy="12" r="7.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  pitchfork: '<path d="M5 20l7-7M12 13V4M12 13l7 7M6 5h12"/>',
  brush: '<path d="M18 3l3 3-9 9-4 1 1-4 9-9z"/><path d="M15 6l3 3M4 21c1-2 2-3 4-3"/>',
  text: '<path d="M5 6V4h14v2M10 20h4M12 4v16"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.5 2.2 2 3.5 2s2.5-.5 3.5-2"/><circle cx="9" cy="9.5" r="1" fill="currentColor"/><circle cx="15" cy="9.5" r="1" fill="currentColor"/>',
  tv: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h4M9 9v6M14 9l1.8 6 1.8-6"/>',
  split: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><line x1="12" y1="4.5" x2="12" y2="19.5"/>',
  indicators: '<path d="M3 16.5l5.5-6 4 4 8-8.5"/><line x1="17" y1="6" x2="20.5" y2="6"/><line x1="20.5" y1="6" x2="20.5" y2="9.5"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'volume-x': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  medal: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  transfer: '<path d="M17 4v16m0 0l-4-4m4 4l4-4M7 20V4m0 0l4 4M7 4L3 8"/>',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-icon', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="stroke()"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    [innerHTML]="svg()"
  ></svg>`,
  styles: [':host{display:inline-grid;place-items:center;flex:none}'],
})
export class IconComponent {
  private sanitizer = inject(DomSanitizer);
  readonly name = input.required<string>();
  readonly size = input(22);
  readonly stroke = input(1.8);
  // Safe: content comes only from the constant map above.
  readonly svg = computed(() => this.sanitizer.bypassSecurityTrustHtml(P[this.name()] ?? P['info']!));
}
