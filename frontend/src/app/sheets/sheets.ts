import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ClassInfo } from '../core/models';

interface Stu { id: number; roll_no: number | null; name: string; father_name: string; reg_no: string }
interface Sheet { institute: string; short: string; section_id: number; label: string; class_name: string; section_name: string; class_teacher: string | null; periods: number; students: Stu[]; subjects: { id: number; name: string; teacher: string | null }[] }
type Kind = 'attendance' | 'award-subject' | 'award-class';

/** Blank sheets to print and fill by hand (attendance, award lists) and the class data download for the office. */
@Component({
  selector: 'app-sheets',
  imports: [FormsModule],
  styles: [`
    @media print { @page { size: A4 landscape; margin: 8mm; } .sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; } }
    .sheet { background: #fff; color: #111; width: 281mm; max-width: 100%; margin: 0 auto 6mm; padding: 6mm 8mm; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; box-shadow: 0 1px 6px #0003; break-after: page; overflow-x: auto; }
    .sheet:last-child { break-after: auto; }
    .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: .5mm solid #111; padding-bottom: 1.5mm; margin-bottom: 2mm; gap: 6mm; }
    .hd h1 { margin: 0; font-size: 13pt; text-transform: uppercase; } .hd p { margin: 0; font-size: 8.5pt; }
    table { width: 100%; border-collapse: collapse; } th, td { border: .25mm solid #444; padding: 0 1.2mm; height: 6.4mm; font-size: 8.5pt; text-align: left; }
    th { background: #eee; text-align: center; font-size: 8pt; } td.c { text-align: center; } thead { display: table-header-group; } tr { break-inside: avoid; }
    td.n { white-space: nowrap; max-width: 55mm; overflow: hidden; text-overflow: ellipsis; }
    tfoot td { height: 11mm; vertical-align: bottom; font-size: 7pt; text-align: center; color: #444; }
    .sg { display: flex; justify-content: space-between; gap: 12mm; margin-top: 10mm; font-size: 8.5pt; } .sg div { flex: 1; border-top: .3mm solid #111; text-align: center; padding-top: 1mm; }
    .line { display: inline-block; min-width: 28mm; border-bottom: .3mm solid #111; }
  `],
  template: `
  <div class="no-print max-w-5xl mx-auto pb-6 space-y-5">
    <div><h2 class="text-3xl font-black tracking-tighter">Sheets &amp; Lists</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Print blank sheets to fill by hand (attendance with a signature for every period, award lists without marks) or download the class data.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 items-end bg-white dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-800">
      <div class="col-span-2"><label class="label" for="sh-kind">Sheet</label>
        <select id="sh-kind" class="field" [ngModel]="kind()" (ngModelChange)="kind.set($event); sheets.set([])">
          <option value="attendance">Daily attendance sheet (every period, with signatures)</option>
          <option value="award-subject">Award list: one subject (blank marks)</option>
          <option value="award-class">Award list: whole class, all subjects (blank marks)</option>
        </select></div>
      <div><label class="label" for="sh-class">Class</label><select id="sh-class" class="field" [ngModel]="classId()" (ngModelChange)="classId.set($event); sectionId.set(null); sheets.set([])"><option [ngValue]="null">Choose…</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
      <div><label class="label" for="sh-sec">Section</label><select id="sh-sec" class="field" [ngModel]="sectionId()" (ngModelChange)="sectionId.set($event); sheets.set([])" [disabled]="!classId()"><option [ngValue]="null">All sections</option>@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
      @if (kind() === 'award-subject') {
        <div class="col-span-2"><label class="label" for="sh-sub">Subject</label><select id="sh-sub" class="field" [ngModel]="subject()" (ngModelChange)="subject.set($event)"><option value="">(write by hand)</option>@for (s of subjectNames(); track s) { <option [value]="s">{{ s }}</option> }</select></div>
      }
      @if (kind() !== 'attendance') { <div class="col-span-2"><label class="label" for="sh-exam">Exam / test name (optional)</label><input id="sh-exam" class="field" dir="auto" [ngModel]="exam()" (ngModelChange)="exam.set($event)" placeholder="e.g. Terminal Exam 2026"></div> }
      @else { <div><label class="label" for="sh-per">Periods</label><input id="sh-per" type="number" min="1" max="12" class="field" [ngModel]="periods()" (ngModelChange)="periods.set($event)"></div> }
      <div class="flex gap-3 col-span-2 md:col-span-4"><button type="button" class="btn-primary" [disabled]="!classId() || busy()" (click)="load()">Prepare sheets</button>
        @if (sheets().length) { <button type="button" class="btn-ghost" (click)="print()">Print {{ sheets().length }} sheet(s)</button> }</div>
    </div>
    @if (auth.canWriteStudents()) {
      <div class="bg-white dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
        <h3 class="text-xl font-black">Class data download (Excel / CSV)</h3>
        <p class="text-sm font-bold text-slate-500">Student details with the parents' category and phone numbers for the class (or section) chosen above; leave the class empty to get every class. This file holds private data; the download is written to the audit log.</p>
        <button type="button" class="btn-ghost" [disabled]="busy()" (click)="download()">Download class data</button>
      </div>
    }
  </div>

  @for (s of sheets(); track s.section_id) {
    <section class="sheet">
      <div class="hd"><div><h1>{{ s.institute }}</h1><p>{{ title() }}</p></div>
        <div style="text-align:right"><p><b>Class {{ s.label }}</b> · {{ s.students.length }} students</p>@if (s.class_teacher) { <p>Class teacher: {{ s.class_teacher }}</p> }@if (kind() === 'attendance') { <p>Date: <span class="line"></span></p> } @else { <p>{{ exam() }}</p> }</div></div>

      @if (kind() === 'attendance') {
        <table><thead><tr><th style="width:9mm">Roll</th><th>Name</th><th>Father</th>@for (p of periodList(); track p) { <th style="width:15mm">P{{ p }}</th> }</tr></thead>
          <tbody>@for (st of s.students; track st.id) { <tr><td class="c">{{ st.roll_no }}</td><td class="n">{{ st.name }}</td><td class="n">{{ st.father_name }}</td>@for (p of periodList(); track p) { <td></td> }</tr> }</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right">Subject / teacher's signature →</td>@for (p of periodList(); track p) { <td></td> }</tr></tfoot></table>
        <p style="font-size:7.5pt;margin:1.5mm 0 0">P = present, A = absent, L = leave. Total present: <span class="line"></span> absent: <span class="line"></span></p>
      }
      @if (kind() === 'award-subject') {
        <p style="margin:0 0 2mm"><b>Subject:</b> {{ subject() || '____________________' }} &nbsp;&nbsp; <b>Maximum marks:</b> <span class="line" style="min-width:18mm"></span> &nbsp;&nbsp; <b>Date:</b> <span class="line"></span> &nbsp;&nbsp; <b>Teacher:</b> {{ teacherOf(s) || '____________________' }}</p>
        <table><thead><tr><th style="width:11mm">Roll</th><th style="width:22mm">Adm. no</th><th>Name</th><th>Father</th><th style="width:30mm">Marks obtained</th><th style="width:22mm">Absent / Leave</th><th style="width:34mm">Remarks</th></tr></thead>
          <tbody>@for (st of s.students; track st.id) { <tr><td class="c">{{ st.roll_no }}</td><td class="c">{{ st.reg_no }}</td><td class="n">{{ st.name }}</td><td class="n">{{ st.father_name }}</td><td></td><td></td><td></td></tr> }</tbody></table>
        <div class="sg"><div>Subject teacher</div><div>Checked by (exam department)</div><div>Principal</div></div>
      }
      @if (kind() === 'award-class') {
        <table><thead><tr><th style="width:9mm" rowspan="2">Roll</th><th rowspan="2">Name</th>@for (sub of s.subjects; track sub.id) { <th>{{ sub.name }}</th> }<th style="width:16mm" rowspan="2">Total</th><th style="width:13mm" rowspan="2">%</th><th style="width:14mm" rowspan="2">Position</th></tr>
          <tr>@for (sub of s.subjects; track sub.id) { <th style="font-weight:400;font-size:7pt">max: ____</th> }</tr></thead>
          <tbody>@for (st of s.students; track st.id) { <tr><td class="c">{{ st.roll_no }}</td><td class="n">{{ st.name }}</td>@for (sub of s.subjects; track sub.id) { <td></td> }<td></td><td></td><td></td></tr> }</tbody></table>
        @if (!s.subjects.length) { <p style="color:#b00;font-size:8pt">No subjects are assigned to this section yet (Timetable → Subjects), so no subject columns are shown.</p> }
        <div class="sg"><div>Class teacher</div><div>Checked by (exam department)</div><div>Principal</div></div>
      }
    </section>
  }
  `
})
export class Sheets {
  private api = inject(Api); auth = inject(AuthService);
  classes = signal<ClassInfo[]>([]); classId = signal<number | null>(null); sectionId = signal<number | null>(null);
  kind = signal<Kind>('attendance'); subject = signal(''); exam = signal(''); periods = signal<number | null>(null);
  sheets = signal<Sheet[]>([]); busy = signal(false); error = signal('');
  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  subjectNames = computed(() => [...new Set(this.sheets().flatMap(s => s.subjects.map(x => x.name)))].sort());
  periodList = computed(() => Array.from({ length: Math.max(1, Math.min(12, Number(this.periods()) || this.sheets()[0]?.periods || 7)) }, (_, i) => i + 1));
  title = computed(() => ({ attendance: 'Daily Attendance Sheet', 'award-subject': 'Award List', 'award-class': 'Award List (all subjects)' })[this.kind()]);
  teacherOf = (s: Sheet) => s.subjects.find(x => x.name === this.subject())?.teacher ?? '';

  constructor() { this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => this.classes.set(c), error: e => this.error.set(errorText(e)) }); }

  load() {
    const ids = this.sectionId() ? [this.sectionId()!] : this.sections().map(s => s.id);
    if (!ids.length) { this.error.set('This class has no section.'); return; }
    this.busy.set(true); this.error.set('');
    this.api.get<Sheet[]>('/sheets/sections', { ids: ids.join(',') }).subscribe({
      next: r => { this.sheets.set(r); this.busy.set(false); if (!r.length) this.error.set('No section found.'); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  print() { window.print(); }
  download() {
    this.busy.set(true);
    this.api.get<{ columns: string[]; rows: unknown[][] }>('/sheets/export', { classId: this.sectionId() ? undefined : this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined }).subscribe({
      next: r => {
        this.busy.set(false);
        const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const text = '﻿' + [r.columns.map(q).join(','), ...r.rows.map(row => row.map(q).join(','))].join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
        const c = this.classes().find(x => x.id === this.classId()), s = this.sections().find(x => x.id === this.sectionId());
        a.download = `class-data-${c ? c.name.replace(/\W+/g, '') + (s ? '-' + s.name : '') : 'all'}.csv`; a.click(); URL.revokeObjectURL(a.href);
      },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
}
