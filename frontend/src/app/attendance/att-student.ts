import { StudentAvatar } from '../pages/student-avatar';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Api, errorText } from '../core/api';
import { DOW_LETTER, SHORT, Stats, cellClass, fmtDate, monthLabel, pctColor, pctText, today } from './att';

interface Report {
  student: { id: number; name: string; father_name: string; gender: string; phone: string | null; roll_no: number | null; reg_no: string; class_name: string; section_name: string };
  month: string; lowPct: number; months: (Stats & { month: string })[]; overall: { present: number; late: number; absent: number; leave: number; pct: number | null };
  calendar: { date: string; day: number; dow: number; off: boolean; holiday: string | null; working: boolean; status: string | null; note: string | null; future: boolean }[];
  subjects: { subject: string; present: number; absent: number; leave: number; total: number; pct: number | null }[];
  leaves: { id: number; from_date: string; to_date: string; kind: string; reason: string | null; status: string }[];
}

@Component({
  selector: 'app-att-student',
  imports: [FormsModule, StudentAvatar],
  template: `
  @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (r(); as r) {
    <div class="space-y-6">
      <section class="print-area bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
        <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <app-student-avatar [id]="r.student.id" [name]="r.student.name" [has]="true" [gender]="r.student.gender" size="lg" />
          <div class="flex-1">
            <h3 class="text-3xl font-black tracking-tighter">{{ r.student.name }}</h3>
            <p class="text-sm font-bold text-slate-400 mt-2">S/O {{ r.student.father_name }} · {{ r.student.class_name }}-{{ r.student.section_name }} · Roll {{ r.student.roll_no ?? '-' }} · Admission {{ r.student.reg_no }}{{ r.student.phone ? ' · ' + r.student.phone : '' }}</p>
          </div>
          <div class="text-right"><p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Overall attendance</p><p class="text-4xl font-black" [class]="pc(r.overall.pct, r.lowPct)">{{ pt(r.overall.pct) }}</p></div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black text-emerald-600">{{ r.overall.present + r.overall.late }}</p><p class="text-xs font-bold text-slate-400">Days present</p></div>
          <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black text-rose-500">{{ r.overall.absent }}</p><p class="text-xs font-bold text-slate-400">Days absent</p></div>
          <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black text-amber-500">{{ r.overall.leave }}</p><p class="text-xs font-bold text-slate-400">Days on leave</p></div>
          <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black text-sky-600">{{ r.overall.late }}</p><p class="text-xs font-bold text-slate-400">Times late</p></div>
        </div>
        <div class="overflow-x-auto"><table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="py-3 pr-4">Month</th><th class="py-3 pr-4 text-right">School days</th><th class="py-3 pr-4 text-right">Present</th><th class="py-3 pr-4 text-right">Late</th><th class="py-3 pr-4 text-right">Absent</th><th class="py-3 pr-4 text-right">Leave</th><th class="py-3 text-right">%</th></tr></thead>
          <tbody>@for (m of r.months; track m.month) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="py-2.5 pr-4 font-black">{{ ml(m.month) }}{{ m.source === 'totals' ? ' *' : '' }}</td><td class="py-2.5 pr-4 text-right">{{ m.workingDays }}</td><td class="py-2.5 pr-4 text-right font-bold text-emerald-600">{{ m.present }}</td><td class="py-2.5 pr-4 text-right font-bold text-sky-600">{{ m.late }}</td><td class="py-2.5 pr-4 text-right font-bold text-rose-500">{{ m.absent }}</td><td class="py-2.5 pr-4 text-right font-bold text-amber-500">{{ m.leave }}</td><td class="py-2.5 text-right font-black" [class]="pc(m.pct, r.lowPct)">{{ pt(m.pct) }}</td></tr> }</tbody></table>
          <p class="text-[11px] font-bold text-slate-400 mt-2">* entered as month totals</p></div>
      </section>

      <section class="no-print bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <div class="flex items-end justify-between gap-4"><h3 class="text-xl font-black tracking-tight">Calendar</h3><div><label class="label" for="cm">Month</label><input id="cm" type="month" class="field" [ngModel]="month()" (ngModelChange)="setMonth($event)"></div></div>
        <div class="grid grid-cols-7 gap-2 max-w-xl">
          @for (l of letters; track $index) { <span class="text-center text-[11px] font-black text-slate-400">{{ l }}</span> }
          @for (b of blanks(); track $index) { <span></span> }
          @for (d of r.calendar; track d.date) {
            <div class="aspect-square rounded-xl flex flex-col items-center justify-center text-xs font-black" [class]="d.working && !d.future ? cc(d.status) : 'bg-slate-100 dark:bg-slate-800/40 text-slate-400'" [title]="d.holiday ?? d.note ?? ''">
              <span class="text-[10px] opacity-70">{{ d.day }}</span><span>{{ d.working && !d.future ? short(d.status) : d.holiday ? 'H' : '' }}</span></div>
          }
        </div>
        <p class="text-xs font-bold text-slate-400">P present · A absent · L leave · T late · H holiday</p>
      </section>

      @if (r.subjects.length) {
        <section class="no-print bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
          <h3 class="text-xl font-black tracking-tight">Subject-wise attendance (period records)</h3>
          @for (s of r.subjects; track s.subject) { <div class="flex items-center gap-3"><span class="w-32 text-sm font-bold truncate">{{ s.subject }}</span><div class="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full" [style.width.%]="s.pct" [class]="s.pct !== null && s.pct < r.lowPct ? 'bg-rose-500' : 'bg-emerald-500'"></div></div><span class="w-14 text-right text-sm font-black">{{ pt(s.pct) }}</span></div> }
        </section>
      }
      @if (r.leaves.length) {
        <section class="no-print bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
          <h3 class="text-xl font-black tracking-tight">Leaves</h3>
          @for (l of r.leaves; track l.id) { <p class="text-sm font-bold p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50">{{ fd(l.from_date) }}{{ l.to_date !== l.from_date ? ' to ' + fd(l.to_date) : '' }} · <span class="capitalize">{{ l.kind }}</span>{{ l.reason ? ': ' + l.reason : '' }} · <span class="capitalize" [class]="l.status === 'approved' ? 'text-emerald-600' : l.status === 'pending' ? 'text-amber-600' : 'text-rose-500'">{{ l.status }}</span></p> }
        </section>
      }
      <div class="no-print"><button type="button" class="btn-ghost" (click)="print()">Print this report</button></div>
    </div>
  }
  `
})
export class AttStudent {
  private api = inject(Api);
  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => Number(p.get('id')))));
  ml = monthLabel; fd = fmtDate; pt = pctText; pc = pctColor; letters = DOW_LETTER.slice(1);
  short = (s: string | null) => (s ? SHORT[s] : ''); cc = (s: string | null) => cellClass(s);
  month = signal(today().slice(0, 7));
  r = signal<Report | null>(null); error = signal('');
  blanks = computed(() => Array.from({ length: (this.r()?.calendar[0]?.dow ?? 1) - 1 }));

  constructor() { this.load(); }
  setMonth(v: string) { if (v) { this.month.set(v); this.load(); } }
  load() { this.api.get<Report>(`/attendance/reports/student/${this.id()}`, { month: this.month() }).subscribe({ next: r => this.r.set(r), error: e => this.error.set(errorText(e)) }); }
  print() { window.print(); }
}
