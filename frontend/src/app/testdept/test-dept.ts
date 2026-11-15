import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { saveText } from '../core/files';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';

interface ExamLite { id: number; name: string; session: string; status: string }
interface Paper { id: number; section_id: number; section: string; subject: string; teacher: string | null; test_date: string | null; max_marks: number; entered: number; total: number; state: 'empty' | 'none' | 'partial' | 'complete' }
interface TTeacher { teacher_id: number | null; teacher: string; papers: number; complete: number; pending: number }
interface Tracker { exam: { id: number; name: string }; papers: Paper[]; teachers: TTeacher[]; summary: { papers: number; complete: number; partial: number; none: number } }
interface ListData { exam: string; section: string; subjects: { id: number; name: string; max: number }[]; rows: { roll_no: number | null; reg_no: string; name: string; father_name: string; marks: (number | string)[]; total: number | null; max: number | null; pct: number | null; rank: number | null; result: string }[]; csv: string; incomplete: number }
const STATE: Record<string, { text: string; cls: string }> = { complete: { text: 'All in', cls: 'text-emerald-600' }, partial: { text: 'Partly', cls: 'text-amber-600' }, none: { text: 'Not started', cls: 'text-rose-600' }, empty: { text: 'No students', cls: 'text-slate-400' } };

@Component({
  selector: 'app-test-dept',
  imports: [FormsModule],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <div class="no-print"><h2 class="text-3xl font-black tracking-tighter">Test Department</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">See whose marks are still missing, remind them, and print the class lists once they are in.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="flex flex-wrap items-end gap-3 no-print">
      <div><label class="label" for="t-exam">Exam or test</label><select id="t-exam" name="exam" class="field" [ngModel]="examId()" (ngModelChange)="pick($event)"><option [ngValue]="0">Choose</option>@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }})</option> }</select></div>
    </div>
    @if (t(); as x) {
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 no-print">
        <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ x.summary.papers }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Papers</div></div>
        <div class="p-4 rounded-2xl bg-emerald-500/10"><div class="text-2xl font-black text-emerald-600">{{ x.summary.complete }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">All marks in</div></div>
        <div class="p-4 rounded-2xl bg-amber-500/10"><div class="text-2xl font-black text-amber-600">{{ x.summary.partial }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Partly</div></div>
        <div class="p-4 rounded-2xl bg-rose-500/10"><div class="text-2xl font-black text-rose-600">{{ x.summary.none }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Not started</div></div>
      </div>
      <section class="no-print space-y-2"><h3 class="font-black">Teachers</h3>
        @for (w of x.teachers; track w.teacher) {
          <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800"><span class="font-black flex-1 min-w-40">{{ w.teacher }}</span><span class="text-sm font-bold">{{ w.complete }}/{{ w.papers }} done</span>
            @if (w.pending && w.teacher_id) { <button type="button" class="btn-ghost !py-2" (click)="remind(w)">Remind</button> }</div>
        }
      </section>
      <section class="no-print space-y-2"><h3 class="font-black">Papers</h3>
        <div class="overflow-x-auto"><table class="w-full text-sm"><caption class="sr-only">Marks collection by paper</caption>
          <thead><tr class="text-left text-[11px] font-black uppercase tracking-widest text-slate-400"><th scope="col" class="py-2">Class</th><th scope="col">Subject</th><th scope="col">Teacher</th><th scope="col">Date</th><th scope="col">Entered</th><th scope="col">State</th></tr></thead>
          <tbody>@for (p of x.papers; track p.id) { <tr class="border-t border-slate-100 dark:border-slate-800 font-bold"><td class="py-2">{{ p.section }}</td><td>{{ p.subject }}</td><td>{{ p.teacher ?? '-' }}</td><td>{{ p.test_date ?? '-' }}</td><td>{{ p.entered }}/{{ p.total }}</td><td [class]="state[p.state].cls">{{ state[p.state].text }}</td></tr> }</tbody></table></div>
      </section>
      <section class="space-y-3"><div class="flex flex-wrap items-end gap-3 no-print"><div><label class="label" for="t-sec">Class list</label><select id="t-sec" name="sec" class="field" [ngModel]="sectionId()" (ngModelChange)="loadList($event)"><option [ngValue]="0">Choose class</option>@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.label }}</option> }</select></div>
        @if (list()) { <button type="button" class="btn-ghost" (click)="csv()">Download for Excel</button><button type="button" class="btn-primary" (click)="print()">Print</button> }</div>
        @if (list(); as l) {
          <div class="overflow-x-auto bg-white text-black p-4 rounded-2xl"><h3 class="font-black text-center">{{ l.exam }} · Class {{ l.section }}</h3>@if (l.incomplete) { <p class="text-center text-xs text-rose-600">{{ l.incomplete }} student(s) have missing marks.</p> }
            <table class="w-full text-sm mt-2" style="border-collapse:collapse"><caption class="sr-only">Marks list</caption>
              <thead><tr><th scope="col" class="border border-slate-400 p-1">Roll</th><th scope="col" class="border border-slate-400 p-1 text-left">Name</th>@for (s of l.subjects; track s.id) { <th scope="col" class="border border-slate-400 p-1">{{ s.name }} ({{ s.max }})</th> }<th scope="col" class="border border-slate-400 p-1">Total</th><th scope="col" class="border border-slate-400 p-1">%</th><th scope="col" class="border border-slate-400 p-1">Pos</th><th scope="col" class="border border-slate-400 p-1">Result</th></tr></thead>
              <tbody>@for (r of l.rows; track r.reg_no) { <tr><td class="border border-slate-400 p-1 text-center">{{ r.roll_no ?? '' }}</td><td class="border border-slate-400 p-1">{{ r.name }}</td>@for (m of r.marks; track $index) { <td class="border border-slate-400 p-1 text-center">{{ m }}</td> }<td class="border border-slate-400 p-1 text-center">{{ r.total ?? '' }}</td><td class="border border-slate-400 p-1 text-center">{{ r.pct ?? '' }}</td><td class="border border-slate-400 p-1 text-center">{{ r.rank ?? '' }}</td><td class="border border-slate-400 p-1 text-center">{{ r.result }}</td></tr> }</tbody></table></div>
        }
      </section>
    }
  </div>
  `
})
export class TestDept {
  private api = inject(Api); private toast = inject(ToastService); state = STATE;
  exams = signal<ExamLite[]>([]); examId = signal(0); t = signal<Tracker | null>(null); sections = signal<{ id: number; label: string }[]>([]); sectionId = signal(0); list = signal<ListData | null>(null); error = signal('');
  constructor() {
    this.api.get<ExamLite[]>('/exam/exams').subscribe({ next: r => this.exams.set(r), error: e => this.error.set(errorText(e)) });
    this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => this.sections.set(c.flatMap(k => k.sections.map(s => ({ id: s.id, label: `${k.name}-${s.name}` })))) });
  }
  pick(id: number) { this.examId.set(id); this.t.set(null); this.list.set(null); this.sectionId.set(0); if (id) this.api.get<Tracker>('/testdept/tracker', { exam_id: id }).subscribe({ next: r => this.t.set(r), error: e => this.error.set(errorText(e)) }); }
  loadList(sid: number) { this.sectionId.set(sid); this.list.set(null); if (sid) this.api.get<ListData>('/testdept/list', { exam_id: this.examId(), section_id: sid }).subscribe({ next: r => this.list.set(r), error: e => this.toast.show(errorText(e), 'error') }); }
  remind(w: TTeacher) { this.api.post('/testdept/remind', { exam_id: this.examId(), teacher_id: w.teacher_id }).subscribe({ next: () => this.toast.show(`Reminder sent to ${w.teacher} as a task.`), error: e => this.toast.show(errorText(e), 'error') }); }
  csv() { const l = this.list(); if (l) saveText(`${l.exam}-${l.section}.csv`.replace(/[^\w.\-]+/g, '_'), l.csv); }
  print() { window.print(); }
}
