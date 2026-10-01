import { ChangeDetectionStrategy, Component, afterNextRender, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { ToastsComponent } from './shared/toasts.component';
import { LoaderComponent } from './shared/loader.component';
import { AuthDrawerComponent } from './features/auth/auth-drawer.component';
import { SocketService } from './core/socket.service';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastsComponent, AuthDrawerComponent, LoaderComponent],
  template: `
    <router-outlet />
    @if (routeLoading()) {
      <app-loader [overlay]="true" />
    }
    <app-auth-drawer />
    <app-toasts />
  `,
})
export class App {
  protected routeLoading = signal(false);

  constructor() {
    const socket = inject(SocketService);
    const toast = inject(ToastService);
    socket.on<{ kind: 'success' | 'error' | 'info'; text: string }>('toast', (t) => toast.show(t.kind, t.text));

    // Show the candle loader only for slow navigations (lazy chunk downloads, guards waiting on the network).
    let timer: ReturnType<typeof setTimeout> | undefined;
    inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        clearTimeout(timer);
        timer = setTimeout(() => this.routeLoading.set(true), 220);
      } else if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) {
        clearTimeout(timer);
        this.routeLoading.set(false);
      }
    });

    // Fade out the boot loader from index.html once the app (and session restore) is ready.
    afterNextRender(() => {
      const el = document.getElementById('boot-loader');
      if (!el) return;
      setTimeout(() => {
        el.classList.add('hide');
        setTimeout(() => el.remove(), 450);
      }, 550);
    });
  }
}
