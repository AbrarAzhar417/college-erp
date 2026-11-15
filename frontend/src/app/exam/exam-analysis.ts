import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { ClassInfo } from '../core/models';
import { ExamItem, catClass, deltaText, pctClass } from './exam';

interface Summary {
  exam: ExamItem; class: { id: number; name: string };
  sections: { section_id: number; label: string; class_teacher: string | null; students: number; complete: number; pass: number; fail: number; passPct: number | null; avg: number | null; highest: number | null; lowest: number | null; needCall: number; incomplete: number }[];
  overall: { students: number; complete: number; pass: number; fail: number; avg: number | null; passPct: number | null; needCall: number };
  subjects: { subject: string; sections: { label: string; teacher: string | null; avgPct: number | null; passPct: number | null }[] }[];
  categories: { cat: string; students: number; avg: number | null; passPct: number | null }[];
  top: P[]; up: P[]; down: P[]; trend: { exam: string; students: number; avg: number | null; passPct: number | null }[];
}
interface P { id: number; name: string; label: string; pct: number; delta: number | null; rank: number | null }

@Component({
  selector: 'app-exam-analysis',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="no-print bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="ae">Exam</label><select id="ae" class="field" [ngModel]="examId()" (ngModelChange)="setExam($event)">@for (e of examOptions(); track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }</select></div>
      <div><label class="label" for="ac">Class</label><select id="ac" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
      <button type="button" class="btn-ghost" (click)="print()">Print</button>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (s(); as x) {
      <div class="print-area space-y-6">
        <div><h3 class="text-xl font-black tracking-tight">{{ x.exam.name }} · {{ x.class.name }} analysis</h3><p class="text-xs font-bold text-slate-400 mt-1">{{ settings.instituteName() }}</p></div>
        <div class="grid grid-cols-2 xl:grid-cols-5 gap-4">
          @for (k of kpis(); track k.label) { <div class="p-5 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><p class="text-2xl font-black" [class]="k.cls">{{ k.value }}</p><p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p></div> }
        </div>

        <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
          <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Section</th><th class="px-5 py-4">Class incharge</th><th class="px-5 py-4 text-right">Pass</th><th class="px-5 py-4 text-right">Fail</th><th class="px-5 py-4 text-right">Pass %</th><th class="px-5 py-4 text-right">Average</th><th class="px-5 py-4 text-right">Highest</th><th class="px-5 py-4 text-right">Need call</th></tr></thead>
            <tbody>@for (r of x.sections; track r.section_id) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="px-5 py-3 font-black"><a [routerLink]="['/exams/sheet']" [queryParams]="{ examId: x.exam.id, sectionId: r.section_id }" class="hover:text-indigo-500">{{ r.label }}</a></td><td class="px-5 py-3 text-slate-500">{{ r.class_teacher || '-' }}</td>
              <td class="px-5 py-3 text-right font-bold text-emerald-600">{{ r.pass }}</td><td class="px-5 py-3 text-right font-bold text-rose-500">{{ r.fail }}</td><td class="px-5 py-3 text-right font-black" [class]="pc(r.passPct, 70)">{{ r.passPct ?? '-' }}</td><td class="px-5 py-3 text-right font-bold">{{ r.avg ?? '-' }}</td><td class="px-5 py-3 text-right">{{ r.highest ?? '-' }}</td><td class="px-5 py-3 text-right font-bold">{{ r.needCall }}</td></tr> }</tbody></table>
        </div>

        <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
          <h4 class="text-lg font-black mb-4">Subject and teacher results (average % / pass %)</h4>
          <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2 pr-4">Subject</th>@for (c of x.sections; track c.section_id) { <th class="py-2 px-2">{{ c.label.split('-')[1] }}</th> }</tr></thead>
            <tbody>@for (sub of x.subjects; track sub.subject) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 pr-4 font-black">{{ sub.subject }}</td>
              @for (c of sub.sections; track c.label) { <td class="py-2 px-2 whitespace-nowrap" [title]="c.teacher ?? ''"><span class="font-black" [class]="pc(c.passPct, 70)">{{ c.avgPct ?? '-' }} / {{ c.passPct ?? '-' }}</span><span class="block text-[10px] font-bold text-slate-400">{{ c.teacher }}</span></td> }</tr> }</tbody></table>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><h4 class="text-lg font-black mb-4">By category (A, B, C)</h4>
            @for (c of x.categories; track c.cat) { <div class="flex items-center gap-3 mb-3"><span class="w-10 px-2 py-1 rounded-lg text-xs font-black text-center" [class]="cat(c.cat)">{{ c.cat === '-' ? '?' : c.cat }}</span><div class="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full bg-indigo-600" [style.width.%]="c.avg"></div></div><span class="w-40 text-right text-xs font-black">{{ c.students }} students · avg {{ c.avg ?? '-' }}% · pass {{ c.passPct ?? '-' }}%</span></div> }</div>
          @if (x.trend.length > 1) { <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><h4 class="text-lg font-black mb-4">Test by test (class average)</h4>
            @for (t of x.trend; track t.exam) { <div class="flex items-center gap-3 mb-3"><span class="w-28 text-xs font-bold text-slate-500 truncate">{{ t.exam }}</span><div class="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full bg-emerald-500" [style.width.%]="t.avg"></div></div><span class="w-32 text-right text-xs font-black">{{ t.avg ?? '-' }}% · pass {{ t.passPct ?? '-' }}%</span></div> }</div> }
          <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><h4 class="text-lg font-black mb-3">Top 5 of the class</h4>@for (p of x.top; track p.id) { <p class="flex justify-between py-1.5 text-sm"><span class="font-black">{{ p.name }} <span class="text-slate-400 font-bold">{{ p.label }}</span></span><span class="font-black text-emerald-600">{{ p.pct }}%</span></p> }</div>
          <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><h4 class="text-lg font-black mb-3">Most improved</h4>@for (p of x.up; track p.id) { <p class="flex justify-between py-1.5 text-sm"><span class="font-black">{{ p.name }} <span class="text-slate-400 font-bold">{{ p.label }}</span></span><span class="font-black text-emerald-600">▲ {{ dt(p.delta) }}</span></p> } @if (!x.up.length) { <p class="text-sm font-bold text-slate-400">Needs an earlier test to compare.</p> }</div>
          <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 xl:col-span-2"><h4 class="text-lg font-black mb-3">Biggest decline (parents to be called)</h4>@for (p of x.down; track p.id) { <p class="flex justify-between py-1.5 text-sm"><span class="font-black">{{ p.name }} <span class="text-slate-400 font-bold">{{ p.label }}</span></span><span class="font-black text-rose-500">▼ {{ dt(p.delta) }} ({{ p.pct }}%)</span></p> } @if (!x.down.length) { <p class="text-sm font-bold text-slate-400">Needs an earlier test to compare.</p> }</div>
        </div>
      </div>
    }
  </div>
  `
})
export class ExamAnalysis {
  private api = inject(Api);
  settings = inject(SettingsService);
  pc = pctClass; cat = catClass; dt = deltaText;
  exams = signal<ExamItem[]>([]); classes = signal<ClassInfo[]>([]);
  examId = signal<number | null>(null); classId = signal<number | null>(null);
  s = signal<Summary | null>(null); error = signal('');
  examOptions = computed(() => { const cn = this.classes().find(c => c.id === this.classId())?.name; return this.exams().filter(e => !cn || e.classes.includes(cn)); });
  kpis = computed(() => { const o = this.s()?.overall; if (!o) return []; return [{ label: 'Students', value: String(o.students), cls: '' }, { label: 'Passed', value: String(o.pass), cls: 'text-emerald-600' }, { label: 'Failed', value: String(o.fail), cls: 'text-rose-500' }, { label: 'Pass percentage', value: o.passPct === null ? '-' : o.passPct + '%', cls: '' }, { label: 'Average', value: o.avg === null ? '-' : o.avg + '%', cls: '' }]; });
  constructor() {
    this.api.get<ClassInfo[]>('/classes').subscribe(c => { this.classes.set(c); this.classId.set(c[0]?.id ?? null); this.pick(); });
    this.api.get<ExamItem[]>('/exam/exams').subscribe(e => { this.exams.set(e); this.pick(); });
  }
  private pick() { const o = this.examOptions(); if (o.length && !o.some(e => e.id === this.examId())) this.examId.set(o.find(e => e.entered > 0)?.id ?? o[0].id); this.load(); }
  setExam(id: number) { this.examId.set(id); this.load(); }
  setClass(id: number) { this.classId.set(id); this.pick(); }
  load() { const e = this.examId(), c = this.classId(); if (!e || !c) return; this.api.get<Summary>(`/exam/exams/${e}/summary`, { classId: c }).subscribe({ next: s => { this.s.set(s); this.error.set(''); }, error: x => this.error.set(errorText(x)) }); }
  print() { window.print(); }
}
