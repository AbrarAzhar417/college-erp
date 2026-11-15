import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth';
import { TtData, WING_LABEL, Wing } from './tt';

@Component({
  selector: 'app-tt-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="max-w-7xl mx-auto pb-16 print:pb-0 space-y-8">
    <div class="no-print">
      <h2 class="text-3xl font-black tracking-tighter">Timetable</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Smart one-click timetable with no clashes and fair teacher loads.</p>
    </div>
    <div class="no-print flex flex-wrap items-center gap-2" role="tablist" aria-label="Wing">
      @for (w of wings; track w.key) {
        <button type="button" role="tab" [attr.aria-selected]="tt.wing() === w.key" (click)="tt.setWing(w.key)" class="px-5 py-2 rounded-2xl text-sm font-black"
                [class]="tt.wing() === w.key ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-500/10 text-slate-500'">{{ w.label }}</button>
      }
      <span class="text-xs font-bold text-slate-400">The school and the college have their own timings, classes and timetable.</span>
    </div>
    <nav class="flex gap-2 overflow-x-auto no-scrollbar no-print" aria-label="Timetable sections">
      @for (t of tabs(); track t.link) {
        <a [routerLink]="t.link" routerLinkActive="!bg-indigo-600 !text-white shadow-lg shadow-indigo-600/30" [routerLinkActiveOptions]="{ exact: true }"
           class="shrink-0 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-indigo-500 transition-all">{{ t.label }}</a>
      }
    </nav>
    @if (tt.ready()) { @for (k of [tt.wing()]; track k) { <router-outlet /> } } @else { <p class="text-sm font-bold text-slate-400">Loading…</p> }
  </div>
  `
})
export class TtShell {
  auth = inject(AuthService);
  tt = inject(TtData);
  wings: { key: Wing; label: string }[] = [{ key: 'school', label: WING_LABEL.school }, { key: 'college', label: WING_LABEL.college }];
  private router = inject(Router);

  constructor() {
    this.tt.loadConfig();
    if (!this.auth.canTimetable() && this.router.url.split('?')[0] === '/timetable') this.router.navigateByUrl('/timetable/view', { replaceUrl: true });
  }

  tabs() {
    const view = { link: '/timetable/view', label: 'View & edit' };
    if (!this.auth.canTimetable()) return [view, { link: '/timetable/subs', label: 'Substitutes' }];
    return [
      { link: '/timetable', label: 'Auto timetable' }, view,
      { link: '/timetable/config', label: 'Days & periods' }, { link: '/timetable/subjects', label: 'Subjects' },
      { link: '/timetable/teachers', label: 'Teachers' }, { link: '/timetable/curriculum', label: 'Curriculum' },
      { link: '/timetable/quality', label: 'Quality' }, { link: '/timetable/master', label: 'Master sheet' }, { link: '/timetable/free', label: 'Free periods' },
      { link: '/timetable/versions', label: 'Saved copies' }, { link: '/timetable/subs', label: 'Substitutes' }
    ];
  }
}
