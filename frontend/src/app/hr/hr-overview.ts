import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { STAGES, STAGE_LABEL, TYPE_LABEL, money } from './hr';

interface Overview {
  total: number; byType: Record<string, number>; today: Record<string, number>; pendingLeaves: number;
  alerts: { level: 'expired' | 'soon'; text: string; days: number; link: string }[];
  recruitment: { openJobs: number; stages: Record<string, number>; interviewsToday: number };
  payroll?: { staff: number; net: number; paid: number; approved: number };
}

@Component({
  selector: 'app-hr-overview',
  imports: [RouterLink],
  template: `
  @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (o(); as x) {
  <div class="space-y-8">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="label !ml-0">Total staff</p><p class="text-4xl font-black">{{ x.total }}</p></div>
      <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="label !ml-0">Present today</p><p class="text-4xl font-black text-emerald-600">{{ (x.today['P'] ?? 0) + (x.today['LT'] ?? 0) }}</p><p class="text-xs font-bold text-slate-400 mt-1">{{ x.today['LT'] ?? 0 }} late</p></div>
      <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="label !ml-0">Absent / on leave</p><p class="text-4xl font-black text-rose-600">{{ x.today['A'] ?? 0 }} <span class="text-sky-600">/ {{ x.today['L'] ?? 0 }}</span></p><p class="text-xs font-bold text-slate-400 mt-1">{{ x.today['unmarked'] ?? 0 }} not marked yet</p></div>
      <a routerLink="/hr/leaves" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise hover:border-indigo-400"><p class="label !ml-0">Leave requests waiting</p><p class="text-4xl font-black text-amber-600">{{ x.pendingLeaves }}</p></a>
    </div>

    <div class="grid md:grid-cols-2 gap-6">
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <h3 class="text-lg font-black tracking-tight mb-4">Alerts</h3>
        @for (a of x.alerts; track a.text) {
          <a [routerLink]="a.link" class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm font-bold hover:text-indigo-500">
            <span>{{ a.text }}</span>
            <span class="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="a.level === 'expired' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'">{{ a.days < 0 ? 'expired' : a.days + ' days' }}</span>
          </a>
        } @empty { <p class="text-sm font-bold text-slate-400">Nothing needs attention. Contract, probation, licence and document dates are all fine.</p> }
      </section>
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <h3 class="text-lg font-black tracking-tight mb-4">Staff by type</h3>
        <div class="flex flex-wrap gap-2">@for (k of typeKeys(x); track k) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800">{{ tl[k] ?? k }}: {{ x.byType[k] }}</span> }</div>
        @if (!x.total) { <p class="text-sm font-bold text-slate-400">No staff yet. Open Staff and add people, or bring in the teachers and drivers you already have.</p> }
        @if (x.payroll; as p) {
          <h3 class="text-lg font-black tracking-tight mt-8 mb-3">This month's salary</h3>
          <p class="text-3xl font-black">Rs {{ m(p.net) }}</p>
          <p class="text-xs font-bold text-slate-400 mt-1">{{ p.staff }} salaries · {{ p.approved }} approved · {{ p.paid }} paid · <a routerLink="/hr/payroll" class="text-indigo-600">Open payroll</a></p>
        }
      </section>
    </div>

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-black tracking-tight">Recruitment</h3><a routerLink="/hr/recruit" class="text-xs font-black uppercase tracking-widest text-indigo-600">Open</a></div>
      <div class="flex flex-wrap gap-2"><span class="px-3 py-1.5 rounded-xl text-xs font-black bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">{{ x.recruitment.openJobs }} open posts</span>
        @for (s of stages; track s) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800">{{ sl[s] }}: {{ x.recruitment.stages[s] ?? 0 }}</span> }
        <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-sky-500/10 text-sky-700 dark:text-sky-300">{{ x.recruitment.interviewsToday }} interviews today</span></div>
    </section>
  </div>
  }
  `
})
export class HrOverview {
  private api = inject(Api);
  m = money; tl = TYPE_LABEL; sl = STAGE_LABEL; stages = STAGES;
  o = signal<Overview | null>(null); error = signal('');
  typeKeys = (x: Overview) => Object.keys(x.byType);
  constructor() { this.api.get<Overview>('/hr/overview').subscribe({ next: o => this.o.set(o), error: e => this.error.set(errorText(e)) }); }
}
