import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
  leaving?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(kind: Toast['kind'], text: string, ms = 3800) {
    const id = ++this.seq;
    this.toasts.update((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
  success(t: string) {
    this.show('success', t);
  }
  error(t: string) {
    this.show('error', t, 5200);
  }
  info(t: string) {
    this.show('info', t);
  }

  dismiss(id: number) {
    this.toasts.update((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 260);
  }
}
