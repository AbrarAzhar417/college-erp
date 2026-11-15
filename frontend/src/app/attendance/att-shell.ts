import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth';

@Component({
  selector: 'app-att-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="max-w-7xl mx-auto pb-16 print:pb-0 space-y-8">
    <div class="no-print space-y-8">
      <div>
        <h2 class="text-3xl font-black tracking-tighter">Attendance</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">Daily and period attendance, monthly registers, leaves and analysis.</p>
      </div>
      <nav class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Attendance sections">
        @for (t of tabs(); track t.link) {
          <a [routerLink]="t.link" routerLinkActive="!bg-indigo-600 !text-white shadow-lg shadow-indigo-600/30" [routerLinkActiveOptions]="{ exact: true }"
             class="shrink-0 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-indigo-500 transition-all">{{ t.label }}</a>
        }
      </nav>
    </div>
    <router-outlet />
  </div>
  `
})
export class AttShell {
  private auth = inject(AuthService);
  private router = inject(Router);
  manager = computed(() => this.auth.canWriteStudents());
  constructor() { if (!this.auth.canWriteStudents() && this.router.url.split('?')[0] === '/attendance') this.router.navigateByUrl('/attendance/daily', { replaceUrl: true }); }
  tabs() {
    const base = [{ link: '/attendance/daily', label: 'Daily attendance' }, { link: '/attendance/period', label: 'Period attendance' }, { link: '/attendance/register', label: 'Monthly register' }];
    return this.manager()
      ? [{ link: '/attendance', label: 'Today' }, ...base, { link: '/attendance/leaves', label: 'Leaves' }, { link: '/attendance/reports', label: 'Reports & analysis' }, { link: '/attendance/settings', label: 'Settings' }]
      : base;
  }
}
