import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { ClassReport, StudentReport } from './ptm-types';

/** Two printouts: one A4 sheet per parent (result, progress, attendance, space for notes), and one class report for the staff room. */
@Component({
  selector: 'app-ptm-print',
  imports: [LucideAngularModule],
  styles: [`
    @media print { @page { size: A4 portrait; margin: 10mm; } .sheet { break-after: page; box-shadow: none !important; margin: 0 !important; } .sheet:last-child { break-after: auto; } }
    .sheet { max-width: 190mm; margin: 0 auto 8mm; background: #fff; color: #111; padding: 8mm; font-size: 10.5pt; box-shadow: 0 1px 6px #0003; }
    h1 { font-size: 15pt; margin: 0; } h2 { font-size: 11pt; margin: 4mm 0 1.5mm; text-transform: uppercase; letter-spacing: .05em; }
    .sub { color: #555; margin: 0 0 3mm; } table { width: 100%; border-collapse: collapse; } th, td { border: .25mm solid #888; padding: 1mm 2mm; text-align: left; } th { background: #eee; }
    .bad { color: #b00; font-weight: 700; } .ok { color: #070; } .grid { display: flex; gap: 3mm; } .box { border: .25mm solid #888; padding: 2mm 3mm; flex: 1; } .big { font-size: 15pt; font-weight: 800; }
    .lines div { border-bottom: .25mm solid #999; height: 7mm; } .sign { display: flex; justify-content: space-between; margin-top: 10mm; font-size: 9pt; } .sign div { border-top: .3mm solid #000; padding-top: 1mm; width: 55mm; text-align: center; }
    .bar { display: inline-block; height: 3mm; background: #555; vertical-align: middle; }
  `],
  template: `
  <div class="no-print flex gap-3 mb-4"><button type="button" class="btn-primary inline-flex items-center gap-2" (click)="print()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button></div>
  @if (error()) { <p role="alert" class="text-rose-600 font-bold">{{ error() }}</p> }

  @if (cls(); as c) {
    <section class="sheet">
      @if (cfg.logoUrl()) { <img [src]="cfg.logoUrl()" alt="" style="height:14mm;width:auto;display:block;margin:0 auto 2mm"> }
      <h1>{{ cfg.instituteName() }}</h1><p class="sub">{{ c.meeting.title }} · Class report {{ c.section.label }} · {{ c.meeting.date }}{{ c.section.class_teacher ? ' · Class teacher ' + c.section.class_teacher : '' }}</p>
      <div class="grid">
        @if (c.result) { <div class="box"><div class="big">{{ c.result.passPct ?? '-' }}%</div>passed ({{ c.result.pass }} of {{ c.result.complete }})</div><div class="box"><div class="big">{{ c.result.avg ?? '-' }}%</div>class average</div><div class="box"><div class="big">{{ c.result.highest ?? '-' }} / {{ c.result.lowest ?? '-' }}</div>highest / lowest %</div> }
        <div class="box"><div class="big">{{ c.attendance.avgPct ?? '-' }}%</div>average attendance</div><div class="box"><div class="big">{{ c.attendance.lowCount }}</div>below {{ c.attendance.lowLimit }}%</div>
      </div>
      @if (c.result) {
        <h2>Subjects ({{ c.exam?.name }})</h2>
        <table><thead><tr><th scope="col">Subject</th><th scope="col">Teacher</th><th scope="col">Average %</th><th scope="col">Highest</th><th scope="col">Passed %</th><th scope="col">Failed</th></tr></thead>
          <tbody>@for (s of c.result.subjects; track s.subject) { <tr><td>{{ s.subject }}</td><td>{{ s.teacher ?? '-' }}</td><td>{{ s.avgPct ?? '-' }}</td><td>{{ s.highest ?? '-' }}</td><td>{{ s.passPct ?? '-' }}</td><td [class.bad]="s.failed > 0">{{ s.failed }}</td></tr> }</tbody></table>
        @if (c.result.top.length) { <p><strong>Top:</strong> @for (t of c.result.top; track t.rank) { <span>{{ t.rank }}. {{ t.name }} ({{ t.pct }}%)&nbsp; </span> }</p> }
      }
      <h2>Students</h2>
      <table><thead><tr><th scope="col">Time</th><th scope="col">Roll</th><th scope="col">Name</th><th scope="col">Father</th>@if (c.result) { <th scope="col">%</th><th scope="col">Pos</th><th scope="col">Result</th> }<th scope="col">Att %</th><th scope="col">Absent</th><th scope="col">Met</th></tr></thead>
        <tbody>@for (s of c.students; track s.student_id) { <tr><td>{{ s.time }}</td><td>{{ s.roll_no ?? '' }}</td><td>{{ s.name }}</td><td>{{ s.father_name }}</td>@if (c.result) { <td>{{ s.pct ?? '-' }}</td><td>{{ s.rank ?? '-' }}</td><td [class.bad]="s.result === 'FAIL'">{{ s.result === 'INCOMPLETE' ? 'Incomplete' : s.result ?? '-' }}</td> }<td [class.bad]="s.lowAtt">{{ s.att_pct ?? '-' }}</td><td>{{ s.absent }}</td><td>{{ s.status === 'attended' ? 'Yes' : s.status === 'no_show' ? 'No' : '' }}</td></tr> }</tbody></table>
    </section>
  }

  @for (r of students(); track r.student.id) {
    <section class="sheet">
      @if (cfg.logoUrl()) { <img [src]="cfg.logoUrl()" alt="" style="height:14mm;width:auto;display:block;margin:0 auto 2mm"> }
      <h1>{{ cfg.instituteName() }}</h1>
      <p class="sub">{{ r.meeting.title }} · {{ r.meeting.date }}{{ r.meeting.venue ? ' · ' + r.meeting.venue : '' }} · Your time: <strong>{{ r.slot.time }}</strong></p>
      <div class="grid"><div class="box"><strong>{{ r.student.name }}</strong><br>S/D of {{ r.student.father_name }}<br>Class {{ r.student.section }} · Roll {{ r.student.roll_no ?? '-' }} · Reg {{ r.student.reg_no }}</div>
        @if (r.result) { <div class="box"><div class="big">{{ r.result.result === 'INCOMPLETE' ? 'Incomplete' : r.result.pct + '%' }}</div>{{ r.exam?.name }} · Grade {{ r.result.grade ?? '-' }}{{ r.result.rank ? ' · Position ' + r.result.rank + ' of ' + r.result.students : '' }}</div> }
        <div class="box"><div class="big" [class.bad]="r.attendance.low">{{ r.attendance.pct ?? '-' }}%</div>attendance ({{ r.attendance.absent }} absent, {{ r.attendance.late }} late)</div></div>

      @if (r.points.length) { <h2>Points to talk about</h2><ul style="margin:0;padding-left:5mm">@for (p of r.points; track p.text) { <li [class]="p.kind === 'good' ? 'ok' : 'bad'">{{ p.text }}</li> }</ul> }

      @if (r.result) {
        <h2>Result</h2>
        <table><thead><tr><th scope="col">Subject</th><th scope="col">Marks</th><th scope="col">%</th><th scope="col">Class average %</th><th scope="col">Highest</th></tr></thead>
          <tbody>@for (x of r.result.subjects; track x.subject) { <tr [class.bad]="x.pass === false"><td>{{ x.subject }}</td><td>{{ x.status === 'A' ? 'Absent' : x.status === 'L' ? 'Leave' : x.marks === null ? '-' : x.marks + ' / ' + x.max }}</td><td>{{ x.pct ?? '-' }}</td><td>{{ x.classAvg ?? '-' }}</td><td>{{ x.highest ?? '-' }}</td></tr> }
            <tr><th scope="row">Total</th><th>{{ r.result.total }} / {{ r.result.max }}</th><th>{{ r.result.pct ?? '-' }}</th><th>{{ r.result.classAvg ?? '-' }}</th><th>{{ r.result.classHighest ?? '-' }}</th></tr></tbody></table>
        @if (r.exam && r.exam.status !== 'published') { <p class="sub">Result is not published yet; it may still change.</p> }
      }
      @if (r.history.length > 1) {
        <h2>Progress this session</h2>
        <table><thead><tr><th scope="col">Exam</th><th scope="col">%</th><th scope="col">Position</th><th scope="col"></th></tr></thead>
          <tbody>@for (h of r.history; track h.exam) { <tr><td>{{ h.exam }}</td><td>{{ h.pct }}</td><td>{{ h.rank ?? '-' }}</td><td style="width:60mm"><span class="bar" [style.width.mm]="h.pct * 0.55"></span></td></tr> }</tbody></table>
      }
      <h2>Attendance {{ r.meeting.att_from }} to {{ r.meeting.att_to }}</h2>
      @if (r.attendance.months.length) {
        <table><thead><tr><th scope="col">Month</th><th scope="col">Days recorded</th><th scope="col">Absent</th><th scope="col">Attendance %</th></tr></thead>
          <tbody>@for (mo of r.attendance.months; track mo.month) { <tr><td>{{ mo.month }}</td><td>{{ mo.recorded }}</td><td>{{ mo.absent }}</td><td>{{ mo.pct ?? '-' }}</td></tr> }</tbody></table>
        @if (r.attendance.absentDates.length) { <p class="sub">Absent on: {{ r.attendance.absentDates.join(', ') }}</p> }
      } @else { <p class="sub">No attendance recorded for this period.</p> }
      @if (r.notes.length) { <h2>Teacher notes</h2><ul style="margin:0;padding-left:5mm">@for (n of r.notes; track $index) { <li>{{ n.date }} · {{ n.kind.replace('_', ' ') }}: {{ n.note }}</li> }</ul> }

      <h2>Meeting notes</h2><div class="lines"><div></div><div></div><div></div></div>
      <div class="sign"><div>Class teacher</div><div>Parent / guardian signature</div></div>
    </section>
  }
  `
})
export class PtmPrint {
  private api = inject(Api); cfg = inject(SettingsService); printIcon = Printer;
  cls = signal<ClassReport | null>(null); students = signal<StudentReport[]>([]); error = signal('');
  constructor() {
    const route = inject(ActivatedRoute), id = Number(route.snapshot.paramMap.get('id')), q = route.snapshot.queryParamMap, sec = Number(q.get('section_id')), stu = Number(q.get('student_id')) || 0;
    const fail = (e: unknown) => this.error.set(errorText(e));
    if (q.get('mode') === 'class') this.api.get<ClassReport>(`/ptm/${id}/sections/${sec}/report`).subscribe({ next: r => this.cls.set(r), error: fail });
    else if (stu) this.api.get<StudentReport>(`/ptm/${id}/students/${stu}/report`).subscribe({ next: r => this.students.set([r]), error: fail });
    else this.api.get<StudentReport[]>(`/ptm/${id}/sections/${sec}/student-reports`).subscribe({ next: r => this.students.set(r), error: fail });
  }
  print() { window.print(); }
}
