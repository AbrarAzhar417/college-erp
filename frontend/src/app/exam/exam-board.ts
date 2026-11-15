import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { BOARD_STATUS, ExamItem, catClass, resultClass } from './exam';
import { money } from '../fee/fee';

interface Row {
  id: number; name: string; father_name: string; dob: string | null; roll_no: number | null; reg_no: string; category: string | null; p_number: string | null; class_name: string; section_name: string;
  pct: number | null; result: string; failed: string[]; attendance: number | null; dues: number; checks: { result: boolean; attendance: boolean; fee: boolean }; eligible: boolean;
  status: string; board_reg_no: string; board_roll_no: string; note: string; subjects: string[];
}

@Component({
  selector: 'app-exam-board',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="be">Send-up / exam used for eligibility</label><select id="be" class="field" [ngModel]="examId()" (ngModelChange)="setExam($event)">@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }</select></div>
      <div><label class="label" for="bc">Class</label><select id="bc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)"><option [ngValue]="null">All board classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
      <div><label class="label" for="bf">Show</label><select id="bf" class="field" [ngModel]="filter()" (ngModelChange)="filter.set($event)"><option value="all">Everyone</option><option value="eligible">Eligible</option><option value="not">Not eligible</option></select></div>
      <a class="btn-ghost" [routerLink]="['/exams/print/board']" [queryParams]="{ examId: examId(), classId: classId() ?? undefined, only: filter() === 'eligible' ? 'eligible' : undefined }">Print board list</a>
    </div>
    @if (preview()) { <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm font-bold">This is a preview made from {{ examName() }}. When the send-up exam marks are entered, choose the send-up above for the real eligibility.</p> }
    @if (!examId()) { <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm font-bold">No exam with marks yet, so eligibility cannot be worked out.</p> }
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <section class="grid grid-cols-2 xl:grid-cols-5 gap-4">
      @for (k of kpis(); track k.label) { <div class="p-5 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><p class="text-2xl font-black" [class]="k.cls">{{ k.value }}</p><p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p></div> }
    </section>
    <p class="text-xs font-bold text-slate-400">A student is eligible when the exam is passed, attendance is at least {{ min() }}% and there are no fee dues. The office can still send a student with a note.</p>

    <div class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [checked]="allSel()" (change)="toggleAll()"> Select all</label>
      <select class="field !w-52 !py-2.5" [ngModel]="bulk()" (ngModelChange)="bulk.set($event)" aria-label="Status for selected">@for (k of statusKeys; track k) { <option [value]="k">{{ bs(k) }}</option> }</select>
      <button type="button" class="btn-ghost !py-2.5" (click)="applyBulk()" [disabled]="!sel().size">Set for {{ sel().size }} selected</button>
    </div>

    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm min-w-[1000px]">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-4 py-4"></th><th class="px-4 py-4">Student</th><th class="px-4 py-4">Result</th><th class="px-4 py-4">Attendance</th><th class="px-4 py-4">Fee dues</th><th class="px-4 py-4">Eligible</th><th class="px-4 py-4">Status</th><th class="px-4 py-4">Board reg / roll no.</th><th class="px-4 py-4"></th></tr></thead>
        <tbody>@for (r of shown(); track r.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60">
            <td class="px-4 py-3"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [checked]="sel().has(r.id)" (change)="toggle(r.id)" [attr.aria-label]="'Select ' + r.name"></td>
            <td class="px-4 py-3 whitespace-nowrap"><span class="font-black">{{ r.name }}</span> @if (r.category) { <span class="px-1.5 py-0.5 rounded-md text-[10px] font-black" [class]="cat(r.category)">{{ r.category }}</span> }<span class="block text-[11px] font-bold text-slate-400">S/O {{ r.father_name }} · {{ r.class_name }}-{{ r.section_name }} · Roll {{ r.roll_no ?? '-' }}</span></td>
            <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="rc(r.result)">{{ r.result === 'INCOMPLETE' ? 'Pending' : r.result === 'PASS' ? 'Pass' : 'Fail' }}</span> <span class="text-xs font-bold text-slate-500">{{ r.pct ?? '' }}{{ r.pct !== null ? '%' : '' }}</span>@if (r.failed.length) { <span class="block text-[10px] font-bold text-rose-500">{{ r.failed.join(', ') }}</span> }</td>
            <td class="px-4 py-3 font-black" [class]="r.checks.attendance ? 'text-emerald-600' : 'text-rose-500'">{{ r.attendance === null ? '-' : r.attendance + '%' }}</td>
            <td class="px-4 py-3 font-black" [class]="r.checks.fee ? 'text-emerald-600' : 'text-rose-500'">{{ r.dues ? 'Rs ' + m(r.dues) : 'Clear' }}</td>
            <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="r.eligible ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'">{{ r.eligible ? 'Eligible' : 'Not eligible' }}</span></td>
            <td class="px-4 py-3"><select class="field !py-2 !text-xs !w-40" [(ngModel)]="r.status" [name]="'st' + r.id" aria-label="Status">@for (k of statusKeys; track k) { <option [value]="k">{{ bs(k) }}</option> }</select></td>
            <td class="px-4 py-3"><div class="flex gap-2"><input class="field !py-2 !text-xs !w-28" placeholder="Reg no." [(ngModel)]="r.board_reg_no" [name]="'rg' + r.id" aria-label="Board registration number"><input class="field !py-2 !text-xs !w-28" placeholder="Roll no." [(ngModel)]="r.board_roll_no" [name]="'rl' + r.id" aria-label="Board roll number"></div></td>
            <td class="px-4 py-3"><button type="button" class="px-3 py-2 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="save(r)">Save</button></td>
          </tr> }</tbody>
      </table>
      @if (!shown().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No students to show.</p> }
    </div>
  </div>
  `
})
export class ExamBoard {
  private api = inject(Api);
  private toast = inject(ToastService);
  m = money; cat = catClass; rc = resultClass; bs = (k: string) => BOARD_STATUS[k]; statusKeys = Object.keys(BOARD_STATUS);
  exams = signal<ExamItem[]>([]); classes = signal<ClassInfo[]>([]);
  examId = signal<number | null>(null); classId = signal<number | null>(null); filter = signal('all');
  rows = signal<Row[]>([]); preview = signal(false); min = signal(75); examName = signal(''); error = signal('');
  sel = signal<Set<number>>(new Set()); bulk = signal('submitted');
  shown = computed(() => this.rows().filter(r => this.filter() === 'all' || (this.filter() === 'eligible') === r.eligible));
  allSel = computed(() => this.shown().length > 0 && this.shown().every(r => this.sel().has(r.id)));
  kpis = computed(() => { const r = this.rows(); const c = (s: string) => r.filter(x => x.status === s).length; return [
    { label: 'Students', value: String(r.length), cls: '' }, { label: 'Eligible', value: String(r.filter(x => x.eligible).length), cls: 'text-emerald-600' }, { label: 'Not eligible', value: String(r.filter(x => !x.eligible).length), cls: 'text-rose-500' },
    { label: 'Sent to board', value: String(c('submitted') + c('roll_issued')), cls: '' }, { label: 'Board roll no. received', value: String(c('roll_issued')), cls: 'text-emerald-600' }]; });

  constructor() { this.api.get<ClassInfo[]>('/classes').subscribe(c => this.classes.set(c.filter(x => x.grade >= 9))); this.api.get<ExamItem[]>('/exam/exams').subscribe(e => this.exams.set(e.filter(x => x.classes.some(n => /9|10|11|12/.test(n))))); this.load(); }
  setExam(id: number) { this.examId.set(id); this.load(); }
  setClass(id: number | null) { this.classId.set(id); this.load(); }
  load() {
    this.api.get<{ exam: ExamItem | null; preview: boolean; minAttendance: number; rows: Row[] }>('/exam/board', { examId: this.examId() ?? undefined, classId: this.classId() ?? undefined }).subscribe({
      next: r => { this.rows.set(r.rows); this.preview.set(r.preview); this.min.set(r.minAttendance); this.examName.set(r.exam?.name ?? ''); if (r.exam && !this.examId()) this.examId.set(r.exam.id); this.sel.set(new Set()); this.error.set(''); },
      error: e => this.error.set(errorText(e)) });
  }
  toggle(id: number) { const s = new Set(this.sel()); s.has(id) ? s.delete(id) : s.add(id); this.sel.set(s); }
  toggleAll() { this.sel.set(this.allSel() ? new Set() : new Set(this.shown().map(r => r.id))); }
  save(r: Row) { this.api.put(`/exam/board/${r.id}`, { status: r.status, board_reg_no: r.board_reg_no, board_roll_no: r.board_roll_no, note: r.note }).subscribe({ next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error') }); }
  applyBulk() { this.api.post<{ updated: number }>('/exam/board/bulk', { ids: [...this.sel()], status: this.bulk() }).subscribe({ next: r => { this.toast.show(`${r.updated} students updated.`); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
