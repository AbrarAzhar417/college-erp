import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth';

@Component({
  selector: 'app-syl-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="max-w-7xl mx-auto pb-16 print:pb-0 space-y-8">
    <div class="no-print space-y-8">
      <div>
        <h2 class="text-3xl font-black tracking-tighter">Syllabus</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">One plan for each subject of each class, week by week, shared by every section.</p>
      </div>
      <nav class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Syllabus sections">
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
export class SylShell {
  private auth = inject(AuthService);
  tabs = computed(() => {
    const base = [{ link: '/syllabus/mine', label: 'My syllabus' }, { link: '/syllabus/plans', label: 'Plans' }, { link: '/syllabus/calendar', label: 'Academic calendar' }, { link: '/syllabus/portion', label: 'Test syllabus' }];
    return this.auth.canWriteStudents() ? [{ link: '/syllabus', label: 'Overview' }, ...base, { link: '/syllabus/settings', label: 'Settings' }] : base;
  });
}
