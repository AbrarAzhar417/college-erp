import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule, ArrowRight, Lock, User, LogIn, LoaderCircle } from 'lucide-angular';
import { AuthService } from '../core/auth';
import { SettingsService } from '../core/settings';
import { errorText } from '../core/api';
import { ROLE_LABEL, Role } from '../core/models';

@Component({
  selector: 'app-login',
  imports: [FormsModule, LucideAngularModule],
  template: `
  <div class="quantum-mesh"></div>
  <div class="relative z-10 min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-[1100px] grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

      <div class="hidden lg:block space-y-8">
        <div class="flex items-center gap-6">
          @if (settings.logoUrl()) {
            <img [src]="settings.logoUrl()" alt="" class="w-20 h-20 rounded-[2rem] object-contain bg-white p-1 shadow-indigo-glow">
          } @else {
            <div class="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center shadow-indigo-glow border border-indigo-400/30">
              <span class="text-white text-4xl font-black italic">{{ settings.initial() }}</span>
            </div>
          }
          <div>
            <h1 class="text-4xl font-black text-white tracking-tighter uppercase leading-none text-balance">{{ settings.instituteName() }}</h1>
            <p class="text-indigo-400 text-xs font-bold uppercase tracking-[0.4em] mt-3">School Management Portal</p>
          </div>
        </div>
        <div class="p-10 glass-card rounded-[3rem] border-l-8 border-l-indigo-500 shadow-enterprise-lg">
          <h3 class="text-2xl font-black text-white mb-4 tracking-tight">Admissions, attendance, fees and results in one place</h3>
          <p class="text-slate-400 leading-relaxed">Log in with the username your office gave you. Works on the college network even when the internet is down.</p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="p-6 glass-card rounded-3xl text-center">
            <p class="text-3xl font-black text-white">6 – 12</p>
            <p class="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-2">Classes</p>
          </div>
          <div class="p-6 glass-card rounded-3xl text-center">
            <p class="text-3xl font-black text-indigo-400">A – E</p>
            <p class="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-2">Sections</p>
          </div>
        </div>
      </div>

      <div class="relative">
        <div class="absolute inset-0 bg-indigo-600/20 blur-[100px] rounded-full opacity-50"></div>
        <div class="glass-card p-8 md:p-14 rounded-[3.5rem] relative z-10 shadow-2xl">
          <div class="mb-10">
            <h2 class="text-4xl font-black text-white tracking-tighter leading-none">Log in</h2>
            <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] mt-4">College Management System</p>
          </div>

          @if (ticket()) {
            <form (ngSubmit)="submitCode()" class="space-y-6">
              <div>
                <label for="otp" class="block ml-4 mb-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">6-digit code from your authenticator app</label>
                <input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" autofocus required [(ngModel)]="code" placeholder="123456"
                       class="w-full bg-white/5 border border-white/10 rounded-2xl px-8 py-5 text-2xl tracking-[0.4em] text-center font-black text-white outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all" />
                <p class="mt-3 ml-4 text-[11px] font-bold text-slate-500">Lost your phone? Type one of your recovery codes here instead.</p>
              </div>
              @if (error()) { <p role="alert" class="text-sm font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-5 py-3">{{ error() }}</p> }
              <button type="submit" [disabled]="loading()" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-lg transition-all">Confirm</button>
              <button type="button" (click)="ticket.set(''); code = ''; error.set('')" class="w-full text-slate-400 text-xs font-black uppercase tracking-widest">Back</button>
            </form>
          } @else {
          <form (ngSubmit)="submit()" class="space-y-6">
            <div>
              <label for="u" class="block ml-4 mb-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Username</label>
              <div class="relative">
                <lucide-icon [img]="userIcon" [size]="20" class="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" />
                <input id="u" name="username" type="text" required autocomplete="username" [(ngModel)]="username" placeholder="e.g. admin"
                       class="w-full bg-white/5 border border-white/10 rounded-2xl pl-16 pr-8 py-5 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all" />
              </div>
            </div>
            <div>
              <label for="p" class="block ml-4 mb-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Password</label>
              <div class="relative">
                <lucide-icon [img]="lockIcon" [size]="20" class="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" />
                <input id="p" name="password" type="password" required autocomplete="current-password" [(ngModel)]="password" placeholder="••••••••"
                       class="w-full bg-white/5 border border-white/10 rounded-2xl pl-16 pr-8 py-5 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all" />
              </div>
            </div>

            @if (error()) {
              <p role="alert" class="text-sm font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-5 py-3">{{ error() }}</p>
            }

            <button type="submit" [disabled]="loading()"
                    class="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-lg transition-all flex items-center justify-center gap-4 active:scale-95 disabled:opacity-60">
              @if (loading()) { <lucide-icon [img]="spinIcon" [size]="20" class="animate-spin" /> }
              @else { Log in <lucide-icon [img]="arrowIcon" [size]="20" /> }
            </button>
          </form>
          }

          @if (settings.demoMode() && !ticket()) {
            <div class="mt-10 pt-8 border-t border-white/5">
              <p class="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center mb-6">Demo accounts (password: ChangeMe&#64;123)</p>
              <div class="grid grid-cols-1 gap-3">
                @for (a of settings.demoAccounts(); track a.username) {
                  <button type="button" (click)="fill(a.username)"
                          class="flex justify-between items-center p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-transparent hover:border-indigo-500/30 transition-all text-left group">
                    <div>
                      <p class="text-xs font-black text-white group-hover:text-indigo-400 transition-colors">{{ a.name }}</p>
                      <p class="text-[10px] text-slate-500 font-bold mt-1">{{ label(a.role) }}</p>
                    </div>
                    <lucide-icon [img]="loginIcon" [size]="14" class="text-slate-600 group-hover:text-indigo-400" />
                  </button>
                }
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  </div>
  `
})
export class Login {
  /** Where to go after signing in: the page that asked for the login, if it is a page of this app. */
  after() { const n = new URLSearchParams(location.search).get('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'; }
  settings = inject(SettingsService);
  private auth = inject(AuthService);
  private router = inject(Router);

  username = ''; password = ''; code = '';
  ticket = signal('');
  loading = signal(false);
  error = signal('');
  userIcon = User; lockIcon = Lock; arrowIcon = ArrowRight; loginIcon = LogIn; spinIcon = LoaderCircle;

  label(role: string) { return ROLE_LABEL[role as Role] ?? role; }
  fill(u: string) { this.username = u; this.password = 'ChangeMe@123'; }

  submit() {
    this.error.set('');
    this.loading.set(true);
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: r => { if (r.otpRequired && r.ticket) { this.ticket.set(r.ticket); this.loading.set(false); } else this.router.navigateByUrl(this.after()); },
      error: e => { this.error.set(errorText(e)); this.loading.set(false); }
    });
  }
  submitCode() {
    this.error.set(''); this.loading.set(true);
    this.auth.loginOtp(this.ticket(), this.code).subscribe({
      next: () => this.router.navigateByUrl(this.after()),
      error: e => { this.error.set(errorText(e)); this.loading.set(false); if (e?.status === 401 && /timed out/.test(e.error?.message ?? '')) this.ticket.set(''); }
    });
  }
}
