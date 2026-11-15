import { SettingsService } from '../core/settings';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Api, errorText } from '../core/api';
import { qrSvg } from '../core/qr';
import { Institute, fmtDate, money, rupeesInWords } from './fee';

interface Receipt {
  id: number; receipt_no: string; amount: number; paid_on: string; mode: string; reference: string | null; note: string | null; cancelled: number; balance: number;
  name: string; father_name: string; reg_no: string; roll_no: number | null; phone: string | null; class_name: string; section_name: string;
  voucher_no: string | null; period_label: string | null; received_by_name: string | null; code: string;
}

@Component({
  selector: 'app-fee-receipt',
  imports: [LucideAngularModule, TitleCasePipe],
  styles: [`
    * { box-sizing: border-box; }
    .sheet { width: 285mm; min-height: 118mm; display: grid; grid-template-columns: 1fr 1fr; background: #fff; color: #111; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 9pt; letter-spacing: 0; word-spacing: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .copy { position: relative; padding: 5mm 7mm; border-right: 0.3mm dashed #777; display: flex; flex-direction: column; gap: 2.5mm; }
    .copy:last-child { border-right: 0; }
    .vhead { display: flex; align-items: center; gap: 3mm; padding-bottom: 2mm; border-bottom: 0.5mm solid #1e1b4b; }
    .logo { width: 15mm; height: 15mm; flex: none; display: flex; align-items: center; justify-content: center; }
    .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font-weight: 800; font-size: 16pt; display: flex; align-items: center; justify-content: center; }
    h1 { margin: 0; font-size: 12pt; font-weight: 800; color: #1e1b4b; text-transform: uppercase; }
    .vhead p { margin: 0.5mm 0 0; font-size: 7pt; color: #444; }
    .tag { margin-left: auto; align-self: flex-start; font-size: 7pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; border: 0.3mm solid #1e1b4b; border-radius: 1mm; padding: 1mm 2mm; color: #1e1b4b; }
    .title { background: #1e1b4b; color: #fff; padding: 1.5mm 3mm; border-radius: 1mm; font-weight: 800; letter-spacing: .1em; display: flex; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; }
    td { border: 0.25mm solid #999; padding: 1.2mm 2mm; }
    .k { width: 28%; background: #f6f7fb; font-weight: 700; color: #333; font-size: 8pt; }
    .v { font-weight: 700; }
    .amount td { font-size: 13pt; font-weight: 800; background: #f1f2f9; }
    .words { border: 0.25mm solid #999; border-radius: 1mm; padding: 1.5mm 2.5mm; font-size: 8.5pt; }
    .qrbox { display: flex; align-items: center; gap: 3mm; font-size: 7pt; color: #444; }
    .qrbox :is(svg) { width: 17mm; height: 17mm; display: block; } .qrbox > span:first-child { display: block; width: 17mm; height: 17mm; flex: none; line-height: 0; }
    .sign { margin-top: auto; display: flex; gap: 6mm; padding-top: 9mm; font-size: 7.5pt; }
    .sign div { flex: 1; border-top: 0.25mm solid #555; text-align: center; padding-top: 1mm; }
    .void { position: absolute; right: 8mm; top: 55mm; transform: rotate(-12deg); border: 1mm solid #b91c1c; color: #b91c1c; font-weight: 900; font-size: 22pt; padding: 0 4mm; border-radius: 2mm; opacity: .6; }
  `],
  template: `
  <div class="no-print flex flex-wrap items-center gap-4 mb-6">
    <button type="button" class="btn-primary" (click)="print()"><lucide-icon [img]="printIcon" [size]="16" /> Print receipt</button>
    <p class="text-sm font-bold text-slate-400">Two copies print on one A4 landscape page (student and office).</p>
  </div>
  @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (r(); as p) {
    @if (inst(); as i) {
      <div class="print-area overflow-x-auto"><div class="w-fit shadow-enterprise print:shadow-none">
        <section class="sheet">
          @for (c of copies; track c) {
            <article class="copy">
              <div class="vhead">
                <div class="logo">@if (i.hasLogo) { <img [src]="'/api/settings/logo?v=' + i.logoVersion" alt=""> } @else { <span>{{ (i.shortName || i.name || 'C')[0].toUpperCase() }}</span> }</div>
                <div><h1>{{ i.name }}</h1>@if (i.address) { <p>{{ i.address }}</p> }@if (i.phone) { <p>{{ i.phone }}</p> }</div>
                <span class="tag">{{ c }}</span>
              </div>
              <div class="title"><span>FEE RECEIPT</span><span>{{ p.receipt_no }}</span></div>
              <table>
                <tr><td class="k">Date</td><td class="v">{{ date(p.paid_on) }}</td><td class="k">Payment mode</td><td class="v">{{ p.mode | titlecase }}{{ p.reference ? ' (' + p.reference + ')' : '' }}</td></tr>
                <tr><td class="k">Student</td><td class="v" colspan="3">{{ p.name }}</td></tr>
                <tr><td class="k">Father</td><td class="v" colspan="3">{{ p.father_name }}</td></tr>
                <tr><td class="k">Class</td><td class="v">{{ p.class_name }} - {{ p.section_name }}</td><td class="k">Roll no.</td><td class="v">{{ p.roll_no ?? '-' }}</td></tr>
                <tr><td class="k">Admission no.</td><td class="v">{{ p.reg_no }}</td><td class="k">Contact</td><td class="v">{{ p.phone || '-' }}</td></tr>
                @if (p.voucher_no) { <tr><td class="k">Voucher no.</td><td class="v" colspan="3">{{ p.voucher_no }} ({{ p.period_label }})</td></tr> }
              </table>
              <table><tr class="amount"><td class="k" style="font-size:9pt">Amount received</td><td>Rs {{ money(p.amount) }}</td></tr></table>
              <div class="words"><b>In words:</b> {{ words() }}</div>
              <table><tr><td class="k">Balance remaining</td><td class="v">{{ p.balance > 0 ? 'Rs ' + money(p.balance) : (p.balance < 0 ? 'Advance Rs ' + money(-p.balance) : 'Nil (cleared)') }}</td></tr></table>
              <div class="qrbox"><span [innerHTML]="qr()"></span><span>Scan to check this receipt is genuine</span></div>
              <div class="sign"><div>Received by {{ p.received_by_name ? '(' + p.received_by_name + ')' : '' }}</div><div>Stamp</div></div>
              @if (p.cancelled) { <div class="void">CANCELLED</div> }
            </article>
          }
        </section>
      </div></div>
    }
  }
  `
})
export class FeeReceipt {
  private settings = inject(SettingsService);
  private api = inject(Api);
  printIcon = Printer; money = money; date = fmtDate;
  copies = ['Student copy', 'Office copy'];
  r = signal<Receipt | null>(null);
  inst = signal<Institute | null>(null);
  error = signal('');
  words = computed(() => rupeesInWords(this.r()?.amount ?? 0));
  private san = inject(DomSanitizer);
  qr = computed<SafeHtml>(() => { const c = this.r()?.code; if (!c) return ''; try { return this.san.bypassSecurityTrustHtml(qrSvg(`${this.settings.publicUrl() || location.origin}/verify/${c}`)); } catch { return ''; } });

  constructor() {
    const id = inject(ActivatedRoute).snapshot.paramMap.get('id');
    this.api.get<{ payment: Receipt; institute: Institute }>(`/fee/payments/${id}`).subscribe({
      next: d => { this.r.set(d.payment); this.inst.set(d.institute); },
      error: e => this.error.set(errorText(e))
    });
  }
  print() { window.print(); }
}
