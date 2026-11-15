import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { csv, monthLabel, money, today, fmtDate } from './hr';

interface AttRow { id: number; emp_no: string; name: string; designation: string | null; department: string | null; working_days: number; P: number; LT: number; A: number; L: number; HD: number; unmarked: number }
interface Sal { month: string; byDepartment: { department: string | null; kind: string; staff: number; gross: number; cut: number; net: number }[]; months: { month: string; staff: number; gross: number; cut: number; net: number; paid: number }[] }
interface Lv { year: string; types: { id: number; name: string }[]; rows: { id: number; emp_no: string; name: string; designation: string | null; used: Record<number, number>; total: number }[] }
interface Mv { from: string; to: string; joined: { name: string; designation: string | null; joining_date: string }[]; left: { name: string; designation: string | null; status: string; left_date: string; left_reason: string | null }[] }

@Component({
  selector: 'app-hr-reports',
  imports: [FormsModule],
  template: `
  <div class="space-y-6">
    <div class="flex flex-wrap gap-2">@for (t of tabs; track t.key) { <button type="button" (click)="tab.set(t.key); load()" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all" [class]="tab() === t.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ t.label }}</button> }</div>
    <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-wrap items-end gap-4">
      @if (tab() === 'leaves') { <div><label class="label" for="ry">Year</label><input id="ry" type="number" min="2000" class="field w-32" [ngModel]="year()" (ngModelChange)="year.set($event); load()"></div> }
      @else if (tab() === 'movement') { <div><label class="label" for="rf">From</label><input id="rf" type="date" class="field" [ngModel]="from()" (ngModelChange)="from.set($event); load()"></div><div><label class="label" for="rt">To</label><input id="rt" type="date" class="field" [ngModel]="to()" (ngModelChange)="to.set($event); load()"></div> }
      @else { <div><label class="label" for="rm">Month</label><input id="rm" type="month" class="field" [ngModel]="month()" (ngModelChange)="month.set($event); load()"></div> }
      <button type="button" class="btn-ghost" (click)="download()">Download for Excel (CSV)</button><button type="button" class="btn-ghost" (click)="print()">Print</button>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto print:shadow-none">
    @switch (tab()) {
      @case ('attendance') { @if (att(); as a) { <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Staff</th><th class="px-3 py-4">School days</th><th class="px-3 py-4">Present</th><th class="px-3 py-4">Late</th><th class="px-3 py-4">Absent</th><th class="px-3 py-4">Leave</th><th class="px-3 py-4">Half day</th><th class="px-3 py-4">Not marked</th></tr></thead>
        <tbody>@for (r of a; track r.id) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="px-5 py-2.5 font-black">{{ r.name }}<span class="block text-[11px] font-bold text-slate-400">{{ r.emp_no }} · {{ r.designation }}</span></td><td class="px-3">{{ r.working_days }}</td><td class="px-3">{{ r.P }}</td><td class="px-3">{{ r.LT }}</td><td class="px-3 font-black text-rose-600">{{ r.A }}</td><td class="px-3">{{ r.L }}</td><td class="px-3">{{ r.HD }}</td><td class="px-3">{{ r.unmarked }}</td></tr> }</tbody></table> } }
      @case ('salary') { @if (sal(); as s) {
        <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Department ({{ ml(s.month) }})</th><th class="px-3 py-4">Staff</th><th class="px-3 py-4 text-right">Gross</th><th class="px-3 py-4 text-right">Cut</th><th class="px-5 py-4 text-right">Net paid out</th></tr></thead>
          <tbody>@for (r of s.byDepartment; track $index) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="px-5 py-2.5 font-black">{{ r.department || 'No department' }}</td><td class="px-3">{{ r.staff }}</td><td class="px-3 text-right">{{ m(r.gross) }}</td><td class="px-3 text-right text-rose-600">{{ m(r.cut) }}</td><td class="px-5 text-right font-black">{{ m(r.net) }}</td></tr> }
            <tr class="font-black"><td class="px-5 py-3">Total</td><td class="px-3">{{ sum(s, 'staff') }}</td><td class="px-3 text-right">{{ m(sum(s, 'gross')) }}</td><td class="px-3 text-right">{{ m(sum(s, 'cut')) }}</td><td class="px-5 text-right">{{ m(sum(s, 'net')) }}</td></tr></tbody></table>
        <table class="w-full text-left text-sm mt-6"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Last months</th><th class="px-3 py-4">Staff</th><th class="px-3 py-4 text-right">Gross</th><th class="px-3 py-4 text-right">Cut</th><th class="px-5 py-4 text-right">Net</th><th class="px-3 py-4">Paid</th></tr></thead>
          <tbody>@for (r of s.months; track r.month) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="px-5 py-2.5 font-black">{{ ml(r.month) }}</td><td class="px-3">{{ r.staff }}</td><td class="px-3 text-right">{{ m(r.gross) }}</td><td class="px-3 text-right text-rose-600">{{ m(r.cut) }}</td><td class="px-5 text-right font-black">{{ m(r.net) }}</td><td class="px-3">{{ r.paid }} of {{ r.staff }}</td></tr> }</tbody></table> } }
      @case ('leaves') { @if (lv(); as l) { <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Staff</th>@for (t of l.types; track t.id) { <th class="px-3 py-4">{{ t.name }}</th> }<th class="px-3 py-4">Total days</th></tr></thead>
        <tbody>@for (r of l.rows; track r.id) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="px-5 py-2.5 font-black">{{ r.name }}</td>@for (t of l.types; track t.id) { <td class="px-3">{{ r.used[t.id] ?? 0 }}</td> }<td class="px-3 font-black">{{ r.total }}</td></tr> }</tbody></table> } }
      @case ('movement') { @if (mv(); as v) { <div class="p-6 grid md:grid-cols-2 gap-8">
        <div><h3 class="font-black mb-3">Joined ({{ v.joined.length }})</h3>@for (r of v.joined; track $index) { <p class="text-sm font-bold py-1.5 border-b border-slate-100 dark:border-slate-800">{{ r.name }} · {{ r.designation }} · {{ d(r.joining_date) }}</p> } @empty { <p class="text-sm text-slate-400 font-bold">Nobody.</p> }</div>
        <div><h3 class="font-black mb-3">Left or resigned ({{ v.left.length }})</h3>@for (r of v.left; track $index) { <p class="text-sm font-bold py-1.5 border-b border-slate-100 dark:border-slate-800">{{ r.name }} · {{ r.status }} · {{ d(r.left_date) }}{{ r.left_reason ? ' · ' + r.left_reason : '' }}</p> } @empty { <p class="text-sm text-slate-400 font-bold">Nobody.</p> }</div></div> } }
    }
    </div>
  </div>
  `
})
export class HrReports {
  private api = inject(Api);
  private auth = inject(AuthService);
  m = money; ml = monthLabel; d = fmtDate;
  tabs = [...(this.auth.canHrOffice() ? [{ key: 'attendance', label: 'Attendance' }] : []), ...(this.auth.canHrPay() ? [{ key: 'salary', label: 'Salary cost' }] : []), ...(this.auth.canHrOffice() ? [{ key: 'leaves', label: 'Leaves' }, { key: 'movement', label: 'Joined / left' }] : [])];
  tab = signal(this.tabs[0]?.key ?? 'attendance'); month = signal(today().slice(0, 7)); year = signal(today().slice(0, 4)); from = signal(today().slice(0, 4) + '-01-01'); to = signal(today());
  att = signal<AttRow[] | null>(null); sal = signal<Sal | null>(null); lv = signal<Lv | null>(null); mv = signal<Mv | null>(null); error = signal('');
  constructor() { this.load(); }
  sum(s: Sal, k: 'staff' | 'gross' | 'cut' | 'net') { return s.byDepartment.reduce((a, r) => a + r[k], 0); }
  load() {
    this.error.set(''); const err = (e: unknown) => this.error.set(errorText(e));
    switch (this.tab()) {
      case 'attendance': this.api.get<{ rows: AttRow[] }>('/hr/reports/attendance', { month: this.month() }).subscribe({ next: r => this.att.set(r.rows), error: err }); break;
      case 'salary': this.api.get<Sal>('/hr/reports/salary', { month: this.month() }).subscribe({ next: r => this.sal.set(r), error: err }); break;
      case 'leaves': this.api.get<Lv>('/hr/reports/leaves', { year: this.year() }).subscribe({ next: r => this.lv.set(r), error: err }); break;
      default: this.api.get<Mv>('/hr/reports/movement', { from: this.from(), to: this.to() }).subscribe({ next: r => this.mv.set(r), error: err });
    }
  }
  print() { window.print(); }
  download() {
    const t = this.tab();
    if (t === 'attendance' && this.att()) csv(`staff-attendance-${this.month()}.csv`, [['Emp no', 'Name', 'Designation', 'School days', 'Present', 'Late', 'Absent', 'Leave', 'Half day', 'Not marked'], ...this.att()!.map(r => [r.emp_no, r.name, r.designation, r.working_days, r.P, r.LT, r.A, r.L, r.HD, r.unmarked])]);
    else if (t === 'salary' && this.sal()) csv(`salary-cost-${this.month()}.csv`, [['Department', 'Staff', 'Gross', 'Cut', 'Net'], ...this.sal()!.byDepartment.map(r => [r.department, r.staff, r.gross, r.cut, r.net])]);
    else if (t === 'leaves' && this.lv()) csv(`leaves-${this.year()}.csv`, [['Name', ...this.lv()!.types.map(x => x.name), 'Total'], ...this.lv()!.rows.map(r => [r.name, ...this.lv()!.types.map(x => r.used[x.id] ?? 0), r.total])]);
    else if (t === 'movement' && this.mv()) csv('joined-left.csv', [['Type', 'Name', 'Designation', 'Date', 'Note'], ...this.mv()!.joined.map(r => ['Joined', r.name, r.designation, r.joining_date, '']), ...this.mv()!.left.map(r => [r.status, r.name, r.designation, r.left_date, r.left_reason])]);
  }
}
