import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth';

@Component({
  selector: 'app-exam-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="max-w-7xl mx-auto pb-16 print:pb-0 space-y-8">
    <div class="no-print space-y-8">
      <div>
        <h2 class="text-3xl font-black tracking-tighter">Examination</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">Tests, marks, class sheets, parent calls, send-up, board admission and awards.</p>
      </div>
      <nav class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Examination sections">
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
export class ExamShell {
  private auth = inject(AuthService);
  tabs = computed(() => {
    const mine = [{ link: '/exams/papers', label: 'My papers' }, { link: '/exams/sheet', label: 'Class sheet' }, { link: '/exams/followups', label: 'Parent calls (GR)' }];
    return this.auth.canWriteStudents()
      ? [{ link: '/exams', label: 'Exams' }, ...mine, { link: '/exams/duty', label: 'Invigilation' }, { link: '/exams/analysis', label: 'Analysis' }, { link: '/exams/awards', label: 'Awards' }, { link: '/exams/board', label: 'Board admission' }, { link: '/exams/settings', label: 'Settings' }]
      : mine;
  });
}
