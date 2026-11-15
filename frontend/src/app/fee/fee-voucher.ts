import { Component, computed, input } from '@angular/core';
import { Barcode } from './barcode';
import { Institute, VoucherPrint, fmtDate, money, rupeesInWords } from './fee';

/** One A4-landscape sheet: Bank copy, Office copy and Student copy side by side. */
@Component({
  selector: 'app-fee-voucher',
  imports: [Barcode],
  styles: [`
    :host { display: block; }
    * { box-sizing: border-box; }
    .sheet { width: 285mm; height: 196.5mm; display: grid; grid-template-columns: repeat(3, 1fr); background: #fff; color: #111; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
      font-size: 8.4pt; line-height: 1.25; break-after: page; page-break-after: always; letter-spacing: 0; word-spacing: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    :host(.last) .sheet { break-after: auto; page-break-after: auto; }
    .copy { position: relative; padding: 3mm 4mm 3mm; border-right: 0.3mm dashed #777; display: flex; flex-direction: column; gap: 1.6mm; }
    .copy:last-child { border-right: 0; }
    .vhead { display: flex; align-items: center; gap: 2.5mm; padding-bottom: 1.8mm; border-bottom: 0.5mm solid #1e1b4b; }
    .logo { width: 14mm; height: 14mm; flex: none; display: flex; align-items: center; justify-content: center; }
    .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo span { width: 100%; height: 100%; border-radius: 50%; background: #1e1b4b; color: #fff; font-weight: 800; font-size: 15pt; display: flex; align-items: center; justify-content: center; }
    .who { flex: 1; min-width: 0; }
    .who h1 { margin: 0; font-size: 10.5pt; font-weight: 800; color: #1e1b4b; line-height: 1.15; text-transform: uppercase; }
    .who p { margin: 0.4mm 0 0; font-size: 6.8pt; color: #444; }
    .tag { flex: none; align-self: flex-start; font-size: 6.5pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; border: 0.3mm solid #1e1b4b; border-radius: 1mm; padding: 0.8mm 1.6mm; color: #1e1b4b; }
    .title { display: flex; justify-content: space-between; align-items: center; background: #1e1b4b; color: #fff; padding: 1.3mm 2.5mm; border-radius: 1mm; font-weight: 800; letter-spacing: .08em; }
    .title span { font-weight: 700; letter-spacing: 0; font-size: 8pt; }
    .code { display: flex; align-items: center; gap: 3mm; }
    .code svg { flex: 1; height: 9mm; min-width: 0; }
    .code div { text-align: right; flex: none; }
    .code small { display: block; font-size: 6pt; color: #555; text-transform: uppercase; letter-spacing: .06em; }
    .code b { font-size: 10pt; letter-spacing: .02em; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 0.25mm solid #999; padding: 0.9mm 1.6mm; vertical-align: middle; }
    th { background: #eceef7; text-align: left; font-weight: 800; font-size: 7pt; text-transform: uppercase; letter-spacing: .04em; color: #1e1b4b; }
    .k { width: 26%; background: #f6f7fb; font-weight: 700; color: #333; font-size: 7pt; }
    .v { font-weight: 700; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .fees td { height: 5.6mm; }
    .dates .k { width: 19%; }
    .dates .v { white-space: nowrap; font-size: 7.6pt; }
    .neg { color: #166534; }
    .tot td { font-weight: 800; background: #f1f2f9; }
    .big td { font-size: 10pt; background: #1e1b4b; color: #fff; border-color: #1e1b4b; }
    .words { border: 0.25mm solid #999; border-radius: 1mm; padding: 1.2mm 2mm; font-size: 7.2pt; }
    .words b { color: #1e1b4b; }
    .bank { border: 0.25mm solid #999; border-radius: 1mm; padding: 1.2mm 2mm; font-size: 7pt; }
    .bank h4, .notes h4 { margin: 0 0 0.6mm; font-size: 6.8pt; text-transform: uppercase; letter-spacing: .06em; color: #1e1b4b; }
    .bank p { margin: 0.2mm 0; }
    .notes { font-size: 6.4pt; color: #333; }
    .notes ol { margin: 0; padding-left: 3.2mm; }
    .sign { margin-top: auto; display: flex; justify-content: space-between; gap: 4mm; padding-top: 6mm; font-size: 6.6pt; color: #333; }
    .sign div { flex: 1; border-top: 0.25mm solid #555; text-align: center; padding-top: 0.8mm; }
    .stamp { position: absolute; right: 14mm; top: 93mm; transform: rotate(-12deg); border: 0.8mm solid #166534; color: #166534; font-weight: 900; font-size: 18pt; padding: 0 3mm; border-radius: 2mm; opacity: .5; letter-spacing: .1em; }
    .dense { font-size: 7.4pt; }
    .dense .copy { gap: 1mm; }
    .dense .fees td { height: 4.3mm; padding-top: 0.4mm; padding-bottom: 0.4mm; }
    .dense .notes { font-size: 5.8pt; }
    .dense .sign { padding-top: 3mm; }
    .foot { text-align: center; font-size: 6pt; color: #777; }
  `],
  template: `
  <section class="sheet" [class.dense]="dense()">
    @for (c of copies; track c.key) {
      <article class="copy">
        <div class="vhead">
          <div class="logo">
            @if (inst().hasLogo) { <img [src]="'/api/settings/logo?v=' + inst().logoVersion" alt=""> } @else { <span>{{ initial() }}</span> }
          </div>
          <div class="who">
            <h1>{{ inst().name }}</h1>
            @if (inst().address) { <p>{{ inst().address }}</p> }
            @if (inst().phone || inst().email) { <p>{{ inst().phone }}{{ inst().phone && inst().email ? ' | ' : '' }}{{ inst().email }}</p> }
          </div>
          <span class="tag">{{ c.label }}</span>
        </div>

        <div class="title"><b>FEE VOUCHER</b><span>{{ v().period_label }}</span></div>

        <div class="code">
          <svg [appBarcode]="v().voucher_no"></svg>
          <div><small>Voucher No.</small><b>{{ v().voucher_no }}</b></div>
        </div>

        <table class="dates">
          <tr><td class="k">Issue date</td><td class="v">{{ date(v().issue_date) }}</td><td class="k">Due date</td><td class="v">{{ date(v().due_date) }}</td></tr>
        </table>

        <table>
          <tr><td class="k">Student</td><td class="v" colspan="3">{{ v().name }}</td></tr>
          <tr><td class="k">Father</td><td class="v" colspan="3">{{ v().father_name }}</td></tr>
          <tr><td class="k">Class</td><td class="v">{{ v().class_name }} - {{ v().section_name }}</td><td class="k">Roll no.</td><td class="v">{{ v().roll_no ?? '-' }}</td></tr>
          <tr><td class="k">Admission no.</td><td class="v">{{ v().reg_no }}</td><td class="k">Contact</td><td class="v">{{ v().phone || '-' }}</td></tr>
        </table>

        <table class="fees">
          <thead><tr><th style="width:8%">#</th><th>Fee details</th><th class="num" style="width:28%">Amount (Rs)</th></tr></thead>
          <tbody>
            @for (it of v().items; track $index; let i = $index) {
              <tr><td>{{ i + 1 }}</td><td>{{ it.description }}</td><td class="num" [class.neg]="it.amount < 0">{{ it.amount < 0 ? '(' + money(-it.amount) + ')' : money(it.amount) }}</td></tr>
            }
            @if (v().arrears > 0) { <tr><td></td><td>Arrears (previous dues)</td><td class="num">{{ money(v().arrears) }}</td></tr> }
            @if (v().arrears < 0) { <tr><td></td><td>Advance adjusted</td><td class="num neg">({{ money(-v().arrears) }})</td></tr> }
            @for (b of blanks(); track $index) { <tr><td>&nbsp;</td><td></td><td></td></tr> }
            <tr class="tot big"><td colspan="2">PAYABLE BY DUE DATE</td><td class="num">{{ money(v().payable) }}</td></tr>
            <tr><td colspan="2">Late fine (after due date)</td><td class="num">{{ money(v().payable > 0 ? v().late_fine : 0) }}</td></tr>
            <tr class="tot"><td colspan="2">Payable after due date</td><td class="num">{{ money(v().after_due) }}</td></tr>
          </tbody>
        </table>

        <div class="words"><b>In words:</b> {{ words() }}</div>

        <div class="bank">
          <h4>Deposit in bank</h4>
          <p><b>{{ inst().bank.name || 'Bank name' }}</b>{{ inst().bank.branch ? ', ' + inst().bank.branch : '' }}</p>
          <p>Account title: <b>{{ inst().bank.title }}</b></p>
          <p>Account no.: <b>{{ inst().bank.accountNo || '________________' }}</b></p>
          @if (inst().bank.iban) { <p>IBAN: <b>{{ inst().bank.iban }}</b></p> }
        </div>

        <div class="notes">
          <h4>Instructions</h4>
          <ol>@for (n of inst().notes; track $index) { <li>{{ n }}</li> }</ol>
        </div>

        <div class="sign">
          @if (c.key === 'bank') { <div>Bank stamp and signature</div><div>Date</div> }
          @else if (c.key === 'office') { <div>Received by (accounts)</div><div>Date</div> }
          @else { <div>Parent / student signature</div><div>Cashier</div> }
        </div>

        @if (v().paid) { <div class="stamp">PAID</div> }
        <div class="foot">Computer generated voucher - {{ c.label }}</div>
      </article>
    }
  </section>
  `
})
export class FeeVoucher {
  v = input.required<VoucherPrint>();
  inst = input.required<Institute>();
  money = money; date = fmtDate;
  copies = [{ key: 'bank', label: 'Bank copy' }, { key: 'office', label: 'Office copy' }, { key: 'student', label: 'Student copy' }];
  initial = computed(() => (this.inst().shortName || this.inst().name || 'C').trim()[0]?.toUpperCase() ?? 'C');
  words = computed(() => rupeesInWords(this.v().payable));
  rows = computed(() => this.v().items.length + (this.v().arrears !== 0 ? 1 : 0));
  dense = computed(() => this.rows() > 8);
  blanks = computed(() => Array.from({ length: Math.max(0, 6 - this.rows()) }));
}
