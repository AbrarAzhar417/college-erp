import { RouterLink } from '@angular/router';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { SettingsService } from '../core/settings';
import { ToastService } from '../core/toast';
import { ROLE_LABEL } from '../core/models';

@Component({
  selector: 'app-profile',
  imports: [RouterLink, FormsModule],
  template: `
  <div class="max-w-3xl mx-auto space-y-8 pb-16">
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <h2 class="text-3xl font-black tracking-tighter">{{ auth.user()?.name }}</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">{{ role }} · username: {{ auth.user()?.username }}</p>
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <h3 class="text-xl font-black tracking-tight mb-6">Change password</h3>
      <form (ngSubmit)="changePassword()" class="space-y-5">
        <div><label class="label" for="cur">Current password</label>
          <input id="cur" name="cur" type="password" class="field" required autocomplete="current-password" [(ngModel)]="current"></div>
        <div><label class="label" for="nxt">New password (at least 8 characters)</label>
          <input id="nxt" name="nxt" type="password" class="field" required minlength="8" autocomplete="new-password" [(ngModel)]="next"></div>
        @if (pwError()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ pwError() }}</p> }
        <button class="btn-primary" type="submit">Save password</button>
      </form>
    </section>

    @if (auth.isLeadership()) {
      <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <h3 class="text-xl font-black tracking-tight">College details</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Name, address, logo, campus picture and office bearers now live on the College Profile page.</p>
        <a routerLink="/college" class="btn-primary inline-block mt-4">Open College Profile</a>
      </section>
    }
  </div>
  `
})
export class Profile {
  auth = inject(AuthService);
  settings = inject(SettingsService);
  private api = inject(Api);
  private toast = inject(ToastService);

  role = ROLE_LABEL[this.auth.user()?.role ?? 'teacher'];
  current = ''; next = '';
  pwError = signal('');
  logoError = signal('');
  f = { instituteName: this.settings.instituteName(), shortName: this.settings.shortName(), address: this.settings.address(), phone: this.settings.phone(), email: this.settings.email() };

  changePassword() {
    this.pwError.set('');
    this.api.post('/auth/change-password', { current: this.current, next: this.next }).subscribe({
      next: () => { this.current = ''; this.next = ''; this.toast.show('Password changed.'); },
      error: e => this.pwError.set(errorText(e))
    });
  }

  saveCollege() {
    this.api.put<Record<string, string>>('/settings', this.f).subscribe({
      next: r => { this.settings.apply(r); document.title = this.settings.instituteName(); this.toast.show('College details saved.'); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }

  /** Shrinks the picked image (max 480px) before uploading so the logo stays small. */
  pickLogo(ev: Event) {
    this.logoError.set('');
    const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 480 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      this.api.put('/settings/logo', { dataUrl: c.toDataURL('image/png') }).subscribe({
        next: () => { this.settings.load(); this.toast.show('Logo saved.'); },
        error: e => this.logoError.set(errorText(e))
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); this.logoError.set('That file could not be read as an image.'); };
    img.src = url;
  }
  removeLogo() {
    this.api.delete('/settings/logo').subscribe({ next: () => { this.settings.load(); this.toast.show('Logo removed.'); }, error: e => this.toast.show(errorText(e), 'error') });
  }
}
