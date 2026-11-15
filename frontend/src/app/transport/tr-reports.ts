import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { money, today } from './tr';

interface Row { id: number; name: string; bus: string | null; capacity: number | null; students: number; income: number; boardedPct: number | null; fill: number | null }
export interface Rep { month: string; rows: Row[]; totals: { students: number; income: number } }

@Component({
  selector: 'app-tr-reports',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="flex flex-wrap items-end gap-4"><div><label class="label" for="rm">Month</label><input id="rm" type="month" class="field" [ngModel]="month()" (ngModelChange)="set($event)"></div>
      <a [routerLink]="['/transport/print/report']" [queryParams]="{ month: month() }" class="btn-ghost">Print report</a></div>
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    @if (r(); as x) {
      <section class="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div class="p-5 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><p class="text-2xl font-black">{{ x.totals.students }}</p><p class="text-xs font-bold text-slate-400">Students on buses</p></div>
        <div class="p-5 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><p class="text-2xl font-black text-emerald-600">Rs {{ m(x.totals.income) }}</p><p class="text-xs font-bold text-slate-400">Transport fee a month</p></div>
      </section>
      <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto"><table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Route</th><th class="px-5 py-4">Bus</th><th class="px-5 py-4 text-right">Seats filled</th><th class="px-5 py-4 text-right">Fee income</th><th class="px-5 py-4 text-right">Came on bus</th></tr></thead>
        <tbody>@for (x of x.rows; track x.id) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="px-5 py-3 font-black"><a [routerLink]="['/transport/route', x.id]" class="hover:text-indigo-500">{{ x.name }}</a></td><td class="px-5 py-3 font-bold">{{ x.bus || '-' }}</td>
          <td class="px-5 py-3 text-right font-bold" [class]="x.fill && x.fill > 100 ? 'text-rose-500' : ''">{{ x.students }}{{ x.capacity ? ' / ' + x.capacity : '' }}{{ x.fill !== null ? ' (' + x.fill + '%)' : '' }}</td><td class="px-5 py-3 text-right font-bold text-emerald-600">Rs {{ m(x.income) }}</td><td class="px-5 py-3 text-right">{{ x.boardedPct === null ? '-' : x.boardedPct + '%' }}</td></tr> }</tbody></table></div>
      <p class="text-xs font-bold text-slate-400">Fee income is what the students on the bus pay every month. "Came on bus" is the share of trips the students were marked as boarded.</p>
    }
  </div>
  `
})
export class TrReports {
  private api = inject(Api);
  m = money; abs = Math.abs;
  month = signal(today().slice(0, 7)); r = signal<Rep | null>(null); error = signal('');
  constructor() { this.load(); }
  set(v: string) { if (v) { this.month.set(v); this.load(); } }
  load() { this.api.get<Rep>('/transport/report', { month: this.month() }).subscribe({ next: r => this.r.set(r), error: e => this.error.set(errorText(e)) }); }
}
