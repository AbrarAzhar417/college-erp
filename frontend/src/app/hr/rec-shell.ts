import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-rec-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <div class="space-y-6">
    <nav class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Recruitment sections">
      @for (t of tabs; track t.link) {
        <a [routerLink]="t.link" routerLinkActive="!bg-slate-900 !text-white dark:!bg-white dark:!text-slate-900" [routerLinkActiveOptions]="{ exact: t.exact }"
           class="shrink-0 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-500 transition-all">{{ t.label }}</a>
      }
    </nav>
    <router-outlet />
  </div>
  `
})
export class RecShell {
  tabs = [{ link: '/hr/recruit', label: 'Job posts', exact: true }, { link: '/hr/recruit/candidates', label: 'Candidates & screening', exact: false }, { link: '/hr/recruit/interviews', label: 'Interviews', exact: false }, { link: '/hr/recruit/settings', label: 'Email, SMS & marking', exact: false }];
}
