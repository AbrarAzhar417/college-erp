import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';

interface U { user: string; role: string; events: number; rows: number; exports: number; backups: number; last: string; unusual: boolean; top: { path: string; rows: number }[] }
interface R { users: U[]; daily: { day: string; events: number }[]; totalRows: number; threshold: number }

@Component({
  selector: 'app-downloads-report',
  imports: [FormsModule],
  template: `
  <section class="space-y-4">
    <p class="text-sm font-bold text-slate-500">Who has opened or exported large amounts of data. Every answer of 100 rows or more, every class export, card print and backup download is counted. A screen that is saved as a file on the person's own computer is counted when it was opened. A person is marked <b>high</b> when they read far more than most (over {{ r()?.threshold ?? 2000 }} rows) or a non-director downloaded a backup. High is a reason to ask, not proof of anything.</p>
    <div class="flex flex-wrap gap-3 items-end">
      <div><label class="label" for="dl-from">From</label><input id="dl-from" type="date" class="field" [ngModel]="from()" (ngModelChange)="from.set($event); load()"></div>
      <div><label class="label" for="dl-to">To</label><input id="dl-to" type="date" class="field" [ngModel]="to()" (ngModelChange)="to.set($event); load()"></div>
      <button type="button" class="btn-ghost" (click)="csv()">Download CSV</button><button type="button" class="btn-ghost" (click)="print()">Print</button>
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (r(); as x) {
      <p class="text-sm font-black">{{ x.totalRows }} rows in total · {{ x.users.length }} person(s)</p>
      <div class="overflow-x-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800">
        <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-4 py-3">Person</th><th class="px-3 py-3">Rows read</th><th class="px-3 py-3">Times</th><th class="px-3 py-3">Exports / cards</th><th class="px-3 py-3">Backups</th><th class="px-3 py-3">Mostly</th><th class="px-3 py-3">Last</th><th></th></tr></thead>
          <tbody>@for (u of x.users; track u.user) { <tr class="border-t border-slate-100 dark:border-slate-800">
            <td class="px-4 py-3 font-black">{{ u.user }} <span class="text-slate-400 font-bold">{{ u.role }}</span></td><td class="px-3 py-3 font-black">{{ u.rows }}</td><td class="px-3 py-3 font-bold">{{ u.events }}</td><td class="px-3 py-3 font-bold">{{ u.exports }}</td><td class="px-3 py-3 font-bold">{{ u.backups }}</td>
            <td class="px-3 py-3 text-xs font-bold text-slate-500">{{ topLine(u) }}</td><td class="px-3 py-3 text-xs font-bold whitespace-nowrap">{{ u.last }}</td>
            <td class="px-3 py-3">@if (u.unusual) { <span class="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-600 text-xs font-black">High</span> }</td></tr>
          } @empty { <tr><td colspan="8" class="p-8 text-center font-bold text-slate-400">No large reads in this period.</td></tr> }</tbody></table>
      </div>
    }
  </section>
  `
})
export class DownloadsReport {
  private api = inject(Api);
  from = signal(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)); to = signal(new Date().toISOString().slice(0, 10));
  r = signal<R | null>(null); error = signal('');
  constructor() { this.load(); }
  load() { this.api.get<R>('/audit/downloads', { from: this.from(), to: this.to() }).subscribe({ next: r => this.r.set(r), error: e => this.error.set(errorText(e)) }); }
  topLine(u: U) { return u.top.map(t => `${t.path} (${t.rows})`).join(', '); }
  print() { window.print(); }
  csv() {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Person', 'Role', 'Rows read', 'Times', 'Exports/cards', 'Backups', 'Mostly', 'Last', 'High'].map(q).join(',')];
    for (const u of this.r()?.users ?? []) lines.push([u.user, u.role, u.rows, u.events, u.exports, u.backups, this.topLine(u), u.last, u.unusual ? 'yes' : ''].map(q).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' })); a.download = `downloads-report-${this.from()}-${this.to()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
}
