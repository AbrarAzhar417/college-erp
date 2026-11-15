import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { PLAN_STATUS, fmtDate } from './syl';

interface Row { id: number; status: string; updated_at: string; class_id: number; class_name: string; subject: string; author: string | null; items: number; periods: number }

@Component({
  selector: 'app-syl-plans',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <form (ngSubmit)="create()" class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div><h3 class="text-xl font-black tracking-tight">Design a new syllabus plan</h3><p class="text-sm font-bold text-slate-400 mt-1">Choose the class and the subject. The plan is shared by every section of the class.</p></div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div><label class="label" for="nc">Class</label><select id="nc" name="nc" class="field" [(ngModel)]="newClass">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="ns">Subject</label><select id="ns" name="ns" class="field" [(ngModel)]="newSubject"><option [ngValue]="null" disabled>Choose…</option>@for (s of subjects(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
        <button class="btn-primary" type="submit">Start the plan</button>
      </div>
      @if (!subjects().length) { <p class="text-sm font-bold text-amber-600">No subject is linked to your teacher profile yet. Ask the office to tick the subjects you teach (Timetable, Teachers).</p> }
      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    </form>

    <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
      <select class="field" aria-label="Class" [ngModel]="classId()" (ngModelChange)="setFilter('classId', $event)"><option [ngValue]="null">All classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
      <select class="field" aria-label="Status" [ngModel]="status()" (ngModelChange)="setFilter('status', $event)"><option value="">Any status</option><option value="draft">Draft</option><option value="submitted">Waiting approval</option><option value="approved">Approved</option></select>
      <input class="field" type="search" placeholder="Search subject" aria-label="Search subject" [ngModel]="q()" (ngModelChange)="q.set($event)">
    </div>

    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Class</th><th class="px-5 py-4">Subject</th><th class="px-5 py-4">Status</th><th class="px-5 py-4 text-right">Topics</th><th class="px-5 py-4 text-right">Periods</th><th class="px-5 py-4">Author</th><th class="px-5 py-4">Updated</th><th class="px-5 py-4"></th></tr></thead>
        <tbody>@for (p of shown(); track p.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
            <td class="px-5 py-3 font-black whitespace-nowrap">{{ p.class_name }}</td><td class="px-5 py-3 font-bold">{{ p.subject }}</td>
            <td class="px-5 py-3"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black whitespace-nowrap" [class]="st(p.status).cls">{{ st(p.status).label }}</span></td>
            <td class="px-5 py-3 text-right font-bold">{{ p.items }}</td><td class="px-5 py-3 text-right">{{ p.periods }}</td><td class="px-5 py-3 text-slate-500 whitespace-nowrap">{{ p.author || '-' }}</td><td class="px-5 py-3 text-slate-500 whitespace-nowrap">{{ d(p.updated_at) }}</td>
            <td class="px-5 py-3 text-right whitespace-nowrap">
              <a [routerLink]="['/syllabus/plan', p.id]" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10">Open</a>
              <a [routerLink]="['/syllabus/print/plan']" [queryParams]="{ planId: p.id }" class="px-3 py-1.5 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-500/10">Print</a>
            </td></tr> }</tbody>
      </table>
      @if (!shown().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No plans here yet.</p> }
    </div>
    @if (classId()) { <a class="btn-ghost" [routerLink]="['/syllabus/print/class']" [queryParams]="{ classId: classId() }">Print the whole class booklet (all subjects)</a> }
  </div>
  `
})
export class SylPlans {
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  st = (s: string) => PLAN_STATUS[s]; d = fmtDate;
  classes = signal<ClassInfo[]>([]); subjects = signal<{ id: number; name: string }[]>([]); plans = signal<Row[]>([]);
  classId = signal<number | null>(null); status = signal(''); q = signal(''); error = signal('');
  newClass: number | null = null; newSubject: number | null = null;
  shown = computed(() => this.plans().filter(p => p.subject.toLowerCase().includes(this.q().trim().toLowerCase())));
  constructor() {
    this.api.get<ClassInfo[]>('/classes').subscribe(c => { this.classes.set(c); this.newClass = c[0]?.id ?? null; });
    this.api.get<{ id: number; name: string }[]>('/syllabus/subjects').subscribe(s => this.subjects.set(s));
    this.load();
  }
  setFilter(k: 'classId' | 'status', v: any) { (this[k] as any).set(v); this.load(); }
  load() { this.api.get<Row[]>('/syllabus/plans', { classId: this.classId() ?? undefined, status: this.status() }).subscribe({ next: p => this.plans.set(p), error: e => this.error.set(errorText(e)) }); }
  create() {
    this.error.set('');
    if (!this.newClass || !this.newSubject) { this.error.set('Choose a class and a subject.'); return; }
    this.api.post<{ id: number }>('/syllabus/plans', { class_id: this.newClass, subject_id: this.newSubject }).subscribe({
      next: r => this.router.navigate(['/syllabus/plan', r.id]),
      error: e => { if (e?.status === 409 && e.error?.id) { this.toast.show('That plan already exists. Opening it.'); this.router.navigate(['/syllabus/plan', e.error.id]); } else this.error.set(errorText(e)); }
    });
  }
}
