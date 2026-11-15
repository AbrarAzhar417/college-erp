import { NgTemplateOutlet } from '@angular/common';
import { avatarOf } from '../core/avatar';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { initials } from '../hr/hr';
import { SettingsService } from '../core/settings';
import { money } from '../fee/fee';
import { Award, ExamResult, StudentResults, allSubjects, markText, FU_STATUS, Followup, REASON_LABEL, BOARD_STATUS, SheetData, SheetStudent, dayOf, deltaText, fmtDate, ordinal, phones, today } from './exam';
import { AWARD_TYPES } from './exam-awards';

interface Ds { exam: { name: string; session: string }; class: { name: string } | null; rows: { subject: string; test_date: string | null; max_marks: number }[] }
interface BoardRow { id: number; name: string; father_name: string; dob: string | null; roll_no: number | null; class_name: string; section_name: string; category: string | null; p_number: string | null; pct: number | null; result: string; attendance: number | null; dues: number; eligible: boolean; status: string; board_reg_no: string; board_roll_no: string; subjects: string[] }

@Component({
  selector: 'app-exam-print',
  imports: [NgTemplateOutlet, LucideAngularModule],
  styles: [`
    * { box-sizing: border-box; }
    .page { width: 285mm; min-height: 196mm; background: #fff; color: #111; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 8pt; letter-spacing: 0; word-spacing: 0; padding: 0 0 2mm; break-after: page; page-break-after: always; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .head { display: flex; align-items: center; gap: 4mm; padding-bottom: 2mm; border-bottom: 0.5mm solid #1e1b4b; margin-bottom: 2.5mm; }
    .logo { width: 14mm; height: 14mm; flex: none; display: flex; align-items: center; justify-content: center; } .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font-weight: 800; font-size: 15pt; display: flex; align-items: center; justify-content: center; }
    .who h1 { margin: 0; font-size: 13pt; color: #1e1b4b; text-transform: uppercase; } .who p { margin: .5mm 0 0; font-size: 7pt; color: #444; }
    .ttl { margin-left: auto; text-align: right; font-size: 8.5pt; } .ttl b { display: block; font-size: 11.5pt; color: #1e1b4b; }
    table.t { width: 100%; border-collapse: collapse; } table.t th, table.t td { border: .2mm solid #888; padding: .8mm 1.4mm; text-align: center; }
    table.t th { background: #eceef7; color: #1e1b4b; font-size: 7pt; } table.t td.l, table.t th.l { text-align: left; } thead { display: table-header-group; } tr { break-inside: avoid; }
    .fail { color: #b91c1c; font-weight: 800; } .ok { color: #166534; font-weight: 800; } .bad { background: #fee2e2; } .down { background: #fef3c7; }
    .sum { margin-top: 2mm; font-size: 8pt; } .sign { display: flex; justify-content: space-between; gap: 25mm; margin-top: 12mm; font-size: 8pt; } .sign div { flex: 1; border-top: .25mm solid #555; text-align: center; padding-top: 1mm; }
    .key { margin-top: 1.5mm; font-size: 6.8pt; color: #555; }
    /* result card */
    .card { display: grid; grid-template-columns: 1.55fr 1fr; gap: 8mm; }
    .box { border: .3mm solid #1e1b4b; border-radius: 2mm; padding: 3mm; margin-bottom: 3mm; } .box h4 { margin: 0 0 1.5mm; font-size: 8pt; text-transform: uppercase; color: #1e1b4b; letter-spacing: .05em; }
    .big { font-size: 16pt; font-weight: 800; } .res { display: inline-block; padding: 1mm 4mm; border-radius: 1.5mm; font-size: 13pt; font-weight: 800; color: #fff; }
    .info td { border: .2mm solid #999; padding: 1mm 1.6mm; text-align: left; } .info td.k { background: #f6f7fb; font-weight: 700; width: 22%; font-size: 7.4pt; }
    .ph { width: 26mm; height: 32mm; border: .3mm solid #1e1b4b; border-radius: 1.5mm; object-fit: cover; flex: none; display: flex; align-items: center; justify-content: center; background: #f6f7fb; color: #1e1b4b; font-weight: 800; font-size: 14pt; overflow: hidden; } img.ph { display: block; }
    .stu { display: flex; gap: 4mm; align-items: flex-start; margin-bottom: 3mm; } .stu table { flex: 1; }
    .cert .cph { width: 30mm; height: 36mm; object-fit: cover; border: .6mm solid #b8860b; margin: 2mm 0; }
    .cert .mk { border-collapse: collapse; margin: 2mm auto 0; font-family: Arial, sans-serif; font-size: 8pt; } .cert .mk td, .cert .mk th { border: .2mm solid #b8860b; padding: .6mm 2.2mm; }
    /* slips and letters (two per page) */
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0; } .half { padding: 0 5mm; border-right: .3mm dashed #777; min-height: 190mm; } .half:last-child { border-right: 0; }
    .half p { margin: 0 0 2.2mm; line-height: 1.45; font-size: 9pt; } .half h3 { margin: 3mm 0; text-align: center; font-size: 11pt; letter-spacing: .08em; color: #1e1b4b; text-transform: uppercase; }
    ol.ins { margin: 2mm 0 0; padding-left: 4mm; font-size: 7.5pt; line-height: 1.5; }
    /* certificate */
    .cert { width: 285mm; height: 196mm; padding: 6mm; background: #fffdf5; break-after: page; page-break-after: always; font-family: Georgia, 'Times New Roman', serif; color: #1e1b4b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cert:last-child { break-after: auto; page-break-after: auto; }
    .cert .o { height: 100%; border: 2.5mm double #1e1b4b; padding: 3mm; } .cert .i { height: 100%; border: .6mm solid #b8860b; padding: 8mm 14mm; text-align: center; display: flex; flex-direction: column; align-items: center; }
    .cert .lg { width: 24mm; height: 24mm; margin-bottom: 2mm; display: flex; align-items: center; justify-content: center; } .cert .lg img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .cert .lg span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font: 800 24pt Arial; display: flex; align-items: center; justify-content: center; }
    .cert h2 { margin: 0; font-size: 20pt; letter-spacing: .08em; text-transform: uppercase; } .cert h1 { margin: 5mm 0 1mm; font-size: 30pt; letter-spacing: .12em; color: #8a6d1a; text-transform: uppercase; }
    .cert .nm { font-size: 30pt; font-style: italic; border-bottom: .4mm solid #b8860b; padding: 0 12mm 1mm; margin: 4mm 0 2mm; } .cert p { margin: 2mm 0; font-size: 13pt; } .cert .aw { font-size: 21pt; font-weight: bold; color: #8a6d1a; margin: 3mm 0; }
    .cert .sg { margin-top: auto; width: 100%; display: flex; justify-content: space-between; gap: 40mm; font-size: 11pt; } .cert .sg div { flex: 1; border-top: .3mm solid #1e1b4b; padding-top: 1.5mm; }
  `],
  template: `
  <div class="no-print flex flex-wrap items-center gap-4 mb-6">
    <button type="button" class="btn-primary" (click)="print()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button>
    <p class="text-sm font-bold text-slate-400">Choose paper A4, Landscape and turn on "Background graphics".</p>
  </div>
  @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

  <ng-template #hdr let-title="title" let-sub="sub">
    <div class="head">
      <div class="logo">@if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt=""> } @else { <span>{{ settings.initial() }}</span> }</div>
      <div class="who"><h1>{{ settings.instituteName() }}</h1>@if (settings.address()) { <p>{{ settings.address() }}</p> }</div>
      <div class="ttl"><b>{{ title }}</b>{{ sub }}</div>
    </div>
  </ng-template>

  <div class="print-area overflow-x-auto"><div class="w-fit shadow-enterprise print:shadow-none">
  @switch (kind) {

    @case ('sheet') { @if (sheet(); as x) {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Class Result Sheet', sub: x.exam.name + ' · ' + x.section.label }" />
        <table class="t">
          <thead><tr><th>Roll</th><th class="l">Student</th>@for (p of x.papers; track p.paper_id) { <th>{{ p.subject }}<br>/{{ p.max_marks }}</th> }<th>Total</th><th>%</th><th>Grade</th><th>Result</th><th>Rank</th><th>{{ x.prevExam ? x.prevExam.name + ' %' : 'Before' }}</th><th>Change</th></tr></thead>
          <tbody>@for (s of x.students; track s.id) {
            <tr [class]="s.result === 'FAIL' ? 'bad' : s.reason === 'down' ? 'down' : ''"><td>{{ s.roll_no }}</td><td class="l"><b>{{ s.name }}</b></td>
              @for (p of x.papers; track p.paper_id) { @let m = s.marks[p.subject_id]; <td [class]="m?.pass === false ? 'fail' : ''">{{ m?.status === 'A' ? 'A' : m?.status === 'L' ? 'L' : m?.marks ?? '' }}</td> }
              <td><b>{{ s.max ? s.total + '/' + s.max : '' }}</b></td><td><b>{{ s.pct ?? '' }}</b></td><td>{{ s.grade }}</td><td [class]="s.result === 'FAIL' ? 'fail' : s.result === 'PASS' ? 'ok' : ''">{{ s.result === 'PASS' ? 'Pass' : s.result === 'FAIL' ? 'Fail' : 'Pending' }}</td><td>{{ s.rank ?? '' }}</td><td>{{ s.prev?.pct ?? '' }}</td>
              <td [class]="s.trend === 'down' ? 'fail' : s.trend === 'up' ? 'ok' : ''">{{ s.delta === null ? '' : (s.trend === 'up' ? '▲ ' : s.trend === 'down' ? '▼ ' : '= ') + dt(s.delta) }}</td></tr> }</tbody>
        </table>
        <p class="sum"><b>Students {{ x.stats.students }}</b> · Pass {{ x.stats.pass }} · Fail {{ x.stats.fail }} · Pass % {{ x.stats.passPct ?? '-' }} · Average {{ x.stats.avg ?? '-' }}% · Highest {{ x.stats.highest ?? '-' }}% · Lowest {{ x.stats.lowest ?? '-' }}% · Pass marks {{ x.exam.pass_percent }}%</p>
        <p class="key">A absent · L leave · red marks = failed subject · pink row = failed · yellow row = percentage fell by {{ x.dropPct }} points or more. Printed {{ d(todayIso) }}.</p>
        <div class="sign"><div>Class incharge{{ x.section.class_teacher ? ': ' + x.section.class_teacher : '' }}</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> } }

    @case ('cards') { @if (sheet(); as x) { @for (s of cardList(); track s.id) {
      <section class="page card">
        <div>
          <ng-container *ngTemplateOutlet="hdr; context: { title: 'Result Card', sub: x.exam.name + ' · Session ' + x.exam.session }" />
          <div class="stu"><img class="ph" [src]="s.photo || avatar(s.gender)" alt="">
          <table class="info" style="width:100%;border-collapse:collapse"><tr><td class="k">Student</td><td><b>{{ s.name }}</b></td><td class="k">Father</td><td>{{ s.father_name }}</td></tr>
            <tr><td class="k">Class</td><td>{{ x.section.label }}</td><td class="k">Roll no.</td><td>{{ s.roll_no ?? '-' }}</td></tr><tr><td class="k">Admission no.</td><td>{{ s.reg_no }}</td><td class="k">Attendance</td><td>{{ s.attendance === null ? '-' : s.attendance + '%' }}</td></tr></table></div>
          <table class="t"><thead><tr><th class="l">Subject</th><th>Max</th><th>Obtained</th><th>%</th><th>Grade</th><th>Result</th></tr></thead>
            <tbody>@for (p of x.papers; track p.paper_id) { @let m = s.marks[p.subject_id]; <tr><td class="l">{{ p.subject }}</td><td>{{ p.max_marks }}</td><td [class]="m?.pass === false ? 'fail' : ''"><b>{{ m?.status === 'A' ? 'Absent' : m?.status === 'L' ? 'Leave' : m?.marks ?? '-' }}</b></td>
              <td>{{ m?.marks != null ? pc(m.marks, p.max_marks) : '' }}</td><td>{{ m?.marks != null ? grade(pc(m.marks, p.max_marks), x) : '' }}</td><td [class]="m?.pass === false ? 'fail' : m?.pass ? 'ok' : ''">{{ m?.pass === false ? 'Fail' : m?.pass ? 'Pass' : '' }}</td></tr> }
              <tr><td class="l"><b>Total</b></td><td><b>{{ s.max }}</b></td><td><b>{{ s.total }}</b></td><td><b>{{ s.pct ?? '' }}</b></td><td><b>{{ s.grade }}</b></td><td></td></tr></tbody></table>
        </div>
        <div style="padding-top:18mm">
          <div class="box"><h4>Result</h4><span class="res" [style.background]="s.result === 'PASS' ? '#166534' : s.result === 'FAIL' ? '#b91c1c' : '#64748b'">{{ s.result === 'PASS' ? 'PASS' : s.result === 'FAIL' ? 'FAIL' : 'PENDING' }}</span>
            <p style="margin:3mm 0 0"><span class="big">{{ s.pct ?? '-' }}%</span> &nbsp; Grade <b>{{ s.grade ?? '-' }}</b></p><p style="margin:1mm 0 0">Position in section: <b>{{ s.rank ?? '-' }}</b> of {{ x.stats.complete }}</p></div>
          @if (s.prev) { <div class="box"><h4>Compared with {{ x.prevExam?.name }}</h4><p style="margin:0" [class]="s.trend === 'down' ? 'fail' : s.trend === 'up' ? 'ok' : ''">{{ s.prev.pct }}% before, now {{ s.pct }}%: {{ s.trend === 'up' ? 'improved by ' : s.trend === 'down' ? 'fell by ' : 'no change' }}{{ s.trend === 'same' ? '' : abs(s.delta) + ' points' }}</p></div> }
          <div class="box"><h4>Remarks</h4><p style="margin:0">{{ remark(s) }}</p></div>
          <div class="sign" style="margin-top:14mm;gap:6mm"><div>Class teacher</div><div>{{ settings.sign('Principal', 'principal') }}</div><div>Parent</div></div>
        </div>
      </section> } } }

    @case ('progress') { @if (prog(); as x) {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Progress Report', sub: x.session ? 'Session ' + x.session : 'All sessions' }" />
        <div class="stu"><img class="ph" [src]="x.student.photo || avatar(x.student.gender)" alt="">
          <table class="info" style="width:100%;border-collapse:collapse"><tr><td class="k">Student</td><td><b>{{ x.student.name }}</b></td><td class="k">Father</td><td>{{ x.student.father_name }}</td></tr>
            <tr><td class="k">Class</td><td>{{ x.student.class_name }}-{{ x.student.section_name }}</td><td class="k">Roll no.</td><td>{{ x.student.roll_no ?? '-' }}</td></tr>
            <tr><td class="k">Admission no.</td><td>{{ x.student.reg_no }}</td><td class="k">Attendance</td><td>{{ x.attendance === null ? '-' : x.attendance + '%' }}</td></tr></table></div>
        <table class="t"><thead><tr><th class="l">Subject</th>@for (e of x.exams; track e.exam.id) { <th>{{ e.exam.name }}<br>{{ e.exam.start_date ? d(e.exam.start_date) : '' }}</th> }</tr></thead>
          <tbody>@for (sub of progSubjects(); track sub.id) { <tr><td class="l">{{ sub.name }}</td>@for (e of x.exams; track e.exam.id) { <td [class]="e.row.marks[sub.id]?.pass === false ? 'fail' : ''">{{ mt(e, sub.id) }}{{ pmax(e, sub.id) }}</td> }</tr> }
            <tr><td class="l"><b>Total</b></td>@for (e of x.exams; track e.exam.id) { <td><b>{{ e.row.max ? e.row.total + '/' + e.row.max : '-' }}</b></td> }</tr>
            <tr><td class="l"><b>Percentage</b></td>@for (e of x.exams; track e.exam.id) { <td><b>{{ e.row.pct ?? '-' }}</b></td> }</tr>
            <tr><td class="l"><b>Grade</b></td>@for (e of x.exams; track e.exam.id) { <td>{{ e.row.grade ?? '-' }}</td> }</tr>
            <tr><td class="l"><b>Position</b></td>@for (e of x.exams; track e.exam.id) { <td>{{ e.row.rank ? e.row.rank + ' of ' + e.classSize : '-' }}</td> }</tr>
            <tr><td class="l"><b>Section average %</b></td>@for (e of x.exams; track e.exam.id) { <td>{{ e.sectionAvg ?? '-' }}</td> }</tr>
            <tr><td class="l"><b>Result</b></td>@for (e of x.exams; track e.exam.id) { <td [class]="e.row.result === 'FAIL' ? 'fail' : e.row.result === 'PASS' ? 'ok' : ''">{{ e.row.result === 'PASS' ? 'Pass' : e.row.result === 'FAIL' ? 'Fail' : 'Pending' }}</td> }</tr></tbody></table>
        <p class="key">A absent · L leave · red marks = failed subject. Printed {{ d(todayIso) }}.</p>
        <div class="sign"><div>Class teacher</div><div>{{ settings.sign('Principal', 'principal') }}</div><div>Parent</div></div>
      </section> } }

    @case ('slips') { @if (sheet(); as x) { @for (pair of pairs(); track $index) {
      <section class="page two">
        @for (s of pair; track s.id) {
          <div class="half">
            <ng-container *ngTemplateOutlet="hdr; context: { title: 'Roll Number Slip', sub: x.exam.name }" />
            <table class="info" style="width:100%;border-collapse:collapse;margin-bottom:3mm"><tr><td class="k">Student</td><td colspan="3"><b>{{ s.name }}</b></td></tr><tr><td class="k">Father</td><td colspan="3">{{ s.father_name }}</td></tr>
              <tr><td class="k">Class</td><td>{{ x.section.label }}</td><td class="k">Roll no.</td><td><b>{{ s.roll_no ?? '-' }}</b></td></tr><tr><td class="k">Admission no.</td><td colspan="3">{{ s.reg_no }}</td></tr></table>
            <table class="t"><thead><tr><th class="l">Subject</th><th>Date</th><th>Day</th><th>Max</th></tr></thead><tbody>@for (p of dated(x); track p.paper_id) { <tr><td class="l">{{ p.subject }}</td><td>{{ p.test_date ? d(p.test_date) : '' }}</td><td>{{ day(p.test_date) }}</td><td>{{ p.max_marks }}</td></tr> }</tbody></table>
            <ol class="ins"><li>Bring this slip to every paper.</li><li>Reach the room 10 minutes before the paper starts.</li><li>Mobile phones are not allowed in the exam room.</li></ol>
            <div class="sign"><div>Class incharge</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
          </div> }
      </section> } } }

    @case ('datesheet') { @if (ds(); as x) {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Date Sheet', sub: x.exam.name + (x.class ? ' · ' + x.class.name : '') }" />
        <table class="t" style="max-width:190mm"><thead><tr><th>#</th><th class="l">Date</th><th>Day</th><th class="l">Subject</th><th>Max marks</th></tr></thead>
          <tbody>@for (r of x.rows; track r.subject; let i = $index) { <tr><td>{{ i + 1 }}</td><td class="l">{{ r.test_date ? d(r.test_date) : 'To be announced' }}</td><td>{{ day(r.test_date) }}</td><td class="l"><b>{{ r.subject }}</b></td><td>{{ r.max_marks }}</td></tr> }</tbody></table>
        <div class="sign" style="max-width:190mm"><div>Exam incharge</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> } }

    @case ('calls') {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Parent Call (GR) List', sub: 'Printed ' + d(todayIso) }" />
        <table class="t"><thead><tr><th>#</th><th class="l">Student</th><th>Class</th><th>Category / P no.</th><th class="l">Phone numbers</th><th class="l">Reason</th><th>Result</th><th class="l">Meeting place</th><th>Status</th><th style="width:45mm">Call done / what parent said</th></tr></thead>
          <tbody>@for (f of fu(); track f.id; let i = $index) { <tr style="height:9mm"><td>{{ i + 1 }}</td><td class="l"><b>{{ f.name }}</b><br>S/O {{ f.father_name }}</td><td>{{ f.class_name }}-{{ f.section_name }}<br>Roll {{ f.roll_no ?? '-' }}</td><td>{{ f.category ?? '-' }}{{ f.p_number ? ' · ' + f.p_number : '' }}</td><td class="l">{{ ph(f).join(', ') }}</td>
            <td class="l">{{ rl(f.reason) }}{{ f.failed ? ': ' + f.failed : '' }}</td><td>{{ f.pct ?? '-' }}%{{ f.prev_pct !== null ? ' (was ' + f.prev_pct + '%)' : '' }}</td><td class="l">{{ f.venue }}{{ f.ptm_date ? ' · ' + d(f.ptm_date) : '' }}</td><td>{{ fs(f.status) }}</td><td></td></tr> }</tbody></table>
      </section> }

    @case ('letters') { @for (pair of fpairs(); track $index) {
      <section class="page two">
        @for (f of pair; track f.id) {
          <div class="half">
            <ng-container *ngTemplateOutlet="hdr; context: { title: 'Parent Meeting Notice', sub: d(todayIso) }" />
            <p><b>To the Parent / Guardian of {{ f.name }}</b><br>S/O {{ f.father_name }}, {{ f.class_name }}-{{ f.section_name }}, Roll no. {{ f.roll_no ?? '-' }}, Admission no. {{ f.reg_no }}{{ f.p_number ? ', P number ' + f.p_number : '' }}</p>
            <h3>Subject: progress in {{ f.exam_name }}</h3>
            <p>Dear Parent,</p>
            <p>{{ body(f) }}</p>
            <p>You are requested to meet the class incharge at <b>{{ f.venue || '____________________' }}</b> on <b>{{ f.ptm_date ? d(f.ptm_date) + ' (' + day(f.ptm_date) + ')' : '____________________' }}</b> at ____________ to discuss how we can help your child do better.</p>
            <p>Thank you for your cooperation.</p>
            <div class="sign"><div>Class incharge</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
          </div> }
      </section> } }

    @case ('certificates') { @for (a of awards(); track $index) {
      <section class="cert"><div class="o"><div class="i">
        <div class="lg">@if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt=""> } @else { <span>{{ settings.initial() }}</span> }</div>
        <h2>{{ settings.instituteName() }}</h2><h1>Certificate of Merit</h1>
        <p>This certificate is proudly presented to</p><img class="cph" [src]="a.photo || avatar(a.gender)" alt=""><div class="nm">{{ a.name }}</div>
        <p>S/O {{ a.father_name }} · {{ a.class_name }}-{{ a.section_name }}{{ a.roll_no ? ' · Roll no. ' + a.roll_no : '' }}</p>
        <p>for securing</p><div class="aw">{{ a.title }}</div><p>in {{ a.exam }}</p><p style="font-size:11pt">{{ a.detail }}</p>
        @if (a.subjects?.length) { <table class="mk"><tr>@for (m of a.subjects; track m.subject) { <th>{{ m.subject }}</th> }</tr><tr>@for (m of a.subjects; track m.subject) { <td>{{ m.status === 'A' ? 'A' : m.status === 'L' ? 'L' : m.marks ?? '-' }}/{{ m.max }}</td> }</tr></table> }
        <div class="sg"><div>Class incharge</div><div>Date: {{ d(todayIso) }}</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </div></div></section> } }

    @case ('honour') {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Honour Roll', sub: awardsExam() }" />
        @for (g of groups(); track g.type) {
          <h4 style="margin:4mm 0 1.5mm;color:#1e1b4b">{{ typeLabel(g.type) }}</h4>
          <table class="t"><tbody>@for (a of g.items; track $index) { <tr><td class="l" style="width:62mm"><b>{{ a.title }}</b></td><td class="l">{{ a.name }}, S/O {{ a.father_name }}</td><td>{{ a.class_name }}-{{ a.section_name }}</td><td>Roll {{ a.roll_no ?? '-' }}</td><td class="l">{{ a.detail }}</td></tr> }</tbody></table> }
      </section> }

    @case ('board') {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Board Admission List', sub: 'Printed ' + d(todayIso) }" />
        <table class="t"><thead><tr><th>#</th><th class="l">Student</th><th class="l">Father</th><th>Date of birth</th><th>Class</th><th>College roll</th><th class="l">Subjects</th><th>Board reg no.</th><th>Board roll no.</th><th>Status</th></tr></thead>
          <tbody>@for (r of board(); track r.id; let i = $index) { <tr><td>{{ i + 1 }}</td><td class="l"><b>{{ r.name }}</b></td><td class="l">{{ r.father_name }}</td><td>{{ r.dob ? d(r.dob) : '' }}</td><td>{{ r.class_name }}-{{ r.section_name }}</td><td>{{ r.roll_no ?? '' }}</td><td class="l" style="font-size:6.5pt">{{ r.subjects.join(', ') }}</td><td>{{ r.board_reg_no }}</td><td>{{ r.board_roll_no }}</td><td>{{ bs(r.status) }}</td></tr> }</tbody></table>
        <p class="sum">{{ board().length }} students. Checked: exam result, attendance and fee dues.</p>
        <div class="sign"><div>Exam incharge</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> }
  }
  </div></div>
  `
})
export class ExamPrint {
  private api = inject(Api);
  settings = inject(SettingsService);
  printIcon = Printer; d = fmtDate; dt = deltaText; day = dayOf; ph = phones; todayIso = today(); abs = (n: number | null) => Math.abs(n ?? 0);
  rl = (k: string) => REASON_LABEL[k] ?? k; fs = (k: string) => FU_STATUS[k]; bs = (k: string) => BOARD_STATUS[k]; typeLabel = (t: string) => AWARD_TYPES[t] ?? t;
  kind = inject(ActivatedRoute).snapshot.paramMap.get('kind') ?? '';
  avatar = avatarOf; ini = initials; mt = markText;
  pmax = (e: ExamResult, id: number) => { const p = e.papers.find(x => x.subject_id === id); return p ? ' / ' + p.max_marks : ''; };
  prog = signal<StudentResults | null>(null);
  progSubjects = computed(() => allSubjects(this.prog()?.exams ?? []));
  private only = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('studentId')) || 0;
  cardList = computed(() => { const l = this.sheet()?.students ?? []; return this.only ? l.filter(x => x.id === this.only) : l; });
  sheet = signal<SheetData | null>(null); ds = signal<Ds | null>(null); fu = signal<Followup[]>([]); awards = signal<Award[]>([]); awardsExam = signal(''); board = signal<BoardRow[]>([]); error = signal('');
  pairs = computed(() => this.chunk(this.sheet()?.students ?? []));
  fpairs = computed(() => this.chunk(this.fu()));
  groups = computed(() => Object.keys(AWARD_TYPES).filter(t => this.awards().some(a => a.type === t)).map(type => ({ type, items: this.awards().filter(a => a.type === type) })));

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap, k = this.kind, err = (e: unknown) => this.error.set(errorText(e));
    if (k === 'progress') this.api.get<StudentResults>(`/exam/students/${q.get('studentId')}/results`, { session: q.get('session') ?? undefined }).subscribe({ next: r => this.prog.set(r), error: err });
    else if (['sheet', 'cards', 'slips'].includes(k)) this.api.get<SheetData>(`/exam/exams/${q.get('examId')}/sheet`, { sectionId: Number(q.get('sectionId')), photos: k === 'cards' ? 1 : undefined }).subscribe({ next: s => this.sheet.set(s), error: err });
    else if (k === 'datesheet') this.api.get<Ds>(`/exam/exams/${q.get('examId')}/datesheet`, { classId: Number(q.get('classId')) }).subscribe({ next: s => this.ds.set(s), error: err });
    else if (k === 'calls' || k === 'letters') {
      const ids = (q.get('ids') ?? '').split(',').filter(Boolean).map(Number);
      this.api.get<Followup[]>('/exam/followups', { examId: Number(q.get('examId')) || undefined, classId: Number(q.get('classId')) || undefined, sectionId: Number(q.get('sectionId')) || undefined, status: q.get('status') ?? undefined, category: q.get('category') ?? undefined })
        .subscribe({ next: r => this.fu.set(ids.length ? r.filter(f => ids.includes(f.id)) : r), error: err });
    } else if (k === 'certificates' || k === 'honour') {
      const types = (q.get('types') ?? '').split(',').filter(Boolean);
      this.api.get<{ exam: string; entries: Award[] }>('/exam/awards', { photos: k === 'certificates' ? 1 : undefined, examIds: q.get('examIds') ?? undefined, classId: Number(q.get('classId')) || undefined, sectionId: Number(q.get('sectionId')) || undefined })
        .subscribe({ next: r => { this.awards.set(types.length ? r.entries.filter(e => types.includes(e.type)) : r.entries); this.awardsExam.set(r.exam); }, error: err });
    } else if (k === 'board') {
      this.api.get<{ rows: BoardRow[] }>('/exam/board', { examId: Number(q.get('examId')) || undefined, classId: Number(q.get('classId')) || undefined })
        .subscribe({ next: r => this.board.set(q.get('only') === 'eligible' ? r.rows.filter(x => x.eligible) : r.rows), error: err });
    }
  }
  private chunk<T>(a: T[]): T[][] { const out: T[][] = []; for (let i = 0; i < a.length; i += 2) out.push(a.slice(i, i + 2)); return out; }
  print() { window.print(); }
  pc(marks: number | null | undefined, max: number) { return max && marks != null ? Math.round((marks / max) * 1000) / 10 : 0; }
  grade(p: number, x: SheetData) { return (x.scale.find(g => p >= g.min) ?? x.scale[x.scale.length - 1])?.grade ?? ''; }
  dated(x: SheetData) { return [...x.papers].sort((a, b) => (a.test_date ?? '9999').localeCompare(b.test_date ?? '9999') || a.subject.localeCompare(b.subject)); }
  body(f: Followup) {
    let t = `Your child obtained ${f.pct ?? '-'}% in ${f.exam_name}`;
    if (f.failed && f.reason !== 'down') t += ` and did not pass in ${f.failed}`;
    t += '.';
    if (f.prev_pct !== null && f.reason !== 'fail') t += ` This is lower than the previous result of ${f.prev_pct}%.`;
    return t;
  }
  remark(s: SheetStudent) {
    if (s.result === 'INCOMPLETE') return 'Result is not complete yet.';
    const base = s.result === 'PASS' ? 'Passed in all subjects.' : `Did not pass in ${s.failed.join(', ') || 'the exam'}. Parents are requested to meet the class incharge.`;
    return s.trend === 'down' ? `${base} The percentage has fallen, so more attention is needed.` : s.trend === 'up' ? `${base} Good improvement, keep it up.` : base;
  }
}
