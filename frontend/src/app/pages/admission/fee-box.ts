import { Component, input } from '@angular/core';
import { Chart, FeeView, FORM_CSS, MODE_LABEL, Transport } from './form-data';

const n = (v: number) => Math.round(v).toLocaleString('en-US');

/** The fee part of both forms: a filled form shows what this student pays (by category and transport), a blank one shows the fee chart. */
@Component({
  selector: 'app-form-fee-box',
  styles: [FORM_CSS],
  template: `
  <div class="feebox">
    <h4>Fee details (category and transport)</h4>
    @if (fee(); as f) {
      <p class="small" style="margin:0 0 1.5mm">Category <b>{{ f.category || 'not set' }}</b>{{ f.category ? ' fee rates' : '' }}
        @if (tr().need) { &nbsp;·&nbsp; Transport: <b>{{ tr().route }}{{ tr().stop ? ' / ' + tr().stop : '' }}</b> ({{ mode[tr().mode] }}) } @else { &nbsp;·&nbsp; No transport }</p>
      <table class="tb"><thead><tr><th>Fee head</th><th>When</th><th class="r">Rs</th></tr></thead><tbody>
        @for (r of f.rows; track $index) { <tr><td>{{ r.name }}</td><td>{{ r.when }}</td><td class="r">{{ m(r.amount) }}</td></tr> }
        @if (f.transport; as t) { <tr><td>{{ t.name }}</td><td>{{ t.when }}</td><td class="r">{{ m(t.amount) }}</td></tr> }
        @for (l of f.discounts; track $index) { <tr><td colspan="2">{{ l.text }}</td><td class="r">- {{ m(l.amount) }}</td></tr> }
        <tr><td colspan="2" class="bold">Monthly fee</td><td class="r bold">{{ m(f.monthly) }}</td></tr>
        @if (f.once) { <tr><td colspan="2" class="bold">One-time / yearly charges</td><td class="r bold">{{ m(f.once) }}</td></tr> }
        <tr><td colspan="2" class="bold">Payable at admission (one-time + first month)</td><td class="r bold">{{ m(f.firstPayable) }}</td></tr>
      </tbody></table>
    } @else if (chart(); as c) {
      <p class="small" style="margin:0 0 1.5mm">{{ c.className }} · fee by category · A = father working in KRL, B = father retired from KRL, C = father in private job.</p>
      <table class="tb"><thead><tr><th>Fee head</th><th>When</th><th class="r">A</th><th class="r">B</th><th class="r">C</th></tr></thead><tbody>
        @for (r of c.rows; track $index) { <tr><td>{{ r.name }}</td><td>{{ r.when }}</td><td class="r">{{ m(r.A) }}</td><td class="r">{{ m(r.B) }}</td><td class="r">{{ m(r.C) }}</td></tr> }
        <tr><td colspan="2" class="bold">Monthly fee</td><td class="r bold">{{ m(c.monthly.A) }}</td><td class="r bold">{{ m(c.monthly.B) }}</td><td class="r bold">{{ m(c.monthly.C) }}</td></tr>
        @if (c.once.A || c.once.B || c.once.C) { <tr><td colspan="2" class="bold">One-time / yearly</td><td class="r bold">{{ m(c.once.A) }}</td><td class="r bold">{{ m(c.once.B) }}</td><td class="r bold">{{ m(c.once.C) }}</td></tr> }
      </tbody></table>
      @if (c.routes.length) {
        <p class="small" style="margin:2mm 0 1mm"><b>Transport, monthly:</b> @for (r of c.routes; track $index) { {{ r.name }} Rs {{ m(r.both) }}{{ r.one !== r.both ? ' (one way ' + m(r.one) + ')' : '' }}{{ $last ? '' : ' · ' }} }</p>
      }
    } @else {
      <p class="small" style="margin:0 0 1.5mm">Category <span class="tick"></span> A &nbsp; <span class="tick"></span> B &nbsp; <span class="tick"></span> C &nbsp;&nbsp;(A: father working in KRL, B: father retired from KRL, C: father in private job)</p>
      <div class="f"><span class="q">Monthly fee Rs</span><span class="ln"></span><span class="q">One-time Rs</span><span class="ln"></span></div>
      <div class="f"><span class="q">Transport fee Rs</span><span class="ln"></span><span class="q">Total payable Rs</span><span class="ln"></span></div>
    }
  </div>
  `
})
export class FormFeeBox {
  fee = input<FeeView | null>(null); chart = input<Chart | null>(null);
  tr = input.required<Transport>();
  m = n; mode = MODE_LABEL;
}
