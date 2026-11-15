import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth';

@Component({
  selector: 'app-hr-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="max-w-7xl mx-auto pb-16 print:pb-0 space-y-8">
    <div class="no-print space-y-8">
      <div><h2 class="text-3xl font-black tracking-tighter">HR Management</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">Staff records, attendance, leaves, salary and recruitment in one place.</p></div>
      <nav class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="HR sections">
        @for (t of tabs(); track t.link) {
          <a [routerLink]="t.link" routerLinkActive="!bg-indigo-600 !text-white shadow-lg shadow-indigo-600/30" [routerLinkActiveOptions]="{ exact: t.exact }"
             class="shrink-0 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-indigo-500 transition-all">{{ t.label }}</a>
        }
      </nav>
    </div>
    <router-outlet />
  </div>
  `
})
export class HrShell {
  private auth = inject(AuthService);
  tabs = computed(() => {
    const t: { link: string; label: string; exact: boolean }[] = [];
    if (this.auth.canHrOffice()) t.push({ link: '/hr', label: 'Overview', exact: true }, { link: '/hr/staff', label: 'Staff', exact: false }, { link: '/hr/attendance', label: 'Attendance', exact: false }, { link: '/hr/leaves', label: 'Leaves', exact: false });
    if (this.auth.canHrPay()) t.push({ link: '/hr/payroll', label: 'Payroll', exact: false }, { link: '/hr/salary', label: 'Salary & loans', exact: false });
    if (this.auth.canHrOffice()) t.push({ link: '/hr/recruit', label: 'Recruitment', exact: false });
    if (this.auth.canHrOffice() || this.auth.canHrPay()) t.push({ link: '/hr/reports', label: 'Reports', exact: false });
    if (this.auth.canHrOffice()) t.push({ link: '/hr/settings', label: 'Settings', exact: false });
    if (!this.auth.canHrOffice() && !this.auth.canHrPay()) t.push({ link: '/hr/mine', label: 'My HR', exact: false });
    return t;
  });
}
