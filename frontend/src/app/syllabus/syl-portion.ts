import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ClassInfo } from '../core/models';
import { ExamItem } from '../exam/exam';
import { PLAN_STATUS, fmtDate, monthName } from './syl';

export interface Portion {
  exam: { id: number; name: string; session: string }; class: { id: number; name: string }; from: string; to: string; previous: { id: number; name: string } | null;
  subjects: { subject_id: number; subject: string; plan_id: number | null; status: string; test_date: string | null; max_marks: number | null; items: { month: string; week: number; topic: string; chapter: string | null }[] }[];
}

@Component({
  selector: 'app-syl-portion',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <p class="text-sm font-bold text-slate-400">The syllabus of a test is made for you: it is everything planned in the weeks after the previous exam, up to the start of this test. You can change the dates below.</p>
      <div class="grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
        <div class="col-span-2"><label class="label" for="pe">Exam</label><select id="pe" class="field" [ngModel]="examId()" (ngModelChange)="examId.set($event); load()">@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }})</option> }</select></div>
        <div><label class="label" for="pc">Class</label><select id="pc" class="field" [ngModel]="classId()" (ngModelChange)="classId.set($event); load()">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="pf">From</label><input id="pf" type="date" class="field" [ngModel]="from()" (ngModelChange)="from.set($event)"></div>
        <div><label class="label" for="pt">To</label><input id="pt" type="date" class="field" [ngModel]="to()" (ngModelChange)="to.set($event)"></div>
        <button type="button" class="btn-ghost" (click)="load(true)">Recalculate</button>
      </div>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (p(); as x) {
      <div class="flex flex-wrap items-center gap-3">
        <a class="btn-primary" [routerLink]="['/syllabus/print/portion']" [queryParams]="{ examId: x.exam.id, classId: x.class.id, from: x.from, to: x.to }">Print test syllabus</a>
        <span class="text-sm font-bold text-slate-400">{{ x.exam.name }} · {{ x.class.name }} · topics planned from {{ d(x.from) }} to {{ d(x.to) }}{{ x.previous ? ' (after ' + x.previous.name + ')' : '' }}</span>
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        @for (s of x.subjects; track s.subject_id) {
          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
            <div class="flex items-start justify-between gap-3"><h3 class="text-lg font-black tracking-tight">{{ s.subject }}</h3><span class="px-2.5 py-1 rounded-lg text-[11px] font-black whitespace-nowrap" [class]="st(s.status).cls">{{ st(s.status).label }}</span></div>
            <p class="text-xs font-bold text-slate-400">{{ s.test_date ? 'Test on ' + d(s.test_date) : 'Test date not set' }}{{ s.max_marks ? ' · out of ' + s.max_marks : '' }}</p>
            @if (s.plan_id) { <ul class="space-y-1.5">@for (i of s.items; track $index) { <li class="text-sm"><span class="font-black">{{ i.topic }}</span> <span class="text-slate-400 text-xs font-bold">{{ i.chapter }} · {{ mn(i.month) }} week {{ i.week }}</span></li> }</ul>
              @if (!s.items.length) { <p class="text-sm font-bold text-slate-400">No topics planned in these dates.</p> } }
            @else { <p class="text-sm font-bold text-rose-500">There is no syllabus plan for this subject yet.</p> }
          </section>
        }
      </div>
    }
  </div>
  `
})
export class SylPortion {
  private api = inject(Api);
  st = (s: string) => PLAN_STATUS[s]; d = fmtDate; mn = monthName;
  exams = signal<ExamItem[]>([]); classes = signal<ClassInfo[]>([]);
  examId = signal<number | null>(null); classId = signal<number | null>(null); from = signal(''); to = signal('');
  p = signal<Portion | null>(null); error = signal('');
  constructor() {
    this.api.get<ExamItem[]>('/exam/exams').subscribe(e => { this.exams.set(e); this.examId.set(e.find(x => x.start_date && x.status !== 'published')?.id ?? e[0]?.id ?? null); this.load(); });
    this.api.get<ClassInfo[]>('/classes').subscribe(c => { this.classes.set(c); this.classId.set(c[0]?.id ?? null); this.load(); });
  }
  load(custom = false) {
    const e = this.examId(), c = this.classId(); if (!e || !c) return;
    this.api.get<Portion>('/syllabus/portion', { examId: e, classId: c, from: custom ? this.from() || undefined : undefined, to: custom ? this.to() || undefined : undefined }).subscribe({
      next: p => { this.p.set(p); this.from.set(p.from); this.to.set(p.to); this.error.set(''); }, error: x => { this.p.set(null); this.error.set(errorText(x)); } });
  }
}
