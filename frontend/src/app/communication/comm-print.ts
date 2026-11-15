import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { KIND_LABEL, Notice, niceDate } from './comm-types';

/** One official page with letterhead, reference number and signature, to print, copy to each class, or pin up. */
@Component({
  selector: 'app-comm-print',
  imports: [LucideAngularModule],
  styles: [`
    @media print { @page { size: A4 portrait; margin: 14mm; } .page { box-shadow: none !important; margin: 0 !important; } }
    .page { max-width: 190mm; margin: 0 auto; background: #fff; color: #111; padding: 12mm; font-size: 11.5pt; line-height: 1.5; box-shadow: 0 1px 6px #0003; min-height: 250mm; }
    .head { text-align: center; border-bottom: .6mm solid #111; padding-bottom: 3mm; margin-bottom: 4mm; } .head h1 { margin: 0; font-size: 18pt; letter-spacing: .03em; } .head p { margin: 0; font-size: 9.5pt; color: #444; }
    .meta { display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 4mm; } .kind { text-align: center; font-weight: 800; text-transform: uppercase; letter-spacing: .15em; font-size: 10pt; margin: 2mm 0; }
    h2 { font-size: 13pt; text-align: center; text-decoration: underline; margin: 2mm 0 5mm; } table { width: 100%; border-collapse: collapse; margin: 3mm 0; } th, td { border: .25mm solid #666; padding: 1.2mm 2.5mm; text-align: left; font-size: 10.5pt; } th { background: #eee; }
    .urgent { color: #b00; font-weight: 800; text-align: center; letter-spacing: .1em; } .line { margin: 0; min-height: 1.5em; text-align: start; } .line:lang(ur), .page { font-family: 'Segoe UI', Arial, 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', 'Alvi Nastaleeq', 'Noto Naskh Arabic', Tahoma, sans-serif; } .sign { margin-top: 22mm; text-align: right; } .sign div { display: inline-block; border-top: .3mm solid #000; padding-top: 1mm; min-width: 55mm; text-align: center; }
    .foot { margin-top: 10mm; font-size: 9pt; color: #555; }
  `],
  template: `
  <div class="no-print flex gap-3 mb-4"><button type="button" class="btn-primary inline-flex items-center gap-2" (click)="print()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button></div>
  @if (error()) { <p role="alert" class="text-rose-600 font-bold">{{ error() }}</p> }
  @if (n(); as x) {
    <section class="page">
      <div class="head">@if (cfg.logoUrl()) { <img [src]="cfg.logoUrl()" alt="" style="height:14mm;width:auto;display:block;margin:0 auto 2mm"> }<h1>{{ cfg.instituteName() }}</h1>@if (cfg.shortName()) { <p>({{ cfg.shortName() }})</p> }@if (cfg.address() || cfg.phone()) { <p>{{ cfg.address() }}{{ cfg.address() && cfg.phone() ? ' · ' : '' }}{{ cfg.phone() }}</p> }</div>
      <div class="meta"><span>Ref: <strong>{{ x.ref_no }}</strong></span><span>Date: <strong>{{ nice(x.issue_date) }}</strong></span></div>
      @if (x.status === 'withdrawn') { <p class="urgent">WITHDRAWN</p> }
      @if (x.priority === 'urgent') { <p class="urgent">URGENT</p> }
      <div class="kind">{{ label[x.kind] }}</div>
      <h2 dir="auto">{{ x.title }}</h2>
      @if (x.kind === 'meeting') {
        <p>@if (x.data.meeting_date) { <span>Date: <strong>{{ nice(x.data.meeting_date ?? '') }}</strong>&nbsp; </span> }@if (x.data.time) { <span>Time: <strong>{{ x.data.time }}</strong>&nbsp; </span> }@if (x.data.venue) { <span>Venue: <strong>{{ x.data.venue }}</strong></span> }</p>
        @if (x.data.attendees) { <p>Present: {{ x.data.attendees }}</p> }
        <table><thead><tr><th scope="col" style="width:8mm">#</th><th scope="col">Point / decision</th><th scope="col">Responsible</th><th scope="col">By</th></tr></thead>
          <tbody>@for (p of x.data.points ?? []; track $index; let i = $index) { <tr><td>{{ i + 1 }}</td><td>{{ p.text }}</td><td>{{ p.assignee }}</td><td>{{ p.due ? nice(p.due) : '' }}</td></tr> }</tbody></table>
      }
      @if (x.kind === 'datesheet') {
        @if (x.data.exam_name) { <p style="text-align:center"><strong>{{ x.data.exam_name }}</strong></p> }
        <table><thead><tr><th scope="col">Class</th><th scope="col">Date</th><th scope="col">Subject</th><th scope="col">Time</th></tr></thead>
          <tbody>@for (r of x.data.rows ?? []; track $index) { <tr><td>{{ r.class_label }}</td><td>{{ nice(r.date) }}{{ r.day ? ' (' + r.day + ')' : '' }}</td><td>{{ r.subject }}</td><td>{{ r.time }}</td></tr> }</tbody></table>
      }
      @if (x.kind === 'result' && (x.data.lines ?? []).length) {
        @if (x.data.exam_name) { <p style="text-align:center"><strong>{{ x.data.exam_name }}</strong></p> }
        <table><thead><tr><th scope="col">Class</th><th scope="col">Passed %</th><th scope="col">Average %</th><th scope="col">Top student</th></tr></thead>
          <tbody>@for (l of x.data.lines ?? []; track $index) { <tr><td>{{ l.class_label }}</td><td>{{ l.pass_pct ?? '-' }}</td><td>{{ l.avg ?? '-' }}</td><td>{{ l.top }}</td></tr> }</tbody></table>
      }
      @if (x.body) { @for (l of lines(x.body); track $index) { <p class="line" dir="auto">{{ l }}</p> } }
      <div class="sign"><div>{{ x.signed_by }}</div></div>
      <p class="foot">Copy to: {{ copyTo(x) }}</p>
    </section>
  }
  `
})
export class CommPrint {
  private api = inject(Api); cfg = inject(SettingsService); printIcon = Printer; nice = niceDate; label = KIND_LABEL;
  lines = (t: string) => t.split(/\r?\n/);
  n = signal<Notice | null>(null); error = signal('');
  constructor() {
    const id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
    this.api.get<Notice>(`/communication/${id}`).subscribe({ next: r => this.n.set(r), error: e => this.error.set(errorText(e)) });
  }
  copyTo(n: Notice) { return n.audience === 'parents' ? 'Parents / guardians of the students concerned; Office file' : n.audience === 'teachers' ? 'All teachers; Office file' : n.audience === 'all' ? 'All staff; Parents / guardians; Office file' : 'All staff; Office file'; }
  print() { window.print(); }
}
