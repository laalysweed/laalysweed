import { Injectable, signal } from '@angular/core';

/** A single shared clock for countdowns (4 Hz is smooth enough for text; rings use CSS transitions). */
@Injectable({ providedIn: 'root' })
export class ClockService {
  readonly now = signal(Date.now());
  constructor() {
    setInterval(() => this.now.set(Date.now()), 250);
  }
}
