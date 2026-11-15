import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { DOW_LETTER, SHORT, Stats, monthLabel, pctText, today, fmtDate } from './att';

interface Day { date: string; day: number; dow: number; off: boolean; holiday: string | null; working: boolean; future: boolean }
interface Stu { id: number; name: string; father_name: string; roll_no: number | null; marks: Record<string, string>; stats: Stats }
interface MonthData { month: string; section: string; workingDays: number; days: Day[]; students: Stu[] }

@Component({
  selector: 'app-att-register-print',
  imports: [LucideAngularModule],
  styles: [`
    * { box-sizing: border-box; }
    .sheet { width: 285mm; background: #fff; color: #111; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 7.5pt; letter-spacing: 0; word-spacing: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .head { display: flex; align-items: center; gap: 4mm; padding-bottom: 2mm; border-bottom: 0.5mm solid #1e1b4b; margin-bottom: 2mm; }
    .logo { width: 14mm; height: 14mm; display: flex; align-items: center; justify-content: center; flex: none; }
    .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font-weight: 800; font-size: 15pt; display: flex; align-items: center; justify-content: center; }
    h1 { margin: 0; font-size: 13pt; color: #1e1b4b; text-transform: uppercase; }
    .head p { margin: 0.5mm 0 0; font-size: 7pt; color: #444; }
    .title { margin-left: auto; text-align: right; font-size: 9pt; }
    .title b { display: block; font-size: 11pt; color: #1e1b4b; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 0.2mm solid #888; padding: 0; text-align: center; height: 5.2mm; overflow: hidden; }
    th { background: #eceef7; font-size: 6.5pt; color: #1e1b4b; }
    td.n { text-align: left; padding: 0 1.2mm; white-space: nowrap; font-weight: 700; }
    td.off { background: #d9d9d9; color: #666; font-size: 6pt; }
    td.a { color: #b91c1c; font-weight: 800; background: #fee2e2; }
    td.l { color: #92400e; font-weight: 800; background: #fef3c7; }
    td.t { color: #075985; font-weight: 800; background: #e0f2fe; }
    td.sum { font-weight: 800; background: #f6f7fb; }
    .foot td { font-weight: 800; background: #f1f2f9; }
    .sign { display: flex; justify-content: space-between; gap: 30mm; margin-top: 14mm; font-size: 8pt; }
    .sign div { flex: 1; border-top: 0.25mm solid #555; text-align: center; padding-top: 1mm; }
    .key { margin-top: 2mm; font-size: 7pt; color: #444; }
  `],
  template: `
  <div class="no-print flex flex-wrap items-center gap-4 mb-6">
    <button type="button" class="btn-primary" (click)="print()" [disabled]="!data()"><lucide-icon [img]="printIcon" [size]="16" /> Print register</button>
    <p class="text-sm font-bold text-slate-400">Choose paper A4, Landscape and turn on "Background graphics".</p>
  </div>
  @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (data(); as x) {
    <div class="print-area overflow-x-auto"><div class="sheet w-fit shadow-enterprise print:shadow-none">
      <div class="head">
        <div class="logo">@if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt=""> } @else { <span>{{ settings.initial() }}</span> }</div>
        <div><h1>{{ settings.instituteName() }}</h1>@if (settings.address()) { <p>{{ settings.address() }}</p> }</div>
        <div class="title"><b>Monthly Attendance Register</b>{{ x.section }} · {{ ml(x.month) }} · {{ x.workingDays }} school days</div>
      </div>
      <table>
        <colgroup><col style="width:8mm"><col style="width:40mm">@for (d of x.days; track d.date) { <col style="width:5.1mm"> }<col style="width:8mm"><col style="width:8mm"><col style="width:8mm"><col style="width:8mm"><col style="width:10mm"></colgroup>
        <thead>
          <tr><th rowspan="2">Roll</th><th rowspan="2">Student name</th>@for (d of x.days; track d.date) { <th>{{ d.day }}</th> }<th rowspan="2">P</th><th rowspan="2">A</th><th rowspan="2">L</th><th rowspan="2">T</th><th rowspan="2">%</th></tr>
          <tr>@for (d of x.days; track d.date) { <th>{{ letter(d.dow) }}</th> }</tr>
        </thead>
        <tbody>
          @for (s of x.students; track s.id) {
            <tr>
              <td>{{ s.roll_no ?? '' }}</td><td class="n">{{ s.name }}</td>
              @for (d of x.days; track d.date) {
                @if (!d.working) { <td class="off">{{ d.holiday ? 'H' : '' }}</td> }
                @else { <td [class]="cellCls(s.marks[d.date])">{{ short(s.marks[d.date]) }}</td> }
              }
              <td class="sum">{{ s.stats.present }}</td><td class="sum">{{ s.stats.absent }}</td><td class="sum">{{ s.stats.leave }}</td><td class="sum">{{ s.stats.late }}</td><td class="sum">{{ pt(s.stats.pct) }}</td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr class="foot"><td colspan="2">Present on the day</td>@for (c of dayTotals(); track $index) { <td>{{ c }}</td> }<td colspan="5"></td></tr>
        </tfoot>
      </table>
      <p class="key">P present · A absent · L leave · T late (counted present) · H holiday · grey = Sunday or holiday. Printed {{ d(todayIso) }}.</p>
      <div class="sign"><div>Class teacher</div><div>{{ settings.sign('Vice principal / Principal', 'principal') }}</div></div>
    </div></div>
  }
  `
})
export class AttRegisterPrint {
  private api = inject(Api);
  settings = inject(SettingsService);
  printIcon = Printer; ml = monthLabel; d = fmtDate; pt = pctText; todayIso = today();
  letter = (n: number) => DOW_LETTER[n]; short = (s: string | undefined) => (s ? SHORT[s] : '');
  cellCls = (s: string | undefined) => (s === 'A' ? 'a' : s === 'L' ? 'l' : s === 'LT' ? 't' : '');
  data = signal<MonthData | null>(null); error = signal('');
  dayTotals = computed(() => (this.data()?.days ?? []).map(d => (d.working && !d.future ? this.data()!.students.filter(s => ['P', 'LT'].includes(s.marks[d.date])).length : '')));

  constructor() {
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    this.api.get<MonthData>('/attendance/month', { sectionId: Number(qp.get('sectionId')), month: qp.get('month') ?? today().slice(0, 7) }).subscribe({ next: d => this.data.set(d), error: e => this.error.set(errorText(e)) });
  }
  print() { window.print(); }
}
