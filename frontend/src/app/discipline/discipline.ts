import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { DiscRecord, KIND_LABEL, KIND_STYLE } from './discipline-panel';

type Row = DiscRecord & { student_name: string; reg_no: string; class_name: string };
interface Watch { student_id: number; name: string; reg_no: string; class_name: string; warnings: number }

@Component({
  selector: 'app-discipline',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Discipline & Behaviour</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Warnings, summons and notes of all students. To add a record, open the student and use the Behaviour tab.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (watch().length) {
      <section class="p-5 rounded-3xl bg-amber-500/10 border border-amber-500/20"><h3 class="font-black text-amber-700 dark:text-amber-300 mb-2">Three or more warnings, parents not yet called</h3>
        @for (w of watch(); track w.student_id) { <a [routerLink]="['/students', w.student_id]" class="block py-1 text-sm font-bold hover:underline">{{ w.name }} · {{ w.class_name }} · {{ w.warnings }} warnings</a> }</section>
    }
    <div class="flex flex-wrap gap-3 items-end">
      <div><label class="label" for="d-kind">Type</label><select id="d-kind" class="field" [ngModel]="kind()" (ngModelChange)="kind.set($event); load()"><option value="">All</option>@for (k of kinds; track k) { <option [value]="k">{{ label[k] }}</option> }</select></div>
      <div><label class="label" for="d-st">Status</label><select id="d-st" class="field" [ngModel]="status()" (ngModelChange)="status.set($event); load()"><option value="">All</option><option value="open">Open (waiting)</option><option value="closed">Closed</option></select></div>
      <div><label class="label" for="d-q">Student</label><input id="d-q" class="field" placeholder="name or reg no" [ngModel]="q()" (ngModelChange)="q.set($event)" (keyup.enter)="load()"></div>
      <button type="button" class="btn-ghost" (click)="load()">Search</button>
    </div>
    <div class="space-y-3">
      @for (r of rows(); track r.id) {
        <a [routerLink]="['/students', r.student_id]" class="block p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
          <div class="flex flex-wrap items-center gap-2"><span class="px-2 py-1 rounded-lg text-[11px] font-black" [class]="style[r.kind]">{{ label[r.kind] }}</span>
            <b class="text-sm">{{ r.student_name }}</b><span class="text-xs font-bold text-slate-400">{{ r.class_name }} · {{ r.date }}{{ r.category ? ' · ' + r.category : '' }}</span>
            @if (r.kind === 'summon') { <span class="ml-auto text-xs font-black" [class.text-amber-600]="r.status === 'open'">{{ r.status === 'open' ? 'Waiting · ' + r.meet_date : 'Closed' }}</span> }</div>
          <p class="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300 line-clamp-2">{{ r.text }}</p></a>
      } @empty { <p class="p-8 text-center font-bold text-slate-400">No records.</p> }
    </div>
  </div>
  `
})
export class Discipline {
  private api = inject(Api); label = KIND_LABEL; style = KIND_STYLE; kinds = ['note', 'praise', 'warning', 'summon', 'suspension'];
  rows = signal<Row[]>([]); watch = signal<Watch[]>([]); error = signal(''); kind = signal(''); status = signal(''); q = signal('');
  constructor() { this.load(); this.api.get<Watch[]>('/discipline/watch').subscribe({ next: w => this.watch.set(w), error: () => {} }); }
  load() { this.api.get<Row[]>('/discipline', { kind: this.kind() || undefined, status: this.status() || undefined, q: this.q() || undefined }).subscribe({ next: r => { this.rows.set(r); this.error.set(''); }, error: e => this.error.set(errorText(e)) }); }
}
