import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { fmtDate } from './exam';
import { MarksFile } from './marks-file';
import { MarksScan } from './marks-scan';

interface PaperData {
  paper: { id: number; exam_id: number; exam_name: string; exam_status: string; pass_percent: number; class_name: string; section_name: string; subject: string; teacher: string | null; max_marks: number; test_date: string | null };
  canEdit: boolean; lockReason: string | null; prevName: string | null; prevMax: number | null;
  students: { id: number; name: string; father_name: string; roll_no: number | null; marks: number | null; status: string | null; prev: number | string | null }[];
}
interface Row { id: number; name: string; father_name: string; roll_no: number | null; text: string; prev: string }

@Component({
  selector: 'app-exam-marks',
  imports: [FormsModule, RouterLink, MarksFile, MarksScan],
  template: `
  @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (data(); as x) {
  <div class="space-y-6 max-w-4xl">
    <div class="flex flex-wrap items-center gap-3"><a routerLink="/exams/papers" class="btn-ghost !py-2.5">Back</a><a [routerLink]="['/exams/sheet']" [queryParams]="{ examId: x.paper.exam_id }" class="btn-ghost !py-2.5">Class sheet</a></div>
    <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <div><h3 class="text-2xl font-black tracking-tight">{{ x.paper.exam_name }} · {{ x.paper.class_name }}-{{ x.paper.section_name }} · {{ x.paper.subject }}</h3>
        <p class="text-xs font-bold text-slate-400 mt-1">{{ x.paper.teacher || 'No teacher' }} · pass marks {{ passMarks() }}</p></div>
      @if (x.lockReason) { <p class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 text-sm font-bold">{{ x.lockReason }}</p> }
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div><label class="label" for="td">Test date</label><input id="td" type="date" class="field" [(ngModel)]="date" [disabled]="!x.canEdit"></div>
        <div><label class="label" for="mx">Out of (marks)</label><input id="mx" type="number" min="1" class="field" [(ngModel)]="max" [disabled]="!x.canEdit"></div>
        <button type="button" class="btn-ghost" (click)="saveInfo()" [disabled]="!x.canEdit">Save date and marks</button>
      </div>
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <div class="flex flex-wrap gap-3 mb-5">
        @for (k of stats(); track k.label) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800">{{ k.label }} <b [class]="k.cls">{{ k.value }}</b></span> }
      </div>
      <p class="text-xs font-bold text-slate-400 mb-4">Type the marks and press Enter to go to the next student. Type <b>A</b> for absent, <b>L</b> for leave. Leave empty if not entered yet.{{ x.prevName ? ' The last column shows ' + x.prevName + '.' : '' }}</p>
      <div class="space-y-2">
        @for (r of rows(); track r.id; let i = $index) {
          <div class="flex items-center gap-3 p-2.5 pl-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <span class="w-8 text-xs font-black text-slate-400">{{ r.roll_no ?? '-' }}</span>
            <span class="flex-1 min-w-36"><span class="block text-sm font-black">{{ r.name }}</span><span class="block text-[11px] font-bold text-slate-400">S/O {{ r.father_name }}</span></span>
            <input data-mark class="field !py-2.5 !w-24 !text-center" [class.!border-rose-400]="bad(r)" inputmode="decimal" autocomplete="off" [ngModel]="r.text" (ngModelChange)="setText(i, $event)" (keydown.enter)="next($event)"
                   [disabled]="!x.canEdit" [attr.aria-label]="'Marks of ' + r.name">
            <span class="w-16 text-center text-[11px] font-black" [class]="flag(r).cls">{{ flag(r).text }}</span>
            <span class="w-14 text-right text-xs font-bold text-slate-400">{{ r.prev }}</span>
          </div>
        }
      </div>
      @if (x.canEdit) { <div class="sticky bottom-4 mt-6 flex justify-end"><button type="button" class="btn-primary shadow-enterprise-lg" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save marks' }}</button></div> }
    </section>
    <app-marks-file [paperId]="x.paper.id" [canEdit]="x.canEdit" (saved)="load()" />
    <app-marks-scan [paperId]="x.paper.id" [canEdit]="x.canEdit" (saved)="load()" />
  </div>
  }
  `
})
export class ExamMarks {
  private api = inject(Api);
  private toast = inject(ToastService);
  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => Number(p.get('id')))));
  data = signal<PaperData | null>(null); rows = signal<Row[]>([]); error = signal(''); saving = signal(false);
  date = ''; max = 25;
  maxN = computed(() => Number(this.max) || this.data()?.paper.max_marks || 0);
  passMarks = computed(() => { const x = this.data(); return x ? Math.round((this.maxN() * x.paper.pass_percent) / 100 * 10) / 10 : 0; });

  stats = computed(() => {
    const vals = this.rows().map(r => this.parse(r.text)).filter(p => p.kind === 'mark') as { kind: 'mark'; v: number }[];
    const pass = vals.filter(p => p.v >= this.passMarks()).length, ab = this.rows().filter(r => this.parse(r.text).kind === 'absent').length;
    return [
      { label: 'Entered', value: `${vals.length + ab}/${this.rows().length}`, cls: '' }, { label: 'Absent', value: String(ab), cls: 'text-rose-500' },
      { label: 'Passed', value: String(pass), cls: 'text-emerald-600' }, { label: 'Failed', value: String(vals.length - pass), cls: 'text-rose-500' },
      { label: 'Average', value: vals.length ? String(Math.round((vals.reduce((a, p) => a + p.v, 0) / vals.length) * 10) / 10) : '-', cls: '' }, { label: 'Highest', value: vals.length ? String(Math.max(...vals.map(p => p.v))) : '-', cls: 'text-emerald-600' }
    ];
  });

  constructor() { this.load(); }
  load() {
    this.api.get<PaperData>(`/exam/papers/${this.id()}`).subscribe({
      next: d => {
        this.data.set(d); this.date = d.paper.test_date ?? ''; this.max = d.paper.max_marks;
        this.rows.set(d.students.map(s => ({ id: s.id, name: s.name, father_name: s.father_name, roll_no: s.roll_no, text: s.status === 'A' ? 'A' : s.status === 'L' ? 'L' : s.marks === null ? '' : String(s.marks), prev: s.prev === null ? '' : String(s.prev) })));
      },
      error: e => this.error.set(errorText(e))
    });
  }
  parse(t: string): { kind: 'blank' } | { kind: 'absent' } | { kind: 'leave' } | { kind: 'mark'; v: number } | { kind: 'bad' } {
    const s = t.trim().toLowerCase(); if (!s) return { kind: 'blank' }; if (s === 'a') return { kind: 'absent' }; if (s === 'l') return { kind: 'leave' };
    const v = Number(s); return Number.isFinite(v) && v >= 0 && v <= this.maxN() ? { kind: 'mark', v } : { kind: 'bad' };
  }
  bad(r: Row) { return this.parse(r.text).kind === 'bad'; }
  flag(r: Row) {
    const p = this.parse(r.text);
    return p.kind === 'mark' ? (p.v >= this.passMarks() ? { text: 'Pass', cls: 'text-emerald-600' } : { text: 'Fail', cls: 'text-rose-500' })
      : p.kind === 'absent' ? { text: 'Absent', cls: 'text-rose-500' } : p.kind === 'leave' ? { text: 'Leave', cls: 'text-amber-500' } : p.kind === 'bad' ? { text: `Max ${this.maxN()}`, cls: 'text-rose-500' } : { text: '', cls: '' };
  }
  setText(i: number, v: string) { this.rows.set(this.rows().map((r, x) => (x === i ? { ...r, text: v } : r))); }
  next(ev: Event) {
    ev.preventDefault();
    const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-mark]')), i = all.indexOf(ev.target as HTMLInputElement);
    all[i + 1]?.focus(); all[i + 1]?.select();
  }

  saveInfo() {
    this.api.put(`/exam/papers/${this.id()}`, { test_date: this.date || null, max_marks: this.max }).subscribe({ next: () => { this.toast.show('Saved.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  save() {
    const bad = this.rows().find(r => this.bad(r));
    if (bad) { this.toast.show(`${bad.name}: marks must be 0 to ${this.maxN()}, or A / L.`, 'error'); return; }
    this.saving.set(true);
    const entries = this.rows().map(r => { const p = this.parse(r.text); return { student_id: r.id, status: p.kind === 'absent' ? 'A' : p.kind === 'leave' ? 'L' : 'P', marks: p.kind === 'mark' ? p.v : null }; });
    this.api.post<{ saved: number; cleared: number }>(`/exam/papers/${this.id()}/marks`, { entries }).subscribe({
      next: r => { this.saving.set(false); this.toast.show(`Marks saved for ${r.saved} students.`); this.load(); }, error: e => { this.saving.set(false); this.toast.show(errorText(e), 'error'); } });
  }
}
