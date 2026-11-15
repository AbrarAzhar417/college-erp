import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { money } from './fee';

interface Row { class_id: number; class_name: string; students_due: number; due: number; charged: number; collected: number; history: number; rate: number | null; expected: number | null; low: number | null; high: number | null; remaining: number | null; confidence: 'none' | 'low' | 'medium' | 'good' }
interface R { month: string; rows: Row[]; total: { due: number; collected: number; expected: number; low: number; high: number; remaining: number; classesWithoutHistory: number } }
const CONF: Record<string, string> = { none: 'No history', low: 'Low', medium: 'Medium', good: 'Good' };

@Component({
  selector: 'app-fee-forecast',
  imports: [FormsModule],
  template: `
  <section class="space-y-4">
    <p class="text-sm font-bold text-slate-500">How much is likely to come in this month, class by class. For each class we take the share of dues paid in each earlier month (up to six) and apply the middle share to what is due now. The range runs from the worst to the best earlier month. It is a guess from habits, not a promise.</p>
    <div class="flex flex-wrap gap-3 items-end"><div><label class="label" for="ff-m">Month</label><input id="ff-m" type="month" class="field" [ngModel]="month()" (ngModelChange)="month.set($event); load()"></div>
      <button type="button" class="btn-ghost" (click)="csv()">Download CSV</button><button type="button" class="btn-ghost no-print" (click)="print()">Print</button></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (r(); as x) {
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-xl font-black">Rs {{ m(x.total.due) }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Due now</div></div>
        <div class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-xl font-black">Rs {{ m(x.total.collected) }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Collected so far</div></div>
        <div class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-xl font-black text-indigo-600">Rs {{ m(x.total.expected) }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Expected this month</div><div class="text-xs font-bold text-slate-400">Rs {{ m(x.total.low) }} to {{ m(x.total.high) }}</div></div>
        <div class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"><div class="text-xl font-black">Rs {{ m(x.total.remaining) }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Still to come</div></div>
      </div>
      @if (x.total.classesWithoutHistory) { <p class="text-xs font-bold text-amber-600">{{ x.total.classesWithoutHistory }} class(es) have no earlier month to learn from, so they are left out of the expected total.</p> }
      <div class="overflow-x-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800">
        <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-4 py-3">Class</th><th class="px-3 py-3">Students owing</th><th class="px-3 py-3">Due</th><th class="px-3 py-3">Collected</th><th class="px-3 py-3">Usual share paid</th><th class="px-3 py-3">Expected</th><th class="px-3 py-3">Range</th><th class="px-3 py-3">Still to come</th><th class="px-3 py-3">Confidence</th></tr></thead>
        <tbody>@for (c of x.rows; track c.class_id) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="px-4 py-3 font-black">{{ c.class_name }}</td><td class="px-3 py-3 font-bold">{{ c.students_due }}</td><td class="px-3 py-3 font-bold">{{ m(c.due) }}</td><td class="px-3 py-3 font-bold">{{ m(c.collected) }}</td>
          <td class="px-3 py-3 font-bold">{{ c.rate == null ? '-' : c.rate + '%' }}</td><td class="px-3 py-3 font-black text-indigo-600">{{ c.expected == null ? '-' : m(c.expected) }}</td>
          <td class="px-3 py-3 text-xs font-bold text-slate-500">{{ c.low == null ? '-' : m(c.low) + ' to ' + m(c.high!) }}</td><td class="px-3 py-3 font-bold">{{ c.remaining == null ? '-' : m(c.remaining) }}</td>
          <td class="px-3 py-3 text-xs font-black" [class.text-amber-600]="c.confidence === 'low' || c.confidence === 'none'">{{ conf[c.confidence] }} ({{ c.history }} mo)</td></tr>
        } @empty { <tr><td colspan="9" class="p-8 text-center font-bold text-slate-400">No dues in this month.</td></tr> }</tbody></table>
      </div>
      <p class="text-xs font-bold text-slate-400">Due = what students already owed at the start of the month + what was charged in the month. Generate the month's vouchers first, or the due amount will be too low.</p>
    }
  </section>
  `
})
export class FeeForecast {
  private api = inject(Api); conf = CONF; m = money;
  month = signal(new Date().toISOString().slice(0, 7)); r = signal<R | null>(null); error = signal('');
  constructor() { this.load(); }
  load() { if (!this.month()) return; this.api.get<R>('/fee-forecast', { month: this.month() }).subscribe({ next: r => { this.r.set(r); this.error.set(''); }, error: e => this.error.set(errorText(e)) }); }
  print() { window.print(); }
  csv() {
    const q = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Class', 'Students owing', 'Due', 'Collected', 'Usual share %', 'Expected', 'Low', 'High', 'Still to come', 'Confidence'].map(q).join(',')];
    for (const c of this.r()?.rows ?? []) lines.push([c.class_name, c.students_due, c.due, c.collected, c.rate, c.expected, c.low, c.high, c.remaining, CONF[c.confidence]].map(q).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })); a.download = `fee-forecast-${this.month()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
}
