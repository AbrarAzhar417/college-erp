import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { GlobalSearch } from '../pages/global-search';
import { fmtDate, money, today } from './fee';

interface Summary {
  month: string; billed: number; collected: number; collectedToday: number; outstanding: number; defaulters: number; vouchers: number;
  byClass: { name: string; grade: number; outstanding: number }[];
  recent: { id: number; receipt_no: string; amount: number; paid_on: string; mode: string; name: string; class_name: string; section_name: string }[];
}
interface Report { from: string; to: string; total: number; byMode: Record<string, number>; rows: { id: number; receipt_no: string; amount: number; paid_on: string; mode: string; reference: string | null; cancelled: number; name: string; class_name: string; section_name: string; voucher_no: string | null }[] }

@Component({
  selector: 'app-fee-home',
  imports: [FormsModule, RouterLink, GlobalSearch],
  template: `
  <div class="space-y-8">
    <div class="no-print"><app-global-search /></div>
    <div class="no-print flex items-end gap-4">
      <div><label class="label" for="mon">Month</label><input id="mon" type="month" class="field" [ngModel]="month()" (ngModelChange)="setMonth($event)"></div>
    </div>
    @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-sm">{{ error() }}</p> }

    @if (s(); as s) {
      <section class="no-print grid grid-cols-2 xl:grid-cols-4 gap-5 md:gap-8">
        @for (k of kpis(); track k.label) {
          <div class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
            <p class="text-2xl md:text-3xl font-black tracking-tighter">{{ k.value }}</p>
            <p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p>
            <p class="text-[11px] font-bold text-slate-400 mt-3">{{ k.sub }}</p>
          </div>
        }
      </section>

      <section class="no-print grid grid-cols-1 xl:grid-cols-3 gap-5 md:gap-8">
        <div class="xl:col-span-2 bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <h3 class="text-xl font-black tracking-tight mb-8">Unpaid fee by class</h3>
          <div class="space-y-4">
            @for (c of s.byClass; track c.grade) {
              <div class="flex items-center gap-4">
                <span class="w-20 text-sm font-bold text-slate-500">{{ c.name }}</span>
                <div class="flex-1 h-4 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden"><div class="h-full bg-rose-500 rounded-full transition-all duration-700" [style.width.%]="pct(c.outstanding)"></div></div>
                <span class="w-24 text-right text-sm font-black">Rs {{ m(c.outstanding) }}</span>
              </div>
            }
          </div>
        </div>
        <div class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <h3 class="text-xl font-black tracking-tight mb-6">Latest payments</h3>
          @if (!s.recent.length) { <p class="text-sm font-bold text-slate-400">No payments yet.</p> }
          <ul class="space-y-3">
            @for (p of s.recent; track p.id) {
              <li><a [routerLink]="['/fee/receipt', p.id]" class="flex items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50 hover:bg-indigo-600/10">
                <span class="min-w-0"><span class="block text-sm font-black truncate">{{ p.name }}</span><span class="block text-[11px] font-bold text-slate-400">{{ p.class_name }}-{{ p.section_name }} · {{ d(p.paid_on) }}</span></span>
                <span class="text-sm font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">Rs {{ m(p.amount) }}</span>
              </a></li>
            }
          </ul>
        </div>
      </section>
    }

    <section class="print-area bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <h3 class="text-xl font-black tracking-tight">Collection report</h3>
        <div class="no-print flex flex-wrap items-end gap-3">
          <div><label class="label" for="rf">From</label><input id="rf" type="date" class="field" [(ngModel)]="from"></div>
          <div><label class="label" for="rt">To</label><input id="rt" type="date" class="field" [(ngModel)]="to"></div>
          <button type="button" class="btn-primary" (click)="loadReport()">Show</button>
          <button type="button" class="btn-ghost" (click)="print()">Print</button>
        </div>
      </div>
      @if (report(); as r) {
        <p class="text-sm font-bold text-slate-500">{{ d(r.from) }} to {{ d(r.to) }} · Total received <b class="text-emerald-600">Rs {{ m(r.total) }}</b>
          @for (e of modes(); track e[0]) { · {{ e[0] }}: Rs {{ m(e[1]) }} }</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
              <th class="py-3 pr-4">Receipt</th><th class="py-3 pr-4">Date</th><th class="py-3 pr-4">Student</th><th class="py-3 pr-4">Class</th><th class="py-3 pr-4">Voucher</th><th class="py-3 pr-4">Mode</th><th class="py-3 text-right">Amount</th></tr></thead>
            <tbody>
              @for (p of r.rows; track p.id) {
                <tr class="border-b border-slate-50 dark:border-slate-800/60" [class.opacity-40]="p.cancelled">
                  <td class="py-3 pr-4 font-bold"><a [routerLink]="['/fee/receipt', p.id]" class="text-indigo-600 dark:text-indigo-400">{{ p.receipt_no }}</a></td>
                  <td class="py-3 pr-4 whitespace-nowrap">{{ d(p.paid_on) }}</td>
                  <td class="py-3 pr-4 font-black whitespace-nowrap">{{ p.name }}{{ p.cancelled ? ' (cancelled)' : '' }}</td>
                  <td class="py-3 pr-4 whitespace-nowrap">{{ p.class_name }}-{{ p.section_name }}</td>
                  <td class="py-3 pr-4 text-slate-400">{{ p.voucher_no || '-' }}</td>
                  <td class="py-3 pr-4 capitalize">{{ p.mode }}</td>
                  <td class="py-3 text-right font-black whitespace-nowrap">Rs {{ m(p.amount) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (!r.rows.length) { <p class="text-sm font-bold text-slate-400">No payments in this period.</p> }
      }
    </section>
  </div>
  `
})
export class FeeHome {
  private api = inject(Api);
  m = money; d = fmtDate;
  month = signal(today().slice(0, 7));
  s = signal<Summary | null>(null);
  report = signal<Report | null>(null);
  error = signal('');
  from = today(); to = today();
  modes = computed(() => Object.entries(this.report()?.byMode ?? {}));
  max = computed(() => Math.max(1, ...(this.s()?.byClass.map(c => c.outstanding) ?? [1])));
  pct = (n: number) => Math.round((n / this.max()) * 100);

  kpis = computed(() => {
    const s = this.s(); if (!s) return [];
    return [
      { label: 'Billed this month', value: 'Rs ' + money(s.billed), sub: `${s.vouchers} vouchers` },
      { label: 'Collected this month', value: 'Rs ' + money(s.collected), sub: `Today: Rs ${money(s.collectedToday)}` },
      { label: 'Unpaid in total', value: 'Rs ' + money(s.outstanding), sub: 'All months together' },
      { label: 'Students with dues', value: String(s.defaulters), sub: 'See the Defaulters tab' }
    ];
  });

  constructor() { this.load(); this.loadReport(); }
  setMonth(v: string) { if (v) { this.month.set(v); this.load(); } }
  load() { this.api.get<Summary>('/fee/summary', { month: this.month() }).subscribe({ next: s => this.s.set(s), error: e => this.error.set(errorText(e)) }); }
  loadReport() { this.api.get<Report>('/fee/payments', { from: this.from, to: this.to }).subscribe({ next: r => this.report.set(r), error: e => this.error.set(errorText(e)) }); }
  print() { window.print(); }
}
