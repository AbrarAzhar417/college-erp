import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ATT_LABEL, ATT_SHORT, MonthDay, attBox, fmtDate, initials, monthLabel, today } from './hr';

interface Row { id: number; emp_no: string; name: string; designation: string | null; photo: string | null; status: string | null; note: string | null; time_in: string | null; time_out: string | null; leave_id: number | null }
interface Day { date: string; working: boolean; off: boolean; holiday: string | null; late_after: string; rows: Row[] }
interface MRow { id: number; emp_no: string; name: string; designation: string | null; marks: Record<string, string>; totals: Record<string, number> }
interface Month { month: string; days: MonthDay[]; rows: MRow[] }
const DOW = ['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'];

@Component({
  selector: 'app-hr-attendance',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="flex flex-wrap gap-2">
      @for (m of modes; track m.key) { <button type="button" (click)="mode.set(m.key); load()" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all" [class]="mode() === m.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ m.label }}</button> }
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (mode() === 'day') {
      <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-wrap items-end gap-4">
        <div><label class="label" for="ad">Date</label><input id="ad" type="date" class="field" [max]="todayIso" [ngModel]="date()" (ngModelChange)="date.set($event); load()"></div>
        <button type="button" class="btn-ghost" (click)="allPresent()">Mark everyone present</button>
        <button type="button" class="btn-primary" (click)="save()" [disabled]="busy()">Save attendance</button>
        <span class="text-xs font-bold text-slate-400">Everyone starts as present. Change only the exceptions. A time in after {{ day()?.late_after }} becomes Late by itself.</span>
      </div>
      @if (day(); as x) {
        @if (!x.working) { <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ x.holiday ? 'Holiday: ' + x.holiday : 'This is an off day.' }} Mark only the people who came in.</p> }
        <div class="flex flex-wrap gap-2">@for (k of keys; track k) { <span class="px-3 py-1.5 rounded-xl text-xs font-black" [class]="box(k)">{{ al[k] }}: {{ count(k) }}</span> }</div>
        <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Staff</th><th class="px-5 py-4">Status</th><th class="px-5 py-4">Time in</th><th class="px-5 py-4">Time out</th><th class="px-5 py-4">Note</th></tr></thead>
            <tbody>@for (r of x.rows; track r.id) {
              <tr class="border-b border-slate-50 dark:border-slate-800/60">
                <td class="px-5 py-3"><span class="font-black block">{{ r.name }}</span><span class="text-[11px] font-bold text-slate-400">{{ r.emp_no }} · {{ r.designation || '-' }}</span></td>
                <td class="px-5 py-3"><div class="flex gap-1.5">@for (k of keys; track k) {
                  <button type="button" (click)="r.status = k" [attr.aria-pressed]="r.status === k" [attr.aria-label]="al[k] + ' for ' + r.name" class="w-10 h-10 rounded-xl text-xs font-black transition-all" [class]="r.status === k ? box(k) + ' ring-2 ring-current' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'">{{ sh[k] }}</button> }</div>
                  @if (r.leave_id) { <span class="text-[11px] font-bold text-sky-600">Approved leave</span> }</td>
                <td class="px-5 py-3"><input type="time" class="field !py-2 w-32" [attr.aria-label]="'Time in ' + r.name" [(ngModel)]="r.time_in" [name]="'ti' + r.id"></td>
                <td class="px-5 py-3"><input type="time" class="field !py-2 w-32" [attr.aria-label]="'Time out ' + r.name" [(ngModel)]="r.time_out" [name]="'to' + r.id"></td>
                <td class="px-5 py-3"><input class="field !py-2 min-w-40" [attr.aria-label]="'Note ' + r.name" [(ngModel)]="r.note" [name]="'nt' + r.id"></td></tr> }</tbody>
          </table>
          @if (!x.rows.length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No staff yet. Add staff first.</p> }
        </div>
      }
    } @else {
      <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-wrap items-end gap-4">
        <div><label class="label" for="am">Month</label><input id="am" type="month" class="field" [ngModel]="month()" (ngModelChange)="month.set($event); load()"></div>
        <a class="btn-ghost" routerLink="/hr/print/register" [queryParams]="{ month: month() }">Print register</a>
        <span class="text-xs font-bold text-slate-400">P present · T late · A absent · L leave · H half day. To change a day, open it in "Mark a day".</span>
      </div>
      @if (mdata(); as x) {
        <section class="bg-white dark:bg-slate-900/40 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
          <table class="border-separate border-spacing-0 text-xs" aria-label="Staff attendance register">
            <thead><tr><th class="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-2 text-left min-w-44">{{ ml(x.month) }}</th>
              @for (d of x.days; track d.date) { <th class="px-0.5 py-1 text-center min-w-7" [class.opacity-40]="!d.working" [title]="d.holiday ?? ''"><span class="block text-[9px] text-slate-400">{{ dow[d.dow] }}</span><span class="block text-[10px] font-black">{{ d.day }}</span></th> }
              <th class="px-2 text-emerald-600">P</th><th class="px-2 text-amber-600">T</th><th class="px-2 text-rose-600">A</th><th class="px-2 text-sky-600">L</th><th class="px-2 text-violet-600">H</th></tr></thead>
            <tbody>@for (r of x.rows; track r.id) {
              <tr><td class="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 font-black whitespace-nowrap">{{ r.name }}</td>
                @for (d of x.days; track d.date) { <td class="p-0.5"><span class="flex w-7 h-7 items-center justify-center rounded-md text-[10px] font-black" [class]="cell(r, d)">{{ cellText(r, d) }}</span></td> }
                <td class="px-2 text-center font-black">{{ r.totals['P'] }}</td><td class="px-2 text-center font-black">{{ r.totals['LT'] }}</td><td class="px-2 text-center font-black">{{ r.totals['A'] }}</td><td class="px-2 text-center font-black">{{ r.totals['L'] }}</td><td class="px-2 text-center font-black">{{ r.totals['HD'] }}</td></tr> }</tbody>
          </table>
          @if (!x.rows.length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No staff in this month.</p> }
        </section>
      }
    }
  </div>
  `
})
export class HrAttendance {
  private api = inject(Api);
  private toast = inject(ToastService);
  modes = [{ key: 'day', label: 'Mark a day' }, { key: 'month', label: 'Month register' }];
  keys = ['P', 'LT', 'A', 'L', 'HD']; al = ATT_LABEL; sh = ATT_SHORT; dow = DOW; ml = monthLabel; fd = fmtDate; ini = initials; todayIso = today();
  mode = signal('day'); date = signal(today()); month = signal(today().slice(0, 7));
  day = signal<Day | null>(null); mdata = signal<Month | null>(null); error = signal(''); busy = signal(false);
  rowsCount = computed(() => this.day()?.rows.length ?? 0);
  constructor() { this.load(); }
  box(k: string) { return attBox(k); }
  count(k: string) { return this.day()?.rows.filter(r => r.status === k).length ?? 0; }
  load() {
    this.error.set('');
    if (this.mode() === 'day') this.api.get<Day>('/hr/attendance', { date: this.date() }).subscribe({
      next: d => { for (const r of d.rows) if (!r.status && d.working) r.status = 'P'; this.day.set(d); }, error: e => this.error.set(errorText(e))
    });
    else this.api.get<Month>('/hr/attendance/month', { month: this.month() }).subscribe({ next: m => this.mdata.set(m), error: e => this.error.set(errorText(e)) });
  }
  allPresent() { for (const r of this.day()?.rows ?? []) if (r.status !== 'L') r.status = 'P'; }
  save() {
    const d = this.day(); if (!d) return;
    const marks = d.rows.filter(r => r.status).map(r => ({ staff_id: r.id, status: r.status, note: r.note, time_in: r.time_in, time_out: r.time_out }));
    this.busy.set(true);
    this.api.put<{ saved: number }>('/hr/attendance', { date: this.date(), marks }).subscribe({
      next: r => { this.busy.set(false); this.toast.show(`Saved ${r.saved} people.`); this.load(); }, error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  cell(r: MRow, d: MonthDay) { return r.marks[d.date] ? attBox(r.marks[d.date]) : d.working ? 'bg-slate-500/5 text-slate-300' : 'text-slate-300'; }
  cellText(r: MRow, d: MonthDay) { const s = r.marks[d.date]; return s ? ATT_SHORT[s] : d.working ? '' : '·'; }
}
