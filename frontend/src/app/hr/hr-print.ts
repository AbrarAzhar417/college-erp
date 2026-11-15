import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { ATT_SHORT, Candidate, EMP_LABEL, Job, MonthDay, SLIP_STATUS, Slip, Staff, TYPE_LABEL, fmtDate, money, monthLabel, timeText } from './hr';

interface MRow { id: number; emp_no: string; name: string; designation: string | null; marks: Record<string, string>; totals: Record<string, number> }
interface MSheet { iv: Iv; criteria: string[]; max: number; sheets: { member: string; scores: Record<string, number>; total: number; remark: string | null }[] }
interface Iv { id: number; name: string; phone: string | null; job_title: string | null; round: string; date: string; time: string | null; venue: string | null; status: string; score: number | null }

@Component({
  selector: 'app-hr-print',
  imports: [NgTemplateOutlet, LucideAngularModule],
  styles: [`
    * { box-sizing: border-box; }
    .page { width: 285mm; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; padding: 0 0 3mm; break-after: page; }
    .page:last-child { break-after: auto; }
    .head { display: flex; align-items: center; gap: 4mm; padding-bottom: 2mm; border-bottom: .5mm solid #1e1b4b; margin-bottom: 3mm; }
    .logo { width: 14mm; height: 14mm; flex: none; display: flex; align-items: center; justify-content: center; } .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font-weight: 800; font-size: 15pt; display: flex; align-items: center; justify-content: center; }
    .who { flex: 1; } .who h1 { margin: 0; font-size: 14pt; } .who p { margin: 0; font-size: 8pt; color: #444; }
    .ttl { text-align: right; font-size: 8pt; color: #333; } .ttl b { display: block; font-size: 11pt; color: #1e1b4b; }
    table.t { width: 100%; border-collapse: collapse; } .t th, .t td { border: .25mm solid #888; padding: 1.2mm 1.6mm; text-align: left; } .t th { background: #eef; font-size: 7.5pt; } .t .r { text-align: right; } .t .c { text-align: center; }
    .slips { display: flex; flex-wrap: wrap; gap: 6mm; } .slip { width: 137mm; border: .3mm solid #333; padding: 4mm; break-inside: avoid; }
    .slip h2 { margin: 0 0 2mm; font-size: 10pt; text-align: center; } .kv { display: flex; justify-content: space-between; padding: .6mm 0; border-bottom: .15mm dotted #999; } .tot { font-weight: 800; font-size: 10pt; border-top: .4mm solid #111; border-bottom: .4mm solid #111; margin-top: 1.5mm; padding: 1.5mm 0; display: flex; justify-content: space-between; }
    .letter { width: 190mm; margin: 0 auto; font-size: 11pt; line-height: 1.6; } .letter h2 { text-align: center; text-decoration: underline; }
    .pp { width: 190mm; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; break-after: page; } .pp:last-child { break-after: auto; }
    .pp .t th, .pp .t td { padding: 2.2mm 2mm; } .pp .t td.w { height: 11mm; }
    .poster { width: 190mm; min-height: 270mm; display: flex; flex-direction: column; font-family: Arial, Helvetica, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .poster .band { background: #1e1b4b; color: #fff; padding: 9mm 10mm; display: flex; align-items: center; gap: 6mm; }
    .poster .band .logo { width: 24mm; height: 24mm; background: #fff; border-radius: 50%; padding: 2mm; } .poster .band h1 { margin: 0; font-size: 20pt; } .poster .band p { margin: 1mm 0 0; font-size: 9.5pt; opacity: .85; }
    .poster .hire { text-align: center; font-size: 15pt; letter-spacing: .5em; color: #1e1b4b; margin: 12mm 0 3mm; font-weight: 700; }
    .poster h2 { text-align: center; font-size: 30pt; line-height: 1.1; margin: 0 8mm 3mm; color: #111; } .poster .seats { text-align: center; font-size: 13pt; font-weight: 700; color: #b45309; margin-bottom: 8mm; }
    .poster .facts { display: flex; gap: 4mm; margin: 0 10mm 7mm; } .poster .fact { flex: 1; border: .5mm solid #1e1b4b; border-radius: 3mm; padding: 4mm; text-align: center; } .poster .fact b { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .12em; color: #666; margin-bottom: 1.5mm; } .poster .fact span { font-size: 12pt; font-weight: 700; }
    .poster .desc { margin: 0 12mm 6mm; font-size: 11.5pt; line-height: 1.55; white-space: pre-line; }
    .poster .apply { margin: auto 10mm 10mm; background: #eef; border-radius: 4mm; padding: 6mm; text-align: center; font-size: 12pt; line-height: 1.6; } .poster .apply b { color: #1e1b4b; }
    .sign { display: flex; justify-content: space-between; margin-top: 18mm; font-size: 9pt; } .sign div { border-top: .3mm solid #111; padding-top: 1mm; min-width: 50mm; text-align: center; }
    .grid td { width: 4.6mm; padding: .6mm; text-align: center; font-size: 6.5pt; } .off { background: #ececec; } .A { background: #fecaca; font-weight: 700; } .LT { background: #fde68a; } .L { background: #bae6fd; } .HD { background: #ddd6fe; }
  `],
  template: `
  <div class="no-print flex flex-wrap items-center gap-4 mb-6">
    <button type="button" class="btn-primary" (click)="print()" [disabled]="!ready()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button>
    <p class="text-sm font-bold text-slate-400">Choose paper A4 and turn on "Background graphics".</p>
  </div>
  @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

  <ng-template #hdr let-title="title" let-sub="sub">
    <div class="head"><div class="logo">@if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt=""> } @else { <span>{{ settings.initial() }}</span> }</div>
      <div class="who"><h1>{{ settings.instituteName() }}</h1>@if (settings.address()) { <p>{{ settings.address() }}</p> }</div><div class="ttl"><b>{{ title }}</b>{{ sub }}</div></div>
  </ng-template>

  <div class="print-area overflow-x-auto"><div class="w-fit shadow-enterprise print:shadow-none">
  @switch (kind) {
    @case ('staff') { <section class="page"><ng-container *ngTemplateOutlet="hdr; context: { title: 'Staff list', sub: staff().length + ' people' }" />
      <table class="t"><thead><tr><th>No.</th><th>Name</th><th>Father</th><th>Type</th><th>Designation</th><th>CNIC</th><th>Phone</th><th>Joined</th><th>Employment</th></tr></thead>
        <tbody>@for (s of staff(); track s.id) { <tr><td>{{ s.emp_no }}</td><td>{{ s.name }}</td><td>{{ s.father_name }}</td><td>{{ tl[s.staff_type] }}</td><td>{{ s.designation }}</td><td>{{ s.cnic }}</td><td>{{ s.phone }}</td><td>{{ s.joining_date ? d(s.joining_date) : '' }}</td><td>{{ el[s.employment] }}{{ s.status !== 'active' ? ' (' + s.status + ')' : '' }}</td></tr> }</tbody></table></section> }

    @case ('register') { <section class="page"><ng-container *ngTemplateOutlet="hdr; context: { title: 'Staff attendance register', sub: ml(month) }" />
      <table class="t grid"><thead><tr><th style="width:40mm">Name</th>@for (x of days(); track x.date) { <th class="c" [class.off]="!x.working">{{ x.day }}</th> }<th>P</th><th>T</th><th>A</th><th>L</th><th>H</th></tr></thead>
        <tbody>@for (r of rows(); track r.id) { <tr><td style="text-align:left;font-size:7.5pt">{{ r.name }}</td>@for (x of days(); track x.date) { <td [class]="r.marks[x.date] ?? (x.working ? '' : 'off')">{{ r.marks[x.date] ? sh[r.marks[x.date]] : '' }}</td> }
          <td>{{ r.totals['P'] }}</td><td>{{ r.totals['LT'] }}</td><td>{{ r.totals['A'] }}</td><td>{{ r.totals['L'] }}</td><td>{{ r.totals['HD'] }}</td></tr> }</tbody></table>
      <p style="font-size:7pt;margin-top:2mm">P present · T late · A absent · L leave · H half day · grey = off day or holiday</p></section> }

    @case ('sheet') { <section class="page"><ng-container *ngTemplateOutlet="hdr; context: { title: 'Salary sheet', sub: ml(month) }" />
      <table class="t"><thead><tr><th>No.</th><th>Name</th><th>Designation</th><th class="r">Gross</th><th class="r">Cut days</th><th class="r">Cut</th><th class="r">Added</th><th class="r">Advance / loan / other</th><th class="r">Net</th><th>Status</th><th style="width:28mm">Signature</th></tr></thead>
        <tbody>@for (s of slips(); track s.id) { <tr><td>{{ s.emp_no }}</td><td>{{ s.name }}</td><td>{{ s.designation }}</td><td class="r">{{ m(s.gross) }}</td><td class="r">{{ cutDays(s) }}</td><td class="r">{{ m(s.cut_amount) }}</td><td class="r">{{ m(s.bonus + s.overtime + s.arrears) }}</td><td class="r">{{ m(s.fixed_deduction + s.advance + s.loan + s.other_deduction) }}</td><td class="r"><b>{{ m(s.net) }}</b></td><td>{{ ss[s.status] }}</td><td></td></tr> }
          <tr><td colspan="3"><b>Total</b></td><td class="r"><b>{{ m(tot('gross')) }}</b></td><td></td><td class="r"><b>{{ m(tot('cut_amount')) }}</b></td><td></td><td></td><td class="r"><b>{{ m(tot('net')) }}</b></td><td colspan="2"></td></tr></tbody></table>
      <div class="sign"><div>Prepared by</div><div>{{ settings.sign('Accountant', 'accounts_officer') }}</div><div>{{ settings.sign('Principal', 'principal') }}</div></div></section> }

    @case ('slips') { <section class="page"><ng-container *ngTemplateOutlet="hdr; context: { title: 'Payslips', sub: ml(month) }" />
      <div class="slips">@for (s of slips(); track s.id) {
        <div class="slip">@if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt="" style="height:14mm;width:auto;display:block;margin:0 auto 2mm"> }<h2>{{ settings.instituteName() }}<br><small>Payslip · {{ ml(s.month) }}</small></h2>
          <div class="kv"><span>Name</span><b>{{ s.name }} ({{ s.emp_no }})</b></div><div class="kv"><span>Designation</span><span>{{ s.designation }}{{ s.department ? ', ' + s.department : '' }}</span></div>
          <div class="kv"><span>CNIC</span><span>{{ s.cnic }}</span></div>
          <div class="kv"><span>Basic salary</span><span>{{ m(s.basic) }}</span></div><div class="kv"><span>Allowances</span><span>{{ m(s.allowances) }}</span></div><div class="kv"><span>Gross salary</span><b>{{ m(s.gross) }}</b></div>
          @if (s.cut_amount) { <div class="kv"><span>Cut for {{ cutWhy(s) }}</span><span>- {{ m(s.cut_amount) }}</span></div> }
          @if (s.bonus) { <div class="kv"><span>Bonus</span><span>+ {{ m(s.bonus) }}</span></div> } @if (s.overtime) { <div class="kv"><span>Overtime</span><span>+ {{ m(s.overtime) }}</span></div> } @if (s.arrears) { <div class="kv"><span>Arrears</span><span>+ {{ m(s.arrears) }}</span></div> }
          @if (s.fixed_deduction) { <div class="kv"><span>Fixed deduction</span><span>- {{ m(s.fixed_deduction) }}</span></div> } @if (s.advance) { <div class="kv"><span>Advance</span><span>- {{ m(s.advance) }}</span></div> } @if (s.loan) { <div class="kv"><span>Loan instalment</span><span>- {{ m(s.loan) }}</span></div> } @if (s.other_deduction) { <div class="kv"><span>Other deduction</span><span>- {{ m(s.other_deduction) }}</span></div> }
          <div class="tot"><span>Net salary</span><span>Rs {{ m(s.net) }}</span></div>
          <p style="font-size:7.5pt;margin:1.5mm 0 0">School days {{ s.working_days }}. {{ s.status === 'paid' && s.paid_date ? 'Paid on ' + d(s.paid_date) : ss[s.status] }}.</p>
          <div class="sign" style="margin-top:10mm"><div>Employee</div><div>{{ settings.sign('Accountant', 'accounts_officer') }}</div></div></div> }</div></section> }

    @case ('offer') { @if (cand(); as c) { <section class="page"><div class="letter"><ng-container *ngTemplateOutlet="hdr; context: { title: 'Offer letter', sub: today }" />
      <p>Date: {{ today }}</p><p>To,<br><b>{{ c.name }}</b>{{ c.city ? ', ' + c.city : '' }}</p>
      <h2>Offer of appointment: {{ c.offer_designation || job()?.title }}</h2>
      <p>Dear {{ c.name }},</p>
      <p>We are pleased to offer you the post of <b>{{ c.offer_designation || job()?.title }}</b> at {{ settings.instituteName() }} on a <b>{{ el[c.offer_employment || 'permanent'].toLowerCase() }}</b> basis, starting on <b>{{ c.joining_date ? d(c.joining_date) : '' }}</b>.</p>
      <p>Your salary will be <b>Rs {{ m(c.offer_salary ?? 0) }}</b> per month. Salary is paid after the end of each month. Absence without approved leave is cut from the salary.</p>
      <p>Please bring your CNIC, degrees and two photographs on the day you join. If you accept, please sign below and return a copy.</p>
      <p>Welcome to our team.</p>
      <div class="sign"><div>{{ settings.sign('Principal', 'principal') }}<br>{{ settings.instituteName() }}</div><div>Accepted by<br>{{ c.name }}</div></div></div></section> } }

    @case ('job') { @if (job(); as j) { <section class="poster">
      <div class="band">@if (settings.logoUrl()) { <img class="logo" [src]="settings.logoUrl()" alt=""> }<div><h1>{{ settings.instituteName() }}</h1>@if (settings.address()) { <p>{{ settings.address() }}</p> }</div></div>
      <div class="hire">WE ARE HIRING</div>
      <h2>{{ j.title }}</h2>
      <div class="seats">{{ j.positions }} seat{{ j.positions === 1 ? '' : 's' }}{{ j.department ? ' · ' + j.department : '' }}</div>
      <div class="facts">@if (j.qualification) { <div class="fact"><b>Qualification</b><span>{{ j.qualification }}</span></div> }@if (j.experience) { <div class="fact"><b>Experience</b><span>{{ j.experience }}</span></div> }@if (j.salary_range) { <div class="fact"><b>Salary</b><span>{{ j.salary_range }}</span></div> }</div>
      @if (j.description) { <div class="desc">{{ j.description }}</div> }
      <div class="apply"><b>How to apply</b><br>Send your CV{{ settings.email() ? ' to ' + settings.email() : '' }}{{ settings.phone() ? ' or WhatsApp / call ' + settings.phone() : '' }}{{ j.last_date ? ' · Last date: ' + d(j.last_date) : '' }}</div>
    </section> } }

    @case ('marksheet') { @for (m of msheets(); track m.iv.id) { <section class="pp">
      <ng-container *ngTemplateOutlet="hdr; context: { title: 'Interview marks sheet', sub: d(m.iv.date) + (m.iv.time ? ' · ' + tt(m.iv.time) : '') }" />
      <table class="t" style="margin-bottom:4mm"><tr><th style="width:30mm">Candidate</th><td><b>{{ m.iv.name }}</b></td><th style="width:22mm">Post</th><td>{{ m.iv.job_title || '-' }}</td></tr>
        <tr><th>Round</th><td>{{ m.iv.round }}</td><th>Place</th><td>{{ m.iv.venue || '-' }}</td></tr></table>
      <table class="t"><thead><tr><th>Marking point (each out of {{ m.max }})</th>@for (c of cols(m); track $index) { <th style="width:30mm">{{ c.member || 'Member ' + ($index + 1) }}</th> }</tr></thead>
        <tbody>@for (k of m.criteria; track k) { <tr><td class="w">{{ k }}</td>@for (c of cols(m); track $index) { <td class="w">{{ c.scores[k] ?? '' }}</td> }</tr> }
          <tr><td class="w"><b>Total (out of {{ m.max * m.criteria.length }})</b></td>@for (c of cols(m); track $index) { <td class="w"><b>{{ c.member ? c.total : '' }}</b></td> }</tr>
          <tr><td class="w">Remarks</td>@for (c of cols(m); track $index) { <td class="w">{{ c.remark ?? '' }}</td> }</tr></tbody></table>
      <p style="margin-top:6mm">Recommendation: &nbsp; ☐ Select &nbsp;&nbsp; ☐ Keep on hold &nbsp;&nbsp; ☐ Reject @if (m.iv.score !== null) { <span style="float:right"><b>Average: {{ m.iv.score }}%</b></span> }</p>
      <div class="sign"><div>Panel member</div><div>Panel member</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
    </section> } }

    @case ('interviews') { <section class="page"><ng-container *ngTemplateOutlet="hdr; context: { title: 'Interview list', sub: date ? d(date) : 'All days' }" />
      <table class="t"><thead><tr><th>Date</th><th>Time</th><th>Candidate</th><th>Phone</th><th>Post</th><th>Round</th><th>Place</th><th style="width:30mm">Remarks</th></tr></thead>
        <tbody>@for (i of ivs(); track i.id) { <tr><td>{{ d(i.date) }}</td><td>{{ tt(i.time) }}</td><td>{{ i.name }}</td><td>{{ i.phone }}</td><td>{{ i.job_title }}</td><td>{{ i.round }}</td><td>{{ i.venue }}</td><td></td></tr> }</tbody></table></section> }
  }
  </div></div>
  `
})
export class HrPrint {
  private api = inject(Api);
  settings = inject(SettingsService);
  printIcon = Printer;
  private q = inject(ActivatedRoute).snapshot;
  kind = this.q.paramMap.get('kind') ?? '';
  month = this.q.queryParamMap.get('month') ?? new Date().toISOString().slice(0, 7);
  date = this.q.queryParamMap.get('date') ?? '';
  d = fmtDate; m = money; ml = monthLabel; tt = timeText; tl = TYPE_LABEL; el = EMP_LABEL; ss = SLIP_STATUS; sh = ATT_SHORT;
  today = fmtDate(new Date().toISOString().slice(0, 10));
  staff = signal<Staff[]>([]); days = signal<MonthDay[]>([]); rows = signal<MRow[]>([]); slips = signal<Slip[]>([]); cand = signal<Candidate | null>(null); job = signal<Job | null>(null); ivs = signal<Iv[]>([]); msheets = signal<MSheet[]>([]);
  /** Filled sheets, or three empty columns when nobody has marked this candidate yet. */
  cols = (m: MSheet) => (m.sheets.length ? m.sheets : [1, 2, 3].map(() => ({ member: '', scores: {} as Record<string, number>, total: 0, remark: null as string | null })));
  error = signal(''); ready = signal(false);
  constructor() {
    if (['job', 'marksheet', 'offer'].includes(this.kind)) {
      const st = document.createElement('style'); st.textContent = '@page { size: A4 portrait; margin: 8mm; }'; document.head.appendChild(st);
      inject(DestroyRef).onDestroy(() => st.remove());
    }
    const err = (e: unknown) => this.error.set(errorText(e)), ok = () => this.ready.set(true);
    const p = this.q.queryParamMap;
    switch (this.kind) {
      case 'staff': this.api.get<Staff[]>('/hr/staff', { status: p.get('status') ?? 'active' }).subscribe({ next: s => { this.staff.set(s); ok(); }, error: err }); break;
      case 'register': this.api.get<{ days: MonthDay[]; rows: MRow[] }>('/hr/attendance/month', { month: this.month }).subscribe({ next: r => { this.days.set(r.days); this.rows.set(r.rows); ok(); }, error: err }); break;
      case 'sheet': case 'slips':
        if (p.get('self')) this.api.get<{ payslips: Slip[] }>('/hr/me').subscribe({ next: r => { this.slips.set(r.payslips.filter(s => s.month === this.month)); ok(); }, error: err });
        else this.api.get<{ rows: Slip[] }>('/hr/payroll', { month: this.month }).subscribe({ next: r => { const id = Number(p.get('staffId')); this.slips.set(id ? r.rows.filter(s => s.staff_id === id) : r.rows); ok(); }, error: err });
        break;
      case 'offer': this.api.get<{ candidate: Candidate; job: Job | null }>(`/hr/recruit/candidates/${p.get('id')}`).subscribe({ next: r => { this.cand.set(r.candidate); this.job.set(r.job); ok(); }, error: err }); break;
      case 'job': this.api.get<Job[]>('/hr/recruit/jobs').subscribe({ next: r => { this.job.set(r.find(j => j.id === Number(p.get('id'))) ?? null); ok(); }, error: err }); break;
      case 'interviews': this.api.get<Iv[]>('/hr/recruit/interviews', { date: this.date }).subscribe({ next: r => { this.ivs.set(r); ok(); }, error: err }); break;
      case 'marksheet': this.api.get<Iv[]>('/hr/recruit/interviews', { date: p.get('id') ? '' : this.date }).subscribe({
        next: all => {
          const id = Number(p.get('id')), list = id ? all.filter(i => i.id === id) : all.filter(i => i.status !== 'cancelled');
          if (!list.length) { this.error.set('No interviews found for this page.'); return; }
          forkJoin(list.map(iv => this.api.get<{ criteria: string[]; max: number; sheets: MSheet['sheets'] }>(`/hr/recruit/interviews/${iv.id}/marks`))).subscribe({ next: r => { this.msheets.set(r.map((x, i) => ({ iv: list[i], ...x }))); ok(); }, error: err });
        }, error: err });
        break;
      default: this.error.set('Unknown print page.');
    }
  }
  print() { window.print(); }
  tot(k: 'gross' | 'cut_amount' | 'net') { return this.slips().reduce((a, s) => a + s[k], 0); }
  cutDays = (s: Slip) => { const n = s.absent_days + s.unpaid_days + s.notjoined_days + s.late_cut_days; return n || ''; };
  cutWhy = (s: Slip) => [s.absent_days ? s.absent_days + ' absent' : '', s.unpaid_days ? s.unpaid_days + ' unpaid leave' : '', s.late_cut_days ? s.late_count + ' late' : '', s.notjoined_days ? s.notjoined_days + ' days not working' : ''].filter(Boolean).join(', ');
}
