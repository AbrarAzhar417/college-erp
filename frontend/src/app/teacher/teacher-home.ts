import { NoticeCard } from '../notice/notice-card';
import { GlobalSearch } from '../pages/global-search';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';

interface Portal {
  teacher: { id: number; name: string } | null; linked: boolean; classTeacherOf: string[]; subjects: { subject: string; section: string; periods: number }[]; today: { period: number; subject: string; section: string }[];
  waiting: { marksToEnter: number; papersToSet: number; tasks: { open: number; overdue: number; dueToday: number; done: number } }; latestSlip: string | null; duties: string[];
}
const DUTY: Record<string, string> = { exam_dept: 'Exam Department', test_dept: 'Test Department', timetable_team: 'Timetable Team' };

@Component({
  selector: 'app-teacher-home',
  imports: [RouterLink, NoticeCard, GlobalSearch],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Welcome, {{ auth.user()?.name }}</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Your classes, lessons and everything waiting for you.</p></div>
    <app-global-search />
    <app-notice-card />
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (p(); as x) {
      @if (!x.linked) { <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">Your login is not linked to a teacher record yet, so your timetable and papers cannot be shown. Ask the office to link it.</p> }
      @if (x.duties.length) { <p class="text-sm font-bold">Additional charge: @for (d of x.duties; track d) { <span class="inline-block mr-2 px-2.5 py-1 rounded-lg text-[11px] font-black bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">{{ duty[d] }}</span> }</p> }
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <a routerLink="/exams/papers" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-2xl font-black" [class.text-rose-600]="x.waiting.marksToEnter">{{ x.waiting.marksToEnter }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Marks to enter</div></a>
        <a routerLink="/paper-setting" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-2xl font-black" [class.text-rose-600]="x.waiting.papersToSet">{{ x.waiting.papersToSet }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Papers to submit</div></a>
        <a routerLink="/tasks" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-2xl font-black">{{ x.waiting.tasks.open }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Open tasks{{ x.waiting.tasks.overdue ? ' · ' + x.waiting.tasks.overdue + ' late' : '' }}</div></a>
        <a routerLink="/hr/mine" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-2xl font-black">{{ x.latestSlip ?? '-' }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Latest salary slip</div></a>
      </div>
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <h3 class="font-black mb-3">Today's lessons</h3>
        @for (l of x.today; track l.period) { <p class="py-1.5 text-sm font-bold border-t border-slate-100 dark:border-slate-800">Period {{ l.period }} · {{ l.subject }} · {{ l.section }}</p> } @empty { <p class="text-sm font-bold text-slate-400">No lessons today.</p> }
        <a routerLink="/timetable/view" class="inline-block mt-3 text-xs font-black text-indigo-600">Open my full timetable</a>
      </section>
      <div class="grid md:grid-cols-2 gap-6">
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise"><h3 class="font-black mb-3">My subjects and classes</h3>
          @for (s of x.subjects; track $index) { <p class="py-1.5 text-sm font-bold border-t border-slate-100 dark:border-slate-800">{{ s.subject }} · {{ s.section }} <span class="text-slate-400">({{ s.periods }} periods a week)</span></p> } @empty { <p class="text-sm font-bold text-slate-400">No lessons in the timetable yet.</p> }</section>
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise"><h3 class="font-black mb-3">My class</h3>
          @if (x.classTeacherOf.length) { <p class="text-sm font-bold">Class teacher of {{ x.classTeacherOf.join(', ') }}</p><div class="flex flex-wrap gap-3 mt-3"><a routerLink="/attendance" class="btn-ghost">Attendance</a><a routerLink="/diary" class="btn-ghost">Diary</a><a routerLink="/ptm" class="btn-ghost">PTM</a></div> } @else { <p class="text-sm font-bold text-slate-400">You are not a class teacher.</p> }</section>
      </div>
    }
  </div>
  `
})
export class TeacherHome {
  auth = inject(AuthService); private api = inject(Api); duty = DUTY;
  p = signal<Portal | null>(null); error = signal('');
  constructor() { this.api.get<Portal>('/teacher/portal').subscribe({ next: r => this.p.set(r), error: e => this.error.set(errorText(e)) }); }
}
