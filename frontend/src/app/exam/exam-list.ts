import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { ExamCfg, ExamItem, KIND_ORDER, STATUS_LABEL, fmtDate } from './exam';

@Component({
  selector: 'app-exam-list',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-8">
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div class="flex items-start justify-between gap-4">
        <div><h3 class="text-xl font-black tracking-tight">Create an exam</h3>
          <p class="text-sm font-bold text-slate-400 mt-1">One paper is made for every subject of every section, with its subject teacher. Teachers then set their test date and enter marks.</p></div>
        <button type="button" class="btn-ghost" (click)="showForm.set(!showForm())">{{ showForm() ? 'Close' : 'New exam' }}</button>
      </div>
      @if (showForm() && cfg(); as c) {
        <form (ngSubmit)="create()" class="space-y-5">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div><label class="label" for="ek">Kind of exam</label>
              <select id="ek" name="ek" class="field" [ngModel]="f.kind" (ngModelChange)="setKind($event)">@for (k of kinds(); track k) { <option [value]="k">{{ c.kinds[k].label }}</option> }</select></div>
            <div><label class="label" for="en">Name (empty = automatic, like Test 4)</label><input id="en" name="en" class="field" [(ngModel)]="f.name"></div>
            <div><label class="label" for="es">Session</label><input id="es" name="es" class="field" [(ngModel)]="f.session"></div>
            <div><label class="label" for="em">Maximum marks per subject</label><input id="em" name="em" type="number" min="1" max="500" class="field" [(ngModel)]="f.max_marks"></div>
            <div><label class="label" for="ep">Pass percentage</label><input id="ep" name="ep" type="number" min="1" max="100" class="field" [(ngModel)]="f.pass_percent"></div>
            <div><label class="label" for="er">A student fails when</label>
              <select id="er" name="er" class="field" [(ngModel)]="f.pass_rule"><option value="subjects">Any subject is below the pass marks</option><option value="total">The total percentage is below the pass percentage</option></select></div>
            <div><label class="label" for="ef">First paper date</label><input id="ef" name="ef" type="date" class="field" [(ngModel)]="f.start_date"></div>
            <div><label class="label" for="et">Last paper date</label><input id="et" name="et" type="date" class="field" [(ngModel)]="f.end_date"></div>
          </div>
          <div><span class="label !ml-0">Classes</span>
            <div class="flex flex-wrap gap-2">@for (cl of classes(); track cl.id) { <button type="button" (click)="toggle(cl.id)" class="px-4 py-2 rounded-xl text-xs font-black transition-all" [class]="picked().has(cl.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ cl.name }}</button> }</div></div>
          @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
          <button class="btn-primary" type="submit">Create exam</button>
        </form>
      }
    </section>

    @if (error() && !showForm()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      @for (e of exams(); track e.id) {
        <section class="bg-white dark:bg-slate-900/40 p-7 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div><h3 class="text-xl font-black tracking-tight">{{ e.name }}</h3>
              <p class="text-xs font-bold text-slate-400 mt-1">{{ cfg()?.kinds?.[e.kind]?.label }} · {{ e.session }}{{ e.start_date ? ' · ' + d(e.start_date) + (e.end_date ? ' to ' + d(e.end_date) : '') : '' }}</p></div>
            <span class="px-3 py-1.5 rounded-lg text-[11px] font-black whitespace-nowrap" [class]="e.status === 'open' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : e.status === 'locked' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'">{{ st(e.status) }}</span>
          </div>
          <p class="text-sm font-bold text-slate-500">{{ e.classes.join(', ') }}</p>
          <div>
            <div class="flex justify-between text-xs font-black mb-1.5"><span>Marks entered</span><span>{{ e.entered }} / {{ e.expected }} ({{ pct(e) }}%)</span></div>
            <div class="h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full bg-indigo-600 transition-all" [style.width.%]="pct(e)"></div></div>
          </div>
          <div class="flex flex-wrap gap-2 pt-1">
            <a [routerLink]="['/exams/detail', e.id]" class="btn-primary !py-3">Open</a>
            @if (e.status === 'open') { <button type="button" class="btn-ghost !py-3" (click)="setStatus(e, 'locked')">Lock marks entry</button> }
            @if (e.status === 'locked') { <button type="button" class="btn-ghost !py-3" (click)="setStatus(e, 'published')">Publish results</button><button type="button" class="btn-ghost !py-3" (click)="setStatus(e, 'open')">Re-open</button> }
            @if (e.status === 'published') { <button type="button" class="btn-ghost !py-3" (click)="setStatus(e, 'locked')">Un-publish</button> }
            @if (auth.isLeadership() && !e.entered) { <button type="button" class="btn-ghost !py-3 !text-rose-500" (click)="remove(e)">Delete</button> }
          </div>
        </section>
      }
    </div>
    @if (!exams().length) { <p class="text-sm font-bold text-slate-400">No exams yet. Create the first one above.</p> }
  </div>
  `
})
export class ExamList {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  d = fmtDate; st = (s: string) => STATUS_LABEL[s];
  cfg = signal<ExamCfg | null>(null);
  exams = signal<ExamItem[]>([]);
  classes = signal<ClassInfo[]>([]);
  picked = signal<Set<number>>(new Set());
  showForm = signal(false); error = signal('');
  f = { kind: 'test', name: '', session: '', max_marks: 25, pass_percent: 33, pass_rule: 'subjects', start_date: '', end_date: '' };
  kinds = computed(() => KIND_ORDER.filter(k => this.cfg()?.kinds[k]));
  pct = (e: ExamItem) => (e.expected ? Math.round((e.entered / e.expected) * 100) : 0);

  constructor() {
    this.api.get<ExamCfg>('/exam/config').subscribe(c => { this.cfg.set(c); this.f.session = c.session; this.setKind('test'); });
    this.api.get<ClassInfo[]>('/classes').subscribe(c => { this.classes.set(c); this.setKind(this.f.kind); });
    this.load();
  }
  load() { this.api.get<ExamItem[]>('/exam/exams').subscribe({ next: e => this.exams.set(e), error: e => this.error.set(errorText(e)) }); }
  setKind(k: string) {
    this.f.kind = k; const c = this.cfg(); if (c) this.f.max_marks = c.kinds[k].max;
    const board = k === 'sendup' || k === 'preboard' || k === 'board';
    this.picked.set(new Set(this.classes().filter(cl => !board || c?.boardClasses.includes(cl.grade)).map(cl => cl.id)));
  }
  toggle(id: number) { const s = new Set(this.picked()); s.has(id) ? s.delete(id) : s.add(id); this.picked.set(s); }
  create() {
    this.error.set('');
    this.api.post<{ id: number; papers: number }>('/exam/exams', { ...this.f, class_ids: [...this.picked()] }).subscribe({
      next: r => { this.toast.show(`Exam created with ${r.papers} papers.`); this.showForm.set(false); this.f.name = ''; this.load(); },
      error: e => this.error.set(errorText(e))
    });
  }
  setStatus(e: ExamItem, status: string) {
    const msg = status === 'published' ? 'Publish the results? Teachers cannot change marks after this.' : status === 'locked' ? 'Close marks entry for teachers?' : '';
    if (msg && !confirm(msg)) return;
    this.api.put(`/exam/exams/${e.id}`, { status }).subscribe({ next: () => { this.toast.show('Saved.'); this.load(); }, error: x => this.toast.show(errorText(x), 'error') });
  }
  remove(e: ExamItem) { if (!confirm(`Delete ${e.name}?`)) return; this.api.delete(`/exam/exams/${e.id}`).subscribe({ next: () => { this.toast.show('Deleted.'); this.load(); }, error: x => this.toast.show(errorText(x), 'error') }); }
}
