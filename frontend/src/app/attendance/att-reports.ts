import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ClassInfo } from '../core/models';
import { SettingsService } from '../core/settings';
import { monthLabel, pctColor, pctText, today, fmtDate } from './att';

interface Totals { present: number; late: number; absent: number; leave: number; recorded: number; pct: number | null }
interface SecRow extends Totals { section_id: number; class_name: string; section_name: string; grade: number; students: number; low: number }
interface StuRow { id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; phone: string | null; class_name: string; section_name: string; present: number; late: number; absent: number; leave: number; pct: number | null; source: string }
interface Report { month: string; workingDays: number; lowPct: number; sections: SecRow[]; students: StuRow[]; overall: Totals }
interface Analysis {
  lowPct: number; overall: Totals; weekday: (Totals & { dow: number })[]; perDay: (Totals & { date: string })[]; trend: (Totals & { month: string })[];
  byClass: (Totals & { class_name: string; students: number })[]; lowList: StuRow[]; topAbsent: StuRow[];
  streaks: { id: number; name: string; class_name: string; section_name: string; days: number; from: string; to: string }[];
  periodWise: (Totals & { period: number })[]; subjectWise: (Totals & { subject: string })[]; bunking: { id: number; name: string; class_name: string; section_name: string; missed_periods: number }[];
}
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  selector: 'app-att-reports',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="no-print bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
      <div><label class="label" for="gm">Month</label><input id="gm" type="month" class="field" [ngModel]="month()" (ngModelChange)="set('month', $event)"></div>
      <div><label class="label" for="gc">Class</label><select id="gc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)"><option [ngValue]="null">All classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
      <div><label class="label" for="gs">Section</label><select id="gs" class="field" [ngModel]="sectionId()" (ngModelChange)="set('sectionId', $event)" [disabled]="!classId()"><option [ngValue]="null">All sections</option>@for (s of sections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }</select></div>
      <div class="col-span-2 flex gap-3">
        <button type="button" class="btn-ghost" (click)="tab.set('summary')" [class.!bg-indigo-600]="tab() === 'summary'" [class.!text-white]="tab() === 'summary'">Summary</button>
        <button type="button" class="btn-ghost" (click)="tab.set('analysis')" [class.!bg-indigo-600]="tab() === 'analysis'" [class.!text-white]="tab() === 'analysis'">Analysis</button>
        <button type="button" class="btn-ghost" (click)="print()">Print</button>
      </div>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (tab() === 'summary' && rep(); as r) {
      <div class="print-area space-y-6">
        <div><h3 class="text-xl font-black tracking-tight">Attendance report · {{ ml(r.month) }}</h3>
          <p class="text-xs font-bold text-slate-400 mt-1">{{ settings.instituteName() }} · {{ r.workingDays }} school days so far · {{ scopeLabel() }} · below {{ r.lowPct }}% is marked red</p></div>
        <div class="grid grid-cols-2 xl:grid-cols-5 gap-4">
          @for (k of kpis(r.overall); track k.label) { <div class="p-5 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><p class="text-2xl font-black" [class]="k.cls">{{ k.value }}</p><p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p></div> }
        </div>

        <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Class</th><th class="px-5 py-4 text-right">Students</th><th class="px-5 py-4 text-right">Present</th><th class="px-5 py-4 text-right">Late</th><th class="px-5 py-4 text-right">Absent</th><th class="px-5 py-4 text-right">Leave</th><th class="px-5 py-4 text-right">Below {{ r.lowPct }}%</th><th class="px-5 py-4 text-right">Attendance</th></tr></thead>
            <tbody>
              @for (s of r.sections; track s.section_id) {
                <tr class="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td class="px-5 py-3 font-black whitespace-nowrap"><button type="button" class="hover:text-indigo-500" (click)="openSection(s)">{{ s.class_name }}-{{ s.section_name }}</button></td>
                  <td class="px-5 py-3 text-right">{{ s.students }}</td><td class="px-5 py-3 text-right font-bold text-emerald-600">{{ s.present }}</td><td class="px-5 py-3 text-right font-bold text-sky-600">{{ s.late }}</td>
                  <td class="px-5 py-3 text-right font-bold text-rose-500">{{ s.absent }}</td><td class="px-5 py-3 text-right font-bold text-amber-500">{{ s.leave }}</td>
                  <td class="px-5 py-3 text-right font-bold" [class.text-rose-500]="s.low">{{ s.low }}</td>
                  <td class="px-5 py-3 text-right font-black" [class]="pc(s.pct, r.lowPct)">{{ pt(s.pct) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (r.students.length) {
          <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Roll</th><th class="px-5 py-4">Student</th><th class="px-5 py-4">Class</th><th class="px-5 py-4 text-right">Present</th><th class="px-5 py-4 text-right">Late</th><th class="px-5 py-4 text-right">Absent</th><th class="px-5 py-4 text-right">Leave</th><th class="px-5 py-4 text-right">%</th></tr></thead>
              <tbody>
                @for (s of r.students; track s.id) {
                  <tr class="border-b border-slate-50 dark:border-slate-800/60">
                    <td class="px-5 py-2.5 font-black text-slate-400">{{ s.roll_no ?? '-' }}</td>
                    <td class="px-5 py-2.5 whitespace-nowrap"><a [routerLink]="['/attendance/student', s.id]" class="font-black hover:text-indigo-500">{{ s.name }}</a><span class="block text-[11px] font-bold text-slate-400">S/O {{ s.father_name }}</span></td>
                    <td class="px-5 py-2.5 whitespace-nowrap">{{ s.class_name }}-{{ s.section_name }}</td>
                    <td class="px-5 py-2.5 text-right font-bold text-emerald-600">{{ s.present }}</td><td class="px-5 py-2.5 text-right font-bold text-sky-600">{{ s.late }}</td>
                    <td class="px-5 py-2.5 text-right font-bold text-rose-500">{{ s.absent }}</td><td class="px-5 py-2.5 text-right font-bold text-amber-500">{{ s.leave }}</td>
                    <td class="px-5 py-2.5 text-right font-black" [class]="pc(s.pct, r.lowPct)">{{ pt(s.pct) }}{{ s.source === 'totals' ? ' *' : '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="px-5 pb-4 text-[11px] font-bold text-slate-400">* from month totals (no day by day record)</p>
          </div>
        } @else { <p class="no-print text-xs font-bold text-slate-400">Choose a class or section to see every student.</p> }
      </div>
    }

    @if (tab() === 'analysis' && an(); as a) {
      <div class="print-area space-y-6">
        <div><h3 class="text-xl font-black tracking-tight">Attendance analysis · {{ ml(month()) }}</h3><p class="text-xs font-bold text-slate-400 mt-1">{{ scopeLabel() }}</p></div>
        <div class="grid grid-cols-2 xl:grid-cols-5 gap-4">
          @for (k of kpis(a.overall); track k.label) { <div class="p-5 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><p class="text-2xl font-black" [class]="k.cls">{{ k.value }}</p><p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p></div> }
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
          @if (a.trend.length > 1) {
            <div class="card"><h4 class="h">Month by month</h4>@for (t of a.trend; track t.month) { <div class="bar"><span class="w-28 text-xs font-bold text-slate-500">{{ ml(t.month) }}</span><div class="track"><div class="fill" [style.width.%]="t.pct" [class]="fillCls(t.pct, a.lowPct)"></div></div><span class="w-14 text-right text-sm font-black">{{ pt(t.pct) }}</span></div> }</div>
          }
          @if (a.weekday.length) {
            <div class="card"><h4 class="h">Which weekday has most absence</h4>@for (w of a.weekday; track w.dow) { <div class="bar"><span class="w-28 text-xs font-bold text-slate-500">{{ dow(w.dow) }}</span><div class="track"><div class="fill" [style.width.%]="w.pct" [class]="fillCls(w.pct, a.lowPct)"></div></div><span class="w-14 text-right text-sm font-black">{{ pt(w.pct) }}</span></div> }</div>
          }
          @if (a.byClass.length) {
            <div class="card"><h4 class="h">Class comparison</h4>@for (c of a.byClass; track c.class_name) { <div class="bar"><span class="w-28 text-xs font-bold text-slate-500">{{ c.class_name }}</span><div class="track"><div class="fill" [style.width.%]="c.pct" [class]="fillCls(c.pct, a.lowPct)"></div></div><span class="w-14 text-right text-sm font-black">{{ pt(c.pct) }}</span></div> }</div>
          }
          @if (a.perDay.length) {
            <div class="card"><h4 class="h">Day by day</h4>
              <div class="flex items-end gap-1 h-32" role="img" aria-label="Attendance percentage for each school day">
                @for (d of a.perDay; track d.date) { <div class="flex-1 flex flex-col items-center justify-end h-full" [title]="fd(d.date) + ': ' + pt(d.pct)"><div class="w-full rounded-t-md" [style.height.%]="d.pct" [class]="fillCls(d.pct, a.lowPct)"></div><span class="text-[9px] font-bold text-slate-400 mt-1">{{ d.date.slice(8) }}</span></div> }
              </div></div>
          }
          @if (a.periodWise.length) {
            <div class="card"><h4 class="h">Period-wise attendance</h4>@for (p of a.periodWise; track p.period) { <div class="bar"><span class="w-28 text-xs font-bold text-slate-500">Period {{ p.period + 1 }}</span><div class="track"><div class="fill" [style.width.%]="p.pct" [class]="fillCls(p.pct, a.lowPct)"></div></div><span class="w-14 text-right text-sm font-black">{{ pt(p.pct) }}</span></div> }</div>
          }
          @if (a.subjectWise.length) {
            <div class="card"><h4 class="h">Subject-wise attendance (lowest first)</h4>@for (p of a.subjectWise; track p.subject) { <div class="bar"><span class="w-28 text-xs font-bold text-slate-500 truncate">{{ p.subject }}</span><div class="track"><div class="fill" [style.width.%]="p.pct" [class]="fillCls(p.pct, a.lowPct)"></div></div><span class="w-14 text-right text-sm font-black">{{ pt(p.pct) }}</span></div> }</div>
          }
        </div>

        @if (a.lowList.length) {
          <div class="card"><h4 class="h">Students below {{ a.lowPct }}% ({{ a.lowList.length }})</h4>
            <div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2 pr-4">Student</th><th class="py-2 pr-4">Class</th><th class="py-2 pr-4">Contact</th><th class="py-2 pr-4 text-right">Absent</th><th class="py-2 pr-4 text-right">Leave</th><th class="py-2 text-right">%</th></tr></thead>
              <tbody>@for (s of a.lowList; track s.id) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 pr-4"><a [routerLink]="['/attendance/student', s.id]" class="font-black hover:text-indigo-500">{{ s.name }}</a><span class="block text-[11px] font-bold text-slate-400">S/O {{ s.father_name }}</span></td><td class="py-2 pr-4 whitespace-nowrap">{{ s.class_name }}-{{ s.section_name }}</td><td class="py-2 pr-4 text-slate-500 whitespace-nowrap">{{ s.phone || '-' }}</td><td class="py-2 pr-4 text-right font-bold text-rose-500">{{ s.absent }}</td><td class="py-2 pr-4 text-right font-bold text-amber-500">{{ s.leave }}</td><td class="py-2 text-right font-black text-rose-500">{{ pt(s.pct) }}</td></tr> }</tbody></table></div></div>
        }
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
          @if (a.streaks.length) {
            <div class="card"><h4 class="h">Absent 3 or more days in a row</h4><ul class="space-y-2">@for (s of a.streaks; track s.id + s.from) { <li class="flex justify-between gap-3 p-3 rounded-2xl bg-rose-500/5 text-sm"><a [routerLink]="['/attendance/student', s.id]" class="font-black hover:text-indigo-500">{{ s.name }} <span class="text-slate-400 font-bold">{{ s.class_name }}-{{ s.section_name }}</span></a><span class="font-black text-rose-500 whitespace-nowrap">{{ s.days }} days · {{ fd(s.from).slice(0, 6) }} to {{ fd(s.to).slice(0, 6) }}</span></li> }</ul></div>
          }
          @if (a.topAbsent.length) {
            <div class="card"><h4 class="h">Most absent this month</h4><ul class="space-y-2">@for (s of a.topAbsent; track s.id) { <li class="flex justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50 text-sm"><a [routerLink]="['/attendance/student', s.id]" class="font-black hover:text-indigo-500">{{ s.name }} <span class="text-slate-400 font-bold">{{ s.class_name }}-{{ s.section_name }}</span></a><span class="font-black text-rose-500">{{ s.absent }} absent</span></li> }</ul></div>
          }
          @if (a.bunking.length) {
            <div class="card"><h4 class="h">In school but missing periods</h4><p class="text-xs font-bold text-slate-400 mb-3">Present in the morning register, absent in a period.</p><ul class="space-y-2">@for (s of a.bunking; track s.id) { <li class="flex justify-between gap-3 p-3 rounded-2xl bg-amber-500/5 text-sm"><a [routerLink]="['/attendance/student', s.id]" class="font-black hover:text-indigo-500">{{ s.name }} <span class="text-slate-400 font-bold">{{ s.class_name }}-{{ s.section_name }}</span></a><span class="font-black text-amber-600">{{ s.missed_periods }} periods</span></li> }</ul></div>
          }
        </div>
      </div>
    }
  </div>
  `,
  styles: [`
    .card { background: var(--card, transparent); }
    :host ::ng-deep .card { padding: 1.75rem; border-radius: 2.5rem; border: 1px solid rgb(226 232 240); background: #fff; box-shadow: 0 25px 50px -12px rgba(0,0,0,.1); }
    :host-context(.dark) ::ng-deep .card { background: rgba(15,23,42,.4); border-color: rgb(30 41 59); }
    :host ::ng-deep .h { font-size: 1.05rem; font-weight: 900; margin-bottom: 1rem; }
    :host ::ng-deep .bar { display: flex; align-items: center; gap: .75rem; margin-bottom: .6rem; }
    :host ::ng-deep .track { flex: 1; height: .8rem; border-radius: 9999px; background: rgb(241 245 249); overflow: hidden; }
    :host-context(.dark) ::ng-deep .track { background: rgb(2 6 23); }
    :host ::ng-deep .fill { height: 100%; border-radius: 9999px; }
    @media print { :host ::ng-deep .card { border: 0.2mm solid #999; box-shadow: none; border-radius: 3mm; break-inside: avoid; } }
  `]
})
export class AttReports {
  private api = inject(Api);
  settings = inject(SettingsService);
  ml = monthLabel; pt = pctText; pc = pctColor; fd = fmtDate; dow = (n: number) => DOW[n];
  month = signal(today().slice(0, 7)); classId = signal<number | null>(null); sectionId = signal<number | null>(null);
  tab = signal<'summary' | 'analysis'>('summary');
  classes = signal<ClassInfo[]>([]);
  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  rep = signal<Report | null>(null); an = signal<Analysis | null>(null); error = signal('');

  constructor() { this.api.get<ClassInfo[]>('/classes').subscribe(c => this.classes.set(c)); this.load(); }
  scopeLabel() {
    const c = this.classes().find(x => x.id === this.classId());
    return !c ? 'Whole college' : this.sectionId() ? `${c.name}, Section ${c.sections.find(s => s.id === this.sectionId())?.name}` : c.name;
  }
  fillCls(p: number | null, low: number) { return p === null ? 'bg-slate-300' : p < low ? 'bg-rose-500' : p < 90 ? 'bg-amber-500' : 'bg-emerald-500'; }
  kpis(t: Totals) {
    return [
      { label: 'Attendance', value: pctText(t.pct), cls: pctColor(t.pct, 75) }, { label: 'Present (incl. late)', value: String(t.present + t.late), cls: 'text-emerald-600' },
      { label: 'Absent', value: String(t.absent), cls: 'text-rose-500' }, { label: 'Leave', value: String(t.leave), cls: 'text-amber-500' }, { label: 'Late', value: String(t.late), cls: 'text-sky-600' }
    ];
  }
  set(k: 'month' | 'sectionId', v: any) { (this[k] as any).set(v); this.load(); }
  setClass(id: number | null) { this.classId.set(id); this.sectionId.set(null); this.load(); }
  openSection(s: SecRow) { const c = this.classes().find(x => x.sections.some(y => y.id === s.section_id)); if (c) { this.classId.set(c.id); this.sectionId.set(s.section_id); this.load(); } }
  print() { window.print(); }

  load() {
    const q = { month: this.month(), classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined };
    this.error.set('');
    this.api.get<Report>('/attendance/reports/month', q).subscribe({ next: r => this.rep.set(r), error: e => this.error.set(errorText(e)) });
    this.api.get<Analysis>('/attendance/reports/analysis', q).subscribe({ next: a => this.an.set(a), error: e => this.error.set(errorText(e)) });
  }
}
