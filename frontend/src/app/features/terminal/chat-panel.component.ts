import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiService } from '../../core/ui.service';
import { ApiService } from '../../core/api.service';
import { SocketService } from '../../core/socket.service';
import { ChatMsg } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  host: { '[class.open]': 'ui.chatOpen()' },
  template: `
    <div class="backdrop" (click)="ui.chatOpen.set(false)"></div>
    <aside class="panel" role="dialog" aria-label="Support chat">
      <header>
        <div class="agent"><span class="dot"></span><div><b>Y2 Support</b><small>Typically replies in a few minutes</small></div></div>
        <button class="icon-btn" (click)="ui.chatOpen.set(false)" aria-label="Close chat"><app-icon name="close" [size]="18" /></button>
      </header>
      <div class="msgs" #scroller>
        @for (m of messages(); track m.id) {
          <div class="msg" [class.me]="m.from === 'user'">
            <p>{{ m.text }}</p>
            <time>{{ time(m.createdAt) }}</time>
          </div>
        } @empty {
          <div class="empty">Say hello 👋 Our team is here 24/7.</div>
        }
      </div>
      <form (ngSubmit)="send()">
        <input class="input" placeholder="Type a message…" [ngModel]="text()" (ngModelChange)="text.set($event)" name="text" maxlength="2000" autocomplete="off" />
        <button class="btn btn-primary" type="submit" [disabled]="!text().trim() || sending()" aria-label="Send"><app-icon name="send" [size]="18" /></button>
      </form>
    </aside>
  `,
  styles: [
    `:host{position:fixed;inset:0;z-index:70;pointer-events:none}
     :host(.open){pointer-events:auto}
     .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35);opacity:0;transition:opacity .3s var(--ease)}
     :host(.open) .backdrop{opacity:1}
     .panel{position:absolute;top:0;bottom:0;left:var(--sidebar-w);width:min(420px,100vw);display:flex;flex-direction:column;background:#141a27;border-right:1px solid var(--border);
       box-shadow:30px 0 80px rgba(0,0,0,.4);transform:translateX(calc(-100% - var(--sidebar-w) - 40px));visibility:hidden;transition:transform .34s var(--ease),visibility 0s linear .34s}
     :host(.open) .panel{transform:none;visibility:visible;transition:transform .34s var(--ease),visibility 0s}
     header{display:flex;justify-content:space-between;align-items:center;padding:18px;border-bottom:1px solid var(--border)}
     .agent{display:flex;gap:12px;align-items:center}.agent small{display:block;color:var(--muted);font-size:12px}
     .dot{width:10px;height:10px;border-radius:50%;background:var(--buy);box-shadow:0 0 0 4px rgba(34,197,94,.2)}
     .msgs{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px}
     .msg{max-width:82%;align-self:flex-start;padding:10px 14px;border-radius:14px 14px 14px 4px;background:#222a3c;animation:rise-in .25s var(--ease)}
     .msg.me{align-self:flex-end;background:var(--primary);border-radius:14px 14px 4px 14px}
     .msg p{margin:0;white-space:pre-wrap;word-break:break-word}.msg time{display:block;font-size:11px;opacity:.6;margin-top:4px;text-align:right}
     .empty{margin:auto;color:var(--muted)}
     form{display:flex;gap:8px;padding:14px;border-top:1px solid var(--border)} form .input{height:46px} form .btn{height:46px;width:52px;padding:0}
     @media(max-width:899px){.panel{left:0;bottom:64px}}`,
  ],
})
export class ChatPanelComponent {
  protected ui = inject(UiService);
  private api = inject(ApiService);
  private socket = inject(SocketService);
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected messages = signal<ChatMsg[]>([]);
  protected text = signal('');
  protected sending = signal(false);
  private loaded = false;

  constructor() {
    effect(() => {
      if (!this.ui.chatOpen()) return;
      untracked(async () => {
        if (!this.loaded) {
          this.messages.set(await this.api.get<ChatMsg[]>('/chat'));
          this.loaded = true;
        }
        await this.api.post('/chat/read');
        this.scrollDown();
      });
    });
    this.socket.on<ChatMsg>('chat:message', (m) => {
      if (!this.loaded) return;
      this.messages.update((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      if (this.ui.chatOpen() && m.from === 'support') void this.api.post('/chat/read');
      this.scrollDown();
    });
  }

  protected async send() {
    const t = this.text().trim();
    if (!t) return;
    this.sending.set(true);
    try {
      const m = await this.api.post<ChatMsg>('/chat', { text: t });
      this.messages.update((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      this.text.set('');
      this.scrollDown();
    } finally {
      this.sending.set(false);
    }
  }

  protected time(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private scrollDown() {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 30);
  }
}
