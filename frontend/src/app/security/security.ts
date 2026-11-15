import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { qrSvg } from '../core/qr';
import { ToastService } from '../core/toast';

interface Status { enabled: boolean; recoveryLeft: number; required: boolean }
interface PolicyUser { id: number; name: string; username: string; role: string; otp: boolean }
const ROLES = [{ key: 'director', label: 'Director' }, { key: 'principal', label: 'Principal' }, { key: 'accountant', label: 'Accountant' }, { key: 'admin', label: 'Admin' }, { key: 'teacher', label: 'Teachers' }];

@Component({
  selector: 'app-security',
  imports: [FormsModule],
  template: `
  <div class="max-w-3xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">My security</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Two-step login: after your password you type a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator or Authy). The code changes every 30 seconds and works without internet.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (st(); as s) {
      @if (s.required && !s.enabled) { <p role="alert" class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 font-bold text-sm">Your role must use two-step login. Set it up below; until then the rest of the program is closed to you.</p> }

      @if (codes().length) {
        <section class="p-6 rounded-3xl border-2 border-emerald-500/40 bg-emerald-500/5 space-y-3">
          <h3 class="font-black">Two-step login is on. Save your recovery codes now.</h3>
          <p class="text-sm font-bold text-slate-500">If you lose your phone, each of these codes can be used once instead of the 6-digit code. They are shown only this one time. Write them down or print them and keep them somewhere safe.</p>
          <ul class="grid grid-cols-2 gap-2 font-mono font-black text-lg">@for (c of codes(); track c) { <li class="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">{{ c }}</li> }</ul>
          <div class="flex gap-3"><button type="button" class="btn-ghost" (click)="print()">Print</button><button type="button" class="btn-primary" (click)="codes.set([])">I have saved them</button></div>
        </section>
      } @else if (s.enabled) {
        <section class="p-6 rounded-3xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-4">
          <h3 class="font-black text-emerald-600">Two-step login is ON</h3>
          <p class="text-sm font-bold text-slate-500">{{ s.recoveryLeft }} recovery code(s) left.</p>
          @if (!s.required) {
            <div class="grid sm:grid-cols-3 gap-3 items-end">
              <div><label class="label" for="dp">Password</label><input id="dp" type="password" class="field" autocomplete="current-password" [(ngModel)]="dPass"></div>
              <div><label class="label" for="dc">Code or recovery code</label><input id="dc" class="field" inputmode="numeric" autocomplete="one-time-code" [(ngModel)]="dCode"></div>
              <button type="button" class="btn-ghost text-rose-600" (click)="disable()">Turn off</button>
            </div>
          } @else { <p class="text-xs font-bold text-slate-400">Your role must use it, so it cannot be turned off.</p> }
        </section>
      } @else if (setup(); as su) {
        <section class="p-6 rounded-3xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-4">
          <h3 class="font-black">1. Scan this with the authenticator app</h3>
          <div class="flex flex-wrap gap-6 items-center">
            <div class="w-48 h-48 p-2 bg-white rounded-2xl border border-slate-200 [&_svg]:w-full [&_svg]:h-full" [innerHTML]="qr()" aria-label="QR code for the authenticator app"></div>
            <div class="text-sm font-bold text-slate-500 space-y-2 min-w-48 flex-1"><p>Cannot scan? Choose "enter a setup key" in the app and type:</p><p class="font-mono font-black text-base break-all text-slate-800 dark:text-slate-100">{{ su.secret }}</p></div>
          </div>
          <h3 class="font-black pt-2">2. Type the 6-digit code the app shows</h3>
          <div class="flex gap-3 items-end max-w-sm"><input class="field" inputmode="numeric" maxlength="6" autocomplete="one-time-code" aria-label="6-digit code" [(ngModel)]="code"><button type="button" class="btn-primary" (click)="enable()">Turn on</button></div>
        </section>
      } @else {
        <section class="p-6 rounded-3xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 class="font-black">Two-step login is OFF</h3>
          <p class="text-sm font-bold text-slate-500">Recommended for the Director, Principal and Accountant, because fee and result data is behind this login.</p>
          <button type="button" class="btn-primary" (click)="begin()">Set it up</button>
        </section>
      }
    }

    @if (auth.isLeadership() && pol(); as p) {
      <section class="p-6 rounded-3xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-4">
        <h3 class="font-black">Who must use it</h3>
        <p class="text-sm font-bold text-slate-500">A person in a ticked role cannot use anything else until they have set it up.</p>
        <div class="flex flex-wrap gap-4">@for (r of roles; track r.key) { <label class="flex items-center gap-2 text-sm font-black"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [checked]="p.roles.includes(r.key)" (change)="flip(r.key)"> {{ r.label }}</label> }</div>
        <div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2">Name</th><th class="py-2">Role</th><th class="py-2">Two-step</th><th></th></tr></thead>
          <tbody>@for (u of p.users; track u.id) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 font-black">{{ u.name }} <span class="text-slate-400 font-bold">{{ u.username }}</span></td><td class="py-2 font-bold">{{ u.role }}</td>
            <td class="py-2 font-bold" [class.text-emerald-600]="u.otp">{{ u.otp ? 'On' : 'Off' }}</td>
            <td class="py-2 text-right">@if (u.otp) { <button type="button" class="text-rose-600 text-xs font-black" (click)="reset(u)">Reset (lost phone)</button> }</td></tr> }</tbody></table></div>
      </section>
    }
  </div>
  `
})
export class Security {
  private api = inject(Api);
  private toast = inject(ToastService);
  private san = inject(DomSanitizer);
  auth = inject(AuthService);
  roles = ROLES;
  st = signal<Status | null>(null); error = signal('');
  setup = signal<{ secret: string; uri: string } | null>(null);
  codes = signal<string[]>([]);
  pol = signal<{ roles: string[]; users: PolicyUser[] } | null>(null);
  code = ''; dPass = ''; dCode = '';
  qr = computed<SafeHtml>(() => { const u = this.setup()?.uri; if (!u) return ''; try { return this.san.bypassSecurityTrustHtml(qrSvg(u, 192)); } catch { return ''; } });

  constructor() { this.load(); }
  private fail = (e: any) => this.error.set(errorText(e));
  load() {
    this.api.get<Status>('/otp/status').subscribe({ next: r => this.st.set(r), error: e => this.fail(e) });
    if (this.auth.isLeadership()) this.api.get<{ roles: string[]; users: PolicyUser[] }>('/otp/policy').subscribe({ next: r => this.pol.set(r), error: e => this.fail(e) });
  }
  begin() { this.error.set(''); this.api.post<{ secret: string; uri: string }>('/otp/setup', {}).subscribe({ next: r => this.setup.set(r), error: e => this.fail(e) }); }
  enable() {
    this.error.set('');
    this.api.post<{ recovery: string[] }>('/otp/enable', { code: this.code }).subscribe({ next: r => { this.codes.set(r.recovery); this.setup.set(null); this.code = ''; this.load(); this.toast.show('Two-step login is on.'); }, error: e => this.fail(e) });
  }
  disable() {
    this.error.set('');
    this.api.post('/otp/disable', { password: this.dPass, code: this.dCode }).subscribe({ next: () => { this.dPass = this.dCode = ''; this.toast.show('Two-step login is off.'); this.load(); }, error: e => this.fail(e) });
  }
  flip(role: string) {
    const p = this.pol(); if (!p) return;
    const roles = p.roles.includes(role) ? p.roles.filter(r => r !== role) : [...p.roles, role];
    this.api.put<{ roles: string[]; users: PolicyUser[] }>('/otp/policy', { roles }).subscribe({ next: r => this.pol.set(r), error: e => this.fail(e) });
  }
  reset(u: PolicyUser) {
    if (!confirm(`Switch off two-step login for ${u.name}? They will set it up again on their phone.`)) return;
    this.api.delete<{ users: PolicyUser[] }>(`/otp/users/${u.id}`).subscribe({ next: r => this.pol.update(p => p && { ...p, users: r.users }), error: e => this.fail(e) });
  }
  print() { window.print(); }
}
