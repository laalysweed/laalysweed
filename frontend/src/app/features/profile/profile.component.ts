import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AccountService } from '../../core/account.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { EmailVerifyInlineComponent } from '../../shared/email-verify-inline.component';
import { ApiError, User } from '../../core/models';
import { dateTime, money, signedMoney, utcLabel } from '../../core/format';
import { COUNTRIES } from '../finance/deposit.component';

interface Kyc {
  status: User['kycStatus'];
  note: string | null;
  documents: { id: string; docType: string; originalName: string; createdAt: string }[];
}
interface Stats {
  today: { trades: number; turnover: number; profit: number };
  allTime: { trades: number; winRate: number; profit: number; volume: number; best: number };
  totalDeposited: number;
}

@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, EmailVerifyInlineComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  private accounts = inject(AccountService);
  private toast = inject(ToastService);

  protected countries = COUNTRIES;
  protected tzOptions = Array.from({ length: 27 }, (_, i) => (i - 12) * 60);
  protected utc = utcLabel;
  protected money = money;
  protected signed = signedMoney;
  protected dt = dateTime;

  protected fullName = signal(this.auth.user()?.fullName ?? '');
  protected phone = signal(this.auth.user()?.phone ?? '');
  protected country = signal(this.auth.user()?.country ?? 'KE');
  protected tz = signal(this.auth.user()?.timezoneOffset ?? 180);
  protected saving = signal(false);

  protected curPw = signal('');
  protected newPw = signal('');
  protected pwBusy = signal(false);

  protected twoFa = signal<{ qr: string; secret: string } | null>(null);
  protected code = signal('');
  protected disablePw = signal('');

  protected kyc = signal<Kyc | null>(null);
  protected uploading = signal<string | null>(null);
  protected stats = signal<Stats | null>(null);
  protected sessions = signal<{ id: string; userAgent: string; ip: string; createdAt: string }[]>([]);
  protected docTypes = [
    { id: 'id_front', label: 'ID / Passport (front)', required: true },
    { id: 'id_back', label: 'ID (back)', required: false },
    { id: 'selfie', label: 'Selfie holding your ID', required: true },
    { id: 'proof_of_address', label: 'Proof of address', required: false },
  ];

  constructor() {
    void this.api.get<Kyc>('/kyc').then((k) => this.kyc.set(k));
    void this.api.get<Stats>('/me/stats').then((s) => this.stats.set(s));
    void this.loadSessions();
  }

  protected hasDoc(t: string) {
    return this.kyc()?.documents.some((d) => d.docType === t);
  }

  protected async save() {
    this.saving.set(true);
    try {
      await this.api.patch('/me', { fullName: this.fullName(), phone: this.phone(), country: this.country(), timezoneOffset: Number(this.tz()) });
      await this.accounts.load();
      this.toast.success('Profile saved');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async changePw() {
    this.pwBusy.set(true);
    try {
      await this.api.post('/me/password', { current: this.curPw(), next: this.newPw() });
      this.curPw.set('');
      this.newPw.set('');
      this.toast.success('Password changed');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.pwBusy.set(false);
    }
  }

  protected async setup2fa() {
    try {
      this.twoFa.set(await this.api.post<{ qr: string; secret: string }>('/me/2fa/setup'));
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }
  protected async enable2fa() {
    try {
      await this.api.post('/me/2fa/enable', { code: this.code() });
      this.auth.patchUser({ twoFactorEnabled: true });
      this.twoFa.set(null);
      this.code.set('');
      this.toast.success('Two-factor authentication enabled');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }
  protected async disable2fa() {
    try {
      await this.api.post('/me/2fa/disable', { code: this.code(), password: this.disablePw() });
      this.auth.patchUser({ twoFactorEnabled: false });
      this.code.set('');
      this.disablePw.set('');
      this.toast.info('Two-factor authentication disabled');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }

  protected async upload(docType: string, ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return this.toast.error('File must be 8 MB or smaller');
    const form = new FormData();
    form.append('docType', docType);
    form.append('file', file);
    this.uploading.set(docType);
    try {
      const r = await this.api.upload<{ status: User['kycStatus'] }>('/kyc', form);
      this.kyc.set(await this.api.get<Kyc>('/kyc'));
      if (r.status) this.auth.patchUser({ kycStatus: r.status });
      this.toast.success('Document uploaded');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.uploading.set(null);
      (ev.target as HTMLInputElement).value = '';
    }
  }

  private async loadSessions() {
    this.sessions.set(await this.api.get('/me/sessions'));
  }
  protected async revoke(id: string) {
    await this.api.delete(`/me/sessions/${id}`);
    await this.loadSessions();
  }
  protected async logoutAll() {
    await this.api.post('/auth/logout-all');
    await this.auth.logout();
  }

  protected device(ua: string) {
    if (!ua) return 'Unknown device';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
    return `${br} on ${os}`;
  }
}
