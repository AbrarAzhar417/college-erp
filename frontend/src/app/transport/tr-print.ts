import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { Barcode } from '../fee/barcode';
import { MODE_LABEL, MODE_SHORT, Overview, Rider, RouteDetail, Vehicle, daysLeft, fmtDate, money, monthLabelOf, today } from './tr';
import { Rep } from './tr-reports';

interface PassRow extends Rider { stopName: string }

@Component({
  selector: 'app-tr-print',
  imports: [NgTemplateOutlet, LucideAngularModule, Barcode],
  styles: [`
    * { box-sizing: border-box; }
    .page { width: 285mm; background: #fff; color: #111; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 8pt; letter-spacing: 0; word-spacing: 0; padding: 0 0 2mm; break-after: page; page-break-after: always; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .head { display: flex; align-items: center; gap: 4mm; padding-bottom: 2mm; border-bottom: .5mm solid #1e1b4b; margin-bottom: 2.5mm; }
    .logo { width: 14mm; height: 14mm; flex: none; display: flex; align-items: center; justify-content: center; } .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font-weight: 800; font-size: 15pt; display: flex; align-items: center; justify-content: center; }
    .who h1 { margin: 0; font-size: 13pt; color: #1e1b4b; text-transform: uppercase; } .who p { margin: .5mm 0 0; font-size: 7pt; color: #444; }
    .ttl { margin-left: auto; text-align: right; font-size: 8.5pt; } .ttl b { display: block; font-size: 11.5pt; color: #1e1b4b; }
    table.t { width: 100%; border-collapse: collapse; } table.t th, table.t td { border: .2mm solid #888; padding: 1mm 1.6mm; text-align: center; }
    table.t th { background: #eceef7; color: #1e1b4b; font-size: 7pt; } table.t td.l, table.t th.l { text-align: left; } thead { display: table-header-group; } tr { break-inside: avoid; }
    tr.grp td { background: #f1f2f9; font-weight: 800; color: #1e1b4b; text-align: left; } .bad { color: #b91c1c; font-weight: 800; } .ok { color: #166534; font-weight: 800; }
    .meta { width: 100%; border-collapse: collapse; margin-bottom: 2.5mm; } .meta td { border: .2mm solid #999; padding: 1mm 1.8mm; } .meta td.k { background: #f6f7fb; font-weight: 700; width: 10%; font-size: 7.4pt; }
    .sign { display: flex; justify-content: space-between; gap: 25mm; margin-top: 12mm; font-size: 8pt; } .sign div { flex: 1; border-top: .25mm solid #555; text-align: center; padding-top: 1mm; }
    /* bus pass */
    .passes { display: grid; grid-template-columns: repeat(3, 92mm); gap: 4mm 3mm; justify-content: center; }
    .pass { width: 92mm; height: 58mm; border: .4mm solid #1e1b4b; border-radius: 3mm; overflow: hidden; display: flex; flex-direction: column; background: #fff; }
    .pass .top { background: #1e1b4b; color: #fff; display: flex; align-items: center; gap: 2mm; padding: 1.6mm 2.5mm; } .pass .top .lg { width: 8mm; height: 8mm; background: #fff; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; flex: none; } .pass .top .lg img { max-width: 100%; max-height: 100%; }
    .pass .top .lg span { color: #1e1b4b; font: 800 9pt Arial; } .pass .top b { font-size: 7.5pt; text-transform: uppercase; line-height: 1.15; } .pass .top small { display: block; font-size: 6pt; letter-spacing: .12em; opacity: .85; }
    .pass .body { padding: 2mm 2.8mm; flex: 1; font-size: 7.4pt; line-height: 1.35; } .pass .nm { font-size: 10.5pt; font-weight: 800; color: #1e1b4b; } .pass .row { display: flex; gap: 2mm; } .pass .row span:first-child { width: 17mm; color: #555; flex: none; }
    .pass .bar { padding: 0 2.8mm 1.5mm; display: flex; align-items: center; gap: 2mm; } .pass .bar svg { height: 7mm; flex: 1; } .pass .bar small { font-size: 6pt; color: #555; }
    .pass .ft { border-top: .2mm dashed #888; display: flex; justify-content: space-between; padding: 1mm 2.8mm; font-size: 6.2pt; color: #555; }
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

  <div class="print-area overflow-x-auto"><div class="w-fit shadow-enterprise print:shadow-none">
  @switch (kind) {
    @case ('route') { @for (d of routes(); track d.route.id) {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Bus Student List', sub: d.route.name + (d.vehicle ? ' · ' + d.vehicle.number : '') }" />
        <table class="meta"><tr><td class="k">Route</td><td><b>{{ d.route.name }}</b></td><td class="k">Bus</td><td>{{ d.vehicle?.number }} {{ d.vehicle?.reg_no ? '(' + d.vehicle?.reg_no + ')' : '' }}</td><td class="k">Driver</td><td>{{ d.vehicle?.driver || '-' }} {{ d.vehicle?.driver_phone }}</td><td class="k">Conductor</td><td>{{ d.vehicle?.conductor || '-' }} {{ d.vehicle?.conductor_phone }}</td></tr>
          <tr><td class="k">Morning</td><td>{{ d.route.morning_time || '-' }}</td><td class="k">Afternoon</td><td>{{ d.route.afternoon_time || '-' }}</td><td class="k">Seats</td><td>{{ d.vehicle?.capacity ?? '-' }}</td><td class="k">Students</td><td><b>{{ d.totals.students }}</b></td></tr></table>
        <table class="t"><colgroup><col style="width:9mm"><col style="width:48mm"><col style="width:48mm"><col style="width:26mm"><col style="width:14mm"><col style="width:32mm"><col style="width:20mm"><col></colgroup>
          <thead><tr><th>#</th><th class="l">Student</th><th class="l">Father</th><th>Class</th><th>Roll</th><th>Phone</th><th>Pick / drop</th><th class="l">Remarks</th></tr></thead>
          @for (g of groups(d); track g.name) { <tbody><tr class="grp"><td colspan="8">{{ g.name }}{{ g.times ? ' · ' + g.times : '' }} ({{ g.list.length }})</td></tr>
            @for (s of g.list; track s.id; let i = $index) { <tr><td>{{ i + 1 }}</td><td class="l"><b>{{ s.name }}</b></td><td class="l">{{ s.father_name }}</td><td>{{ s.class_name }}-{{ s.section_name }}</td><td>{{ s.roll_no ?? '' }}</td><td>{{ s.father_phone || s.phone || '' }}</td><td>{{ ms(s.tr_mode ?? 'both') }}</td><td></td></tr> }</tbody> }
        </table>
        <div class="sign"><div>Transport incharge</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> } }

    @case ('passes') { @for (pg of passPages(); track $index) {
      <section class="page"><div class="passes">@for (s of pg; track s.id) {
        <div class="pass">
          <div class="top"><div class="lg">@if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt=""> } @else { <span>{{ settings.initial() }}</span> }</div><div><b>{{ settings.instituteName() }}</b><small>TRANSPORT PASS</small></div></div>
          <div class="body"><div class="nm">{{ s.name }}</div><div class="row"><span>Father</span><span>{{ s.father_name }}</span></div><div class="row"><span>Class</span><span>{{ s.class_name }}-{{ s.section_name }} · Roll {{ s.roll_no ?? '-' }}</span></div>
            <div class="row"><span>Route / bus</span><span><b>{{ s.route }}</b> · {{ s.bus }}</span></div><div class="row"><span>Stop</span><span>{{ s.stopName || '-' }}</span></div><div class="row"><span>Service</span><span>{{ ml[s.tr_mode ?? 'both'] }}</span></div></div>
          <div class="bar"><svg [appBarcode]="s.reg_no"></svg><small>{{ s.reg_no }}</small></div>
          <div class="ft"><span>Show this pass to the conductor</span><span>Principal</span></div>
        </div> }</div></section> } }

    @case ('vehicles') {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Buses and Documents', sub: 'Printed ' + d(todayIso) }" />
        <table class="t"><thead><tr><th class="l">Bus</th><th>Registration</th><th>Seats</th><th class="l">Route</th><th class="l">Driver</th><th>Fitness</th><th>Permit</th><th>Insurance</th><th>Token tax</th><th>Next service</th></tr></thead>
          <tbody>@for (v of vehicles(); track v.id) { <tr><td class="l"><b>{{ v.number }}</b><br>{{ v.make_model }}</td><td>{{ v.reg_no }}</td><td>{{ v.capacity }}</td><td class="l">{{ v.route || '-' }} ({{ v.used }})</td><td class="l">{{ v.driver || '-' }}<br>{{ v.conductor ? 'Cond.: ' + v.conductor : '' }}</td>
            @for (x of [v.fitness_expiry, v.permit_expiry, v.insurance_expiry, v.tax_expiry, v.next_service]; track $index) { <td [class]="cls(x)">{{ x ? d(x) : '-' }}</td> }</tr> }</tbody></table>
        <p style="margin-top:2mm;font-size:7pt;color:#555">Red = expired, bold = expires within 30 days.</p>
        <div class="sign"><div>Transport incharge</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> }

    @case ('report') { @if (rep(); as r) {
      <section class="page">
        <ng-container *ngTemplateOutlet="hdr; context: { title: 'Transport Report', sub: ml2(r.month) }" />
        <table class="t"><thead><tr><th class="l">Route</th><th>Bus</th><th>Seats filled</th><th>Fee income (Rs)</th><th>Came on bus</th></tr></thead>
          <tbody>@for (x of r.rows; track x.id) { <tr><td class="l"><b>{{ x.name }}</b></td><td>{{ x.bus || '-' }}</td><td>{{ x.students }}{{ x.capacity ? ' / ' + x.capacity : '' }}</td><td>{{ m(x.income) }}</td><td>{{ x.boardedPct === null ? '-' : x.boardedPct + '%' }}</td></tr> }
            <tr class="grp"><td colspan="2">Total</td><td>{{ r.totals.students }}</td><td>{{ m(r.totals.income) }}</td><td></td></tr></tbody></table>
        <div class="sign"><div>{{ settings.sign('Accounts', 'accounts_officer') }}</div><div>{{ settings.sign('Principal', 'principal') }}</div></div>
      </section> } }
  }
  </div></div>
  `
})
export class TrPrint {
  private api = inject(Api);
  settings = inject(SettingsService);
  printIcon = Printer; d = fmtDate; m = money; ms = (k: string) => MODE_SHORT[k]; ml = MODE_LABEL; todayIso = today(); ml2 = monthLabelOf;
  cls = (iso: string | null) => { const n = daysLeft(iso); return n !== null && n < 0 ? 'bad' : n !== null && n <= 30 ? 'ok' : ''; };
  private route = inject(ActivatedRoute);
  kind = this.route.snapshot.paramMap.get('kind') ?? '';
  routes = signal<RouteDetail[]>([]); vehicles = signal<Vehicle[]>([]); rep = signal<Rep | null>(null); error = signal(''); ready = signal(false);
  constructor() {
    const q = this.route.snapshot.queryParamMap, rid = Number(q.get('routeId')) || 0, err = (e: unknown) => this.error.set(errorText(e));
    if (this.kind === 'vehicles') this.api.get<Vehicle[]>('/transport/vehicles').subscribe({ next: v => { this.vehicles.set(v); this.ready.set(true); }, error: err });
    else if (this.kind === 'report') this.api.get<Rep>('/transport/report', { month: q.get('month') ?? undefined }).subscribe({ next: r => { this.rep.set(r); this.ready.set(true); }, error: err });
    else if (rid) this.api.get<RouteDetail>(`/transport/routes/${rid}`).subscribe({ next: d => { this.routes.set([d]); this.ready.set(true); }, error: err });
    else this.api.get<Overview>('/transport/overview').subscribe({ next: async o => { try { this.routes.set(await Promise.all(o.routes.map(r => firstValueFrom(this.api.get<RouteDetail>(`/transport/routes/${r.id}`))))); this.ready.set(true); } catch (e) { err(e); } }, error: err });
  }
  groups(d: RouteDetail) {
    const g = d.stops.map(s => ({ name: s.name, times: `pick up ${s.pickup_time || '-'} · drop ${s.drop_time || '-'}`, list: s.students }));
    return d.noStop.length ? [...g, { name: 'Stop not chosen', times: '', list: d.noStop }] : g;
  }
  passPages(): PassRow[][] {
    const all: PassRow[] = this.routes().flatMap(d => [...d.stops.flatMap(s => s.students.map(x => ({ ...x, stopName: s.name, route: d.route.name, bus: d.vehicle?.number ?? '' }))), ...d.noStop.map(x => ({ ...x, stopName: '', route: d.route.name, bus: d.vehicle?.number ?? '' }))]);
    const pages: PassRow[][] = []; for (let i = 0; i < all.length; i += 9) pages.push(all.slice(i, i + 9)); return pages;
  }
  print() { window.print(); }
}
