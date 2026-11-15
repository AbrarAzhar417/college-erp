import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { fmtDate } from './exam';

interface Detail { id: number; name: string; kind: string; session: string; pass_percent: number; pass_rule: string; status: string; start_date: string | null; end_date: string | null; classes: { id: number; name: string; grade: number }[] }
interface DsRow { subject_id: number; subject: string; test_date: string | null; max_marks: number; mixed: boolean }
interface Prog { id: number; section_id: number; class_name: string; section_name: string; subject: string; teacher: string | null; test_date: string | null; max_marks: number; entered: number; total: number }

@Component({
  selector: 'app-exam-detail',
  imports: [FormsModule, RouterLink],
  template: `
  @if (ex(); as e) {
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-3">
      <a routerLink="/exams" class="btn-ghost !py-2.5">All exams</a>
      <h3 class="text-2xl font-black tracking-tight">{{ e.name }}</h3><span class="text-sm font-bold text-slate-400">{{ e.session }} · {{ e.classes.length }} classes</span>
    </div>
    <div class="flex gap-2">@for (t of tabs; track t.key) { <button type="button" (click)="tab.set(t.key)" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all" [class]="tab() === t.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ t.label }}</button> }</div>

    @if (tab() === 'date') {
      <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6 max-w-4xl">
        <div class="flex flex-wrap items-end gap-4">
          <div><label class="label" for="dsc">Class</label><select id="dsc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)">@for (c of e.classes; track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
          <p class="text-sm font-bold text-slate-400 pb-3">Dates and maximum marks set here apply to every section of the class. A subject teacher can still change the date of their own paper.</p>
        </div>
        @for (r of rows(); track r.subject_id) {
          <div class="grid grid-cols-12 gap-3 items-center p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <span class="col-span-12 md:col-span-4 text-sm font-black">{{ r.subject }}@if (r.mixed) { <span class="ml-2 text-[10px] font-black text-amber-600">sections differ</span> }</span>
            <div class="col-span-7 md:col-span-5"><input type="date" class="field !py-2.5" [(ngModel)]="r.test_date" [name]="'d' + r.subject_id" [attr.aria-label]="'Date of ' + r.subject"></div>
            <div class="col-span-5 md:col-span-3"><input type="number" min="1" class="field !py-2.5" [(ngModel)]="r.max_marks" [name]="'m' + r.subject_id" [attr.aria-label]="'Maximum marks of ' + r.subject"></div>
          </div>
        }
        @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="btn-primary" (click)="saveDs()">Save date sheet</button>
          <a [routerLink]="['/exams/print/datesheet']" [queryParams]="{ examId: e.id, classId: classId() }" class="btn-ghost">Print date sheet</a>
        </div>
        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-end gap-4">
          <div><label class="label" for="rsx">Roll number slips for</label><select id="rsx" class="field" [ngModel]="slipSec()" (ngModelChange)="slipSec.set($event)">@for (s of sections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }</select></div>
          <a [routerLink]="['/exams/print/slips']" [queryParams]="{ examId: e.id, sectionId: slipSec() }" class="btn-ghost">Print slips</a>
        </div>
      </section>
    }

    @if (tab() === 'progress') {
      <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <div class="flex flex-wrap items-center gap-4"><p class="text-sm font-bold text-slate-500">{{ done() }} of {{ prog().length }} papers have all marks entered.</p>
          <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="onlyPending()" (ngModelChange)="onlyPending.set($event)"> Show only papers still pending</label></div>
        <div class="overflow-x-auto"><table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="py-3 pr-4">Section</th><th class="py-3 pr-4">Subject</th><th class="py-3 pr-4">Teacher</th><th class="py-3 pr-4">Date</th><th class="py-3 pr-4 text-right">Marks entered</th><th class="py-3"></th></tr></thead>
          <tbody>@for (p of shown(); track p.id) {
            <tr class="border-b border-slate-50 dark:border-slate-800/60">
              <td class="py-2.5 pr-4 font-black whitespace-nowrap">{{ p.class_name }}-{{ p.section_name }}</td><td class="py-2.5 pr-4 font-bold">{{ p.subject }}</td>
              <td class="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{{ p.teacher || 'No teacher' }}</td><td class="py-2.5 pr-4 whitespace-nowrap">{{ p.test_date ? d(p.test_date) : '-' }}</td>
              <td class="py-2.5 pr-4 text-right"><span class="px-2.5 py-1 rounded-lg text-xs font-black" [class]="p.entered >= p.total ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : p.entered ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'">{{ p.entered }}/{{ p.total }}</span></td>
              <td class="py-2.5 text-right"><a [routerLink]="['/exams/marks', p.id]" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10">Open</a></td></tr> }</tbody></table></div>
      </section>
    }

    @if (tab() === 'settings') {
      <form (ngSubmit)="saveSettings()" class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5 max-w-3xl">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div><label class="label" for="sn">Name</label><input id="sn" name="sn" class="field" [(ngModel)]="s.name"></div>
          <div><label class="label" for="sp">Pass percentage</label><input id="sp" name="sp" type="number" min="1" max="100" class="field" [(ngModel)]="s.pass_percent"></div>
          <div class="md:col-span-2"><label class="label" for="sr">A student fails when</label><select id="sr" name="sr" class="field" [(ngModel)]="s.pass_rule"><option value="subjects">Any subject is below the pass marks</option><option value="total">The total percentage is below the pass percentage</option></select></div>
          <div><label class="label" for="sf">First paper date</label><input id="sf" name="sf" type="date" class="field" [(ngModel)]="s.start_date"></div>
          <div><label class="label" for="st">Last paper date</label><input id="st" name="st" type="date" class="field" [(ngModel)]="s.end_date"></div>
        </div>
        <button class="btn-primary" type="submit">Save</button>
        <div class="pt-5 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <p class="text-sm font-bold text-slate-500">Changed a teacher or a subject, or want to add classes? Update the papers:</p>
          <div class="flex flex-wrap gap-2">@for (c of allClasses(); track c.id) { <button type="button" (click)="toggleAdd(c.id)" class="px-3 py-2 rounded-xl text-xs font-black" [class]="add().has(c.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ c.name }}</button> }</div>
          <button type="button" class="btn-ghost" (click)="sync()">Update papers</button>
        </div>
      </form>
    }
  </div>
  }
  `
})
export class ExamDetail {
  private api = inject(Api);
  private toast = inject(ToastService);
  d = fmtDate;
  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => Number(p.get('id')))));
  tabs = [{ key: 'date', label: 'Date sheet' }, { key: 'progress', label: 'Marks progress' }, { key: 'settings', label: 'Settings' }] as const;
  tab = signal<'date' | 'progress' | 'settings'>('date');
  ex = signal<Detail | null>(null); classId = signal<number | null>(null);
  rows = signal<DsRow[]>([]); prog = signal<Prog[]>([]); onlyPending = signal(false);
  allClasses = signal<ClassInfo[]>([]); add = signal<Set<number>>(new Set()); slipSec = signal<number | null>(null);
  s = { name: '', pass_percent: 33, pass_rule: 'subjects', start_date: '', end_date: '' };
  error = signal('');
  sections = computed(() => this.allClasses().find(c => c.id === this.classId())?.sections ?? []);
  done = computed(() => this.prog().filter(p => p.entered >= p.total && p.total > 0).length);
  shown = computed(() => this.prog().filter(p => !this.onlyPending() || p.entered < p.total));

  constructor() {
    this.api.get<ClassInfo[]>('/classes').subscribe(c => this.allClasses.set(c));
    this.api.get<Detail>(`/exam/exams/${this.id()}`).subscribe(e => {
      this.ex.set(e); this.s = { name: e.name, pass_percent: e.pass_percent, pass_rule: e.pass_rule, start_date: e.start_date ?? '', end_date: e.end_date ?? '' };
      if (e.classes.length) this.setClass(e.classes[0].id);
    });
    this.loadProg();
  }
  setClass(id: number) { this.classId.set(id); this.slipSec.set(this.allClasses().find(c => c.id === id)?.sections[0]?.id ?? null); this.api.get<{ rows: DsRow[] }>(`/exam/exams/${this.id()}/datesheet`, { classId: id }).subscribe(r => this.rows.set(r.rows)); }
  loadProg() { this.api.get<Prog[]>(`/exam/exams/${this.id()}/progress`).subscribe(p => this.prog.set(p)); }
  saveDs() {
    this.error.set('');
    this.api.put(`/exam/exams/${this.id()}/datesheet`, { class_id: this.classId(), rows: this.rows().map(r => ({ subject_id: r.subject_id, test_date: r.test_date, max_marks: r.max_marks })) }).subscribe({
      next: () => { this.toast.show('Date sheet saved.'); this.setClass(this.classId()!); this.loadProg(); }, error: e => this.error.set(errorText(e)) });
  }
  saveSettings() { this.api.put(`/exam/exams/${this.id()}`, this.s).subscribe({ next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error') }); }
  toggleAdd(id: number) { const s = new Set(this.add()); s.has(id) ? s.delete(id) : s.add(id); this.add.set(s); }
  sync() { this.api.post<{ added: number; removed: number }>(`/exam/exams/${this.id()}/sync`, { class_ids: [...this.add()] }).subscribe({ next: r => { this.toast.show(`${r.added} papers added, ${r.removed} removed.`); this.loadProg(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
