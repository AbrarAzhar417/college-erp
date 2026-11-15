import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { PLAN_STATUS, covBar } from './syl';

interface Row { subject_id: number; subject: string; teachers: string[]; plan_id: number | null; status: string; items: number; pct: number | null; plannedPct: number | null; behindSections: number; behind: number }
interface Dash { session: string; classes: { class_id: number; name: string; subjects: Row[] }[]; totals: { plans: number; missing: number; approved: number; waiting: number }; submitted: { id: number; class_name: string; subject: string; author: string | null }[] }

@Component({
  selector: 'app-syl-dashboard',
  imports: [RouterLink],
  template: `
  <div class="space-y-6">
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (d(); as x) {
      <div class="no-print flex justify-end"><button type="button" class="btn-ghost" (click)="print()">Print coverage report</button></div>
      <section class="no-print grid grid-cols-2 xl:grid-cols-4 gap-5">
        <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="text-3xl font-black">{{ x.totals.plans }}</p><p class="text-xs font-bold text-slate-400 mt-1">Plans made ({{ x.session }})</p></div>
        <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="text-3xl font-black text-emerald-600">{{ x.totals.approved }}</p><p class="text-xs font-bold text-slate-400 mt-1">Approved</p></div>
        <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="text-3xl font-black text-amber-500">{{ x.totals.waiting }}</p><p class="text-xs font-bold text-slate-400 mt-1">Waiting for approval</p></div>
        <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="text-3xl font-black text-rose-500">{{ x.totals.missing }}</p><p class="text-xs font-bold text-slate-400 mt-1">Subjects with no plan yet</p></div>
      </section>
      @if (x.submitted.length) {
        <section class="no-print bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
          <h3 class="text-lg font-black tracking-tight">Waiting for your approval</h3>
          <div class="flex flex-wrap gap-2">@for (s of x.submitted; track s.id) { <a [routerLink]="['/syllabus/plan', s.id]" class="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs font-black hover:bg-amber-500/20">{{ s.class_name }} · {{ s.subject }}{{ s.author ? ' (' + s.author + ')' : '' }}</a> }</div>
        </section>
      }

      <div class="print-area space-y-6">
        <h3 class="hidden print:block text-xl font-black">Syllabus coverage report · {{ x.session }}</h3>
        @for (c of x.classes; track c.class_id) {
          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise" style="break-inside: avoid">
            <h3 class="text-xl font-black tracking-tight mb-4">{{ c.name }}</h3>
            <div class="overflow-x-auto"><table class="w-full text-left text-sm">
              <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="py-2 pr-4">Subject</th><th class="py-2 pr-4">Teacher</th><th class="py-2 pr-4">Plan</th><th class="py-2 pr-4 min-w-48">Taught so far (marker = should be by now)</th><th class="py-2 pr-4 text-right">Behind</th><th class="py-2 no-print"></th></tr></thead>
              <tbody>@for (r of c.subjects; track r.subject_id) {
                <tr class="border-b border-slate-50 dark:border-slate-800/60">
                  <td class="py-2.5 pr-4 font-black">{{ r.subject }}</td><td class="py-2.5 pr-4 text-slate-500 text-xs font-bold">{{ r.teachers.join(', ') || '-' }}</td>
                  <td class="py-2.5 pr-4"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black whitespace-nowrap" [class]="st(r.status).cls">{{ st(r.status).label }}</span></td>
                  <td class="py-2.5 pr-4">@if (r.plan_id) { <div class="flex items-center gap-3"><div class="relative flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full" [class]="bar(r)" [style.width.%]="r.pct ?? 0"></div>@if (r.plannedPct !== null) { <div class="absolute top-0 bottom-0 w-0.5 bg-slate-700 dark:bg-slate-200" [style.left.%]="r.plannedPct"></div> }</div><span class="w-12 text-right text-xs font-black">{{ r.pct ?? 0 }}%</span></div> } @else { <span class="text-xs font-bold text-slate-400">-</span> }</td>
                  <td class="py-2.5 pr-4 text-right text-xs font-black" [class]="r.behindSections ? 'text-rose-500' : 'text-slate-400'">{{ r.behindSections ? r.behindSections + ' section' + (r.behindSections > 1 ? 's' : '') : '' }}</td>
                  <td class="py-2.5 text-right no-print whitespace-nowrap">
                    @if (r.plan_id) { <a [routerLink]="['/syllabus/plan', r.plan_id]" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10">Open</a> }
                    @else { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="create(c.class_id, r.subject_id)">Create plan</button> }
                  </td></tr> }</tbody></table></div>
          </section>
        }
      </div>
    }
  </div>
  `
})
export class SylDashboard {
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  st = (s: string) => PLAN_STATUS[s]; bar = (r: Row) => covBar(r.pct, r.plannedPct);
  d = signal<Dash | null>(null); error = signal('');
  constructor() { this.api.get<Dash>('/syllabus/dashboard').subscribe({ next: d => this.d.set(d), error: e => this.error.set(errorText(e)) }); }
  print() { window.print(); }
  create(classId: number, subjectId: number) {
    this.api.post<{ id: number }>('/syllabus/plans', { class_id: classId, subject_id: subjectId }).subscribe({ next: r => this.router.navigate(['/syllabus/plan', r.id]), error: e => this.toast.show(errorText(e), 'error') });
  }
}
