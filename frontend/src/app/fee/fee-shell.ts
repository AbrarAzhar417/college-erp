import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-fee-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="max-w-7xl mx-auto pb-16 print:pb-0 space-y-8">
    <div class="no-print space-y-8">
      <div>
        <h2 class="text-3xl font-black tracking-tighter">Fee management</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">Vouchers, payments and every student's fee record.</p>
      </div>
      <nav class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Fee sections">
        @for (t of tabs; track t.link) {
          <a [routerLink]="t.link" routerLinkActive="!bg-indigo-600 !text-white shadow-lg shadow-indigo-600/30" [routerLinkActiveOptions]="{ exact: true }"
             class="shrink-0 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-indigo-500 transition-all">{{ t.label }}</a>
        }
      </nav>
    </div>
    <router-outlet />
  </div>
  `
})
export class FeeShell {
  tabs = [
    { link: '/fee', label: 'Overview' }, { link: '/fee/generate', label: 'Generate vouchers' }, { link: '/fee/vouchers', label: 'Vouchers' },
    { link: '/fee/collect', label: 'Collect fee' }, { link: '/fee/defaulters', label: 'Defaulters' }, { link: '/fee/forecast', label: 'Forecast' },
    { link: '/fee/structure', label: 'Fee structure' }, { link: '/fee/categories', label: 'Category fees' }, { link: '/fee/settings', label: 'Settings' }
  ];
}
