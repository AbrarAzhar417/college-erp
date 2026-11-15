import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { CalMonth, Item, PlanFull, fmtDate, monthName, today, weekDates } from './syl';
import { Portion } from './syl-portion';

interface Row { monthSpan: number; monthLabel: string; weekSpan: number; week: number; dates: string; item: Item }

@Component({
  selector: 'app-syl-print',
  imports: [NgTemplateOutlet, LucideAngularModule],
  styles: [`
    * { box-sizing: border-box; }
    .page { width: 285mm; background: #fff; color: #111; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 8pt; letter-spacing: 0; word-spacing: 0; padding: 0 0 2mm; break-after: page; page-break-after: always; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .head { display: flex; align-items: center; gap: 4mm; padding-bottom: 2mm; border-bottom: .5mm solid #1e1b4b; margin-bottom: 2.5mm; }
    .logo { width: 14mm; height: 14mm; flex: none; display: flex; align-items: center; justify-content: center; } .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font-weight: 800; font-size: 15pt; display: flex; align-items: center; justify-content: center; }
    .who h1 { margin: 0; font-size: 13pt; color: #1e1b4b; text-transform: uppercase; } .who p { margin: .5mm 0 0; font-size: 7pt; color: #444; }
    .ttl { margin-left: auto; text-align: right; font-size: 8.5pt; } .ttl b { display: block; font-size: 11.5pt; color: #1e1b4b; }
    table.t { width: 100%; border-collapse: collapse; table-layout: fixed; } table.t th, table.t td { border: .2mm solid #888; padding: 1mm 1.5mm; text-align: center; vertical-align: top; word-wrap: break-word; }
    table.t th { background: #eceef7; color: #1e1b4b; font-size: 7pt; vertical-align: middle; } table.t td.l, table.t th.l { text-align: left; } thead { display: table-header-group; } tr { break-inside: avoid; }
    td.mon { background: #f6f7fb; font-weight: 800; color: #1e1b4b; vertical-align: middle; } .sm { font-size: 6.8pt; color: #555; }
    .meta { width: 100%; border-collapse: collapse; margin-bottom: 2.5mm; } .meta td { border: .2mm solid #999; padding: 1mm 1.8mm; } .meta td.k { background: #f6f7fb; font-weight: 700; width: 12%; font-size: 7.4pt; }
    .note { margin: 1mm 0 2mm; font-size: 8pt; } .note b { color: #1e1b4b; }
    .sign { display: flex; justify-content: space-between; gap: 20mm; margin-top: 12mm; font-size: 8pt; } .sign div { flex: 1; border-top: .25mm solid #555; text-align: center; padding-top: 1mm; }
    .stat { display: inline-block; padding: .3mm 2mm; border: .3mm solid #1e1b4b; border-radius: 1mm; font-size: 7pt; font-weight: 800; margin-left: 2mm; color: #1e1b4b; }
    .months { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; } .months h4 { margin: 0 0 1mm; color: #1e1b4b; font-size: 9pt; } .mb { break-inside: avoid; }
    ul.b { margin: 0; padding-left: 3.5mm; text-align: left; } ul.b li { margin-bottom: .6mm; }
  `],
  template: `
  <div class="no-print flex flex-wrap items-center gap-4 mb-6">
    <button type="button" class="btn-primary" (click)="print()" [disabled]="!ready()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button>
    <p class="text-sm font-bold text-slate-400">Choose paper A4, Landscape and turn on "Background graphics".</p>
  </div>
  @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

  <ng-template #hdr let-title="title" let-sub="sub">
    <div class="head"><div class="logo">@if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt=""> } @else { <span>{{ settings.initial() }}</span> }</div>
      <div class="who"><h1>{{ settings.instituteName() }}</h1>@if (settings.address()) { <p>{{ settings.address() }}</p> }</div><div class="ttl"><b>{{ title }}</b>{{ sub }}</div></div>
  </ng-template>

  <ng-template #planTpl let-p="p" let-month="month">
    <section class="page">
      <ng-container *ngTemplateOutlet="hdr; context: { title: month ? 'Monthly Syllabus Plan' : 'Syllabus Distribution Plan', sub: p.plan.class_name + ' · ' + p.plan.subject + (month ? ' · ' + mn(month) : '') }" />
      <table class="meta"><tr><td class="k">Class</td><td>{{ p.plan.class_name }} (all sections)</td><td class="k">Subject</td><td><b>{{ p.plan.subject }}</b></td><td class="k">Session</td><td>{{ p.plan.session }}</td><td class="k">Status</td><td>{{ p.plan.status === 'approved' ? 'Approved' : p.plan.status === 'submitted' ? 'Waiting approval' : 'Draft' }}</td></tr>
        @if (p.plan.books) { <tr><td class="k">Books</td><td colspan="7">{{ p.plan.books }}</td></tr> }</table>
      @if (p.plan.overview) { <p class="note"><b>Overview:</b> {{ p.plan.overview }}</p> }
      @if (p.plan.assessment) { <p class="note"><b>Assessment:</b> {{ p.plan.assessment }}</p> }
      <table class="t"><colgroup><col style="width:21mm"><col style="width:19mm"><col style="width:60mm"><col style="width:64mm"><col style="width:54mm"><col style="width:45mm"><col style="width:12mm"></colgroup>
        <thead><tr><th>Month</th><th>Week</th><th class="l">Topics and chapters</th><th class="l">Learning outcomes</th><th class="l">Activities and resources</th><th class="l">Assessment</th><th>Periods</th></tr></thead>
        <tbody>@for (r of rows(p, month); track $index) { <tr>
          @if (r.monthSpan) { <td class="mon" [attr.rowspan]="r.monthSpan">{{ r.monthLabel }}</td> }
          @if (r.weekSpan) { <td [attr.rowspan]="r.weekSpan"><b>W{{ r.week }}</b><br><span class="sm">{{ r.dates }}</span></td> }
          <td class="l"><b>{{ r.item.topic }}</b>@if (r.item.chapter) { <br><span class="sm">{{ r.item.chapter }}</span> }</td><td class="l">{{ r.item.outcomes }}</td>
          <td class="l">{{ r.item.activities }}@if (r.item.resources) { <br><span class="sm">{{ r.item.resources }}</span> }</td><td class="l">{{ r.item.assessment }}</td><td>{{ r.item.periods ?? '' }}</td></tr> }</tbody></table>
      <div class="sign"><div>Subject teacher{{ p.plan.author ? ': ' + p.plan.author : '' }}</div><div>Head of department / Vice principal</div><div>Principal{{ p.plan.approver ? ': ' + p.plan.approver : '' }}</div></div>
    </section>
  </ng-template>

  <div class="print-area overflow-x-auto"><div class="w-fit shadow-enterprise print:shadow-none">
  @switch (kind) {
    @case ('plan') { @if (plans()[0]; as p) { <ng-container *ngTemplateOutlet="planTpl; context: { p: p, month: '' }" /> } }
    @case ('month') { @if (plans()[0]; as p) { <ng-container *ngTemplateOutlet="planTpl; context: { p: p, month: monthParam }" /> } }
    @case ('class') { @for (p of plans(); track p.plan.id) { <ng-container *ngTemplateOutlet="planTpl; context: { p: p, month: '' }" /> } }

    @case ('portion') { @if (portion(); as x) {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Test Syllabus', sub: x.exam.name + ' · ' + x.class.name }" />
        <p class="note">Syllabus for the test: topics planned from <b>{{ d(x.from) }}</b> to <b>{{ d(x.to) }}</b>{{ x.previous ? ' (after ' + x.previous.name + ')' : '' }}. Session {{ x.exam.session }}.</p>
        <table class="t"><colgroup><col style="width:9mm"><col style="width:40mm"><col style="width:28mm"><col style="width:20mm"><col></colgroup>
          <thead><tr><th>#</th><th class="l">Subject</th><th>Test date</th><th>Max marks</th><th class="l">Syllabus</th></tr></thead>
          <tbody>@for (s of x.subjects; track s.subject_id; let i = $index) { <tr><td>{{ i + 1 }}</td><td class="l"><b>{{ s.subject }}</b></td><td>{{ s.test_date ? d(s.test_date) : 'To be announced' }}</td><td>{{ s.max_marks ?? '' }}</td>
            <td class="l">@if (s.items.length) { <ul class="b">@for (it of s.items; track $index) { <li><b>{{ it.topic }}</b>@if (it.chapter) { <span class="sm"> ({{ it.chapter }})</span> }</li> }</ul> } @else { <span class="sm">{{ s.plan_id ? 'No topic planned in these dates' : 'Syllabus plan not made yet' }}</span> }</td></tr> }</tbody></table>
        <div class="sign"><div>Exam incharge</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> } }

    @case ('calendar') {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Academic Calendar', sub: 'Session ' + session() }" />
        <div class="months">@for (m of cal(); track m.month) {
          <div class="mb"><h4>{{ m.label }}</h4>
            <table class="t"><colgroup><col style="width:14mm"><col style="width:26mm"><col style="width:11mm"><col></colgroup><thead><tr><th>Week</th><th>Dates</th><th>Days</th><th class="l">Holidays, exams and events</th></tr></thead>
              <tbody>@for (w of m.weeks; track w.week) { <tr><td><b>{{ w.week }}</b></td><td>{{ wd(w) }}</td><td>{{ w.working }}</td><td class="l">
                @for (h of w.holidays; track h.date) { <div>{{ d(h.date).slice(0, 6) }} Holiday: {{ h.name }}</div> }
                @for (e of w.exams; track e.id) { <div><b>Exam: {{ e.name }}</b> ({{ d(e.from).slice(0, 6) }}{{ e.to !== e.from ? ' to ' + d(e.to).slice(0, 6) : '' }})</div> }
                @for (e of w.events; track e.id) { <div>{{ d(e.date).slice(0, 6) }} {{ e.title }}</div> }</td></tr> }</tbody></table></div> }</div>
        <div class="sign"><div>{{ settings.sign('Vice principal', 'vice_principal') }}</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> }
  }
  </div></div>
  `
})
export class SylPrint {
  private api = inject(Api);
  settings = inject(SettingsService);
  printIcon = Printer; d = fmtDate; mn = monthName; wd = weekDates; todayIso = today();
  private route = inject(ActivatedRoute);
  kind = this.route.snapshot.paramMap.get('kind') ?? '';
  monthParam = this.route.snapshot.queryParamMap.get('month') ?? '';
  session = signal(''); plans = signal<PlanFull[]>([]); portion = signal<Portion | null>(null); cal = signal<CalMonth[]>([]); error = signal(''); ready = signal(false);

  constructor() {
    const q = this.route.snapshot.queryParamMap, err = (e: unknown) => { this.error.set(errorText(e)); };
    if (this.kind === 'plan' || this.kind === 'month') this.api.get<PlanFull>(`/syllabus/plans/${q.get('planId')}`).subscribe({ next: p => { this.plans.set([p]); this.ready.set(true); }, error: err });
    else if (this.kind === 'class') {
      this.api.get<{ id: number }[]>('/syllabus/plans', { classId: Number(q.get('classId')) }).subscribe({
        next: async list => { try { this.plans.set(await Promise.all(list.map(p => firstValueFrom(this.api.get<PlanFull>(`/syllabus/plans/${p.id}`))))); this.ready.set(true); } catch (e) { err(e); } }, error: err });
    } else if (this.kind === 'portion') this.api.get<Portion>('/syllabus/portion', { examId: Number(q.get('examId')), classId: Number(q.get('classId')), from: q.get('from') ?? undefined, to: q.get('to') ?? undefined }).subscribe({ next: p => { this.portion.set(p); this.ready.set(true); }, error: err });
    else if (this.kind === 'calendar') { this.api.get<{ session: string }>('/syllabus/config').subscribe(c => this.session.set(c.session)); this.api.get<CalMonth[]>('/syllabus/calendar').subscribe({ next: c => { this.cal.set(c); this.ready.set(true); }, error: err }); }
  }

  /** Rows of the table with the month and the week merged over their topics. */
  rows(p: PlanFull, month: string): Row[] {
    const items = p.items.filter(i => !month || i.month === month), out: Row[] = [];
    items.forEach((it, i) => {
      const firstOfMonth = i === 0 || items[i - 1].month !== it.month, firstOfWeek = firstOfMonth || items[i - 1].week !== it.week;
      const wr = { from: `${it.month}-${['01', '08', '15', '22'][it.week - 1]}`, to: `${it.month}-${it.week < 4 ? ['07', '14', '21'][it.week - 1] : String(new Date(Date.UTC(Number(it.month.slice(0, 4)), Number(it.month.slice(5, 7)), 0)).getUTCDate())}` };
      out.push({ monthSpan: firstOfMonth ? items.filter(x => x.month === it.month).length : 0, monthLabel: monthName(it.month), weekSpan: firstOfWeek ? items.filter(x => x.month === it.month && x.week === it.week).length : 0, week: it.week, dates: this.wd(wr), item: it });
    });
    return out;
  }
  print() { window.print(); }
}
