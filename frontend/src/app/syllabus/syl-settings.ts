import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { SylCfg, monthName } from './syl';

@Component({
  selector: 'app-syl-settings',
  imports: [FormsModule],
  template: `
  <form (ngSubmit)="save()" class="max-w-2xl bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
    <div><h3 class="text-xl font-black tracking-tight">Academic session</h3>
      <p class="text-sm font-bold text-slate-400 mt-1">The weeks of the syllabus plan and the academic calendar run from the first month to the last month of the session. The session name ({{ cfg()?.session }}) comes from Examination settings.</p></div>
    @if (!auth.isLeadership()) { <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm font-bold">Only the director or principal can change this.</p> }
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5"><div><label class="label" for="s1">First day of the session</label><input id="s1" name="s1" type="date" class="field" [(ngModel)]="start" [disabled]="!auth.isLeadership()"></div>
      <div><label class="label" for="s2">Last day of the session</label><input id="s2" name="s2" type="date" class="field" [(ngModel)]="end" [disabled]="!auth.isLeadership()"></div></div>
    @if (cfg(); as c) { <p class="text-xs font-bold text-slate-400">{{ c.months.length }} months: {{ mn(c.months[0]) }} to {{ mn(c.months[c.months.length - 1]) }} · {{ c.months.length * 4 }} teaching weeks. Plans already made keep their topics if you shorten the session.</p> }
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    <button class="btn-primary" type="submit" [disabled]="!auth.isLeadership()">Save</button>
  </form>
  `
})
export class SylSettings {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  mn = monthName;
  cfg = signal<SylCfg | null>(null); error = signal(''); start = ''; end = '';
  constructor() { this.api.get<SylCfg>('/syllabus/config').subscribe(c => { this.cfg.set(c); this.start = c.start; this.end = c.end; }); }
  save() {
    this.error.set('');
    this.api.put('/syllabus/config', { start: this.start, end: this.end }).subscribe({ next: () => { this.toast.show('Saved.'); this.api.get<SylCfg>('/syllabus/config').subscribe(c => this.cfg.set(c)); }, error: e => this.error.set(errorText(e)) });
  }
}
