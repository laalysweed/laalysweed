import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @for (t of toast.toasts(); track t.id) {
      <div class="toast" [class]="t.kind" [class.leaving]="t.leaving" role="status" (click)="toast.dismiss(t.id)">
        <app-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'warn' : 'info'" [size]="18" />
        <span>{{ t.text }}</span>
      </div>
    }
  `,
  styles: [
    `:host{position:fixed;z-index:2000;right:20px;bottom:20px;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:min(420px,calc(100vw - 32px))}
     .toast{pointer-events:auto;cursor:pointer;display:flex;gap:10px;align-items:center;padding:13px 16px;border-radius:12px;
       background:rgba(22,28,42,.94);backdrop-filter:blur(14px);border:1px solid var(--border-strong);box-shadow:var(--shadow-2);
       font-size:14px;font-weight:500;animation:toast-in .32s var(--ease) both}
     .toast.leaving{animation:toast-out .26s var(--ease) both}
     .success app-icon{color:var(--buy)} .error app-icon{color:var(--sell)} .info app-icon{color:var(--brand-b)}
     .success{border-color:rgba(34,197,94,.35)} .error{border-color:rgba(239,68,68,.35)}
     @keyframes toast-in{from{opacity:0;transform:translateY(12px) scale(.96)}}
     @keyframes toast-out{to{opacity:0;transform:translateX(24px)}}
     @media (max-width:899px){:host{left:16px;right:16px;bottom:84px;max-width:none}}`,
  ],
})
export class ToastsComponent {
  protected toast = inject(ToastService);
}
