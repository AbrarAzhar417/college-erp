import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ClassInfo } from '../core/models';
import { Award, ExamItem } from './exam';

export const AWARD_TYPES: Record<string, string> = { position: 'Section positions', class_position: 'Class positions', subject: 'Subject toppers', improved: 'Most improved', distinction: 'Distinction', attendance: 'Perfect attendance' };

@Component({
  selector: 'app-exam-awards',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <div><h3 class="text-xl font-black tracking-tight">Awards and honour roll</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Choose one exam, or tick several tests to rank students on all of them together (only tests whose marks are complete are counted).</p></div>
      <div class="flex flex-wrap gap-2">@for (e of exams(); track e.id) { <button type="button" (click)="toggleExam(e.id)" class="px-4 py-2 rounded-xl text-xs font-black transition-all" [class]="picked().has(e.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ e.name }}</button> }</div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl">
        <select class="field" aria-label="Class" [ngModel]="classId()" (ngModelChange)="setClass($event)"><option [ngValue]="null">All classes</option>@for (c of classList(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
        <select class="field" aria-label="Section" [ngModel]="sectionId()" (ngModelChange)="sectionId.set($event)" [disabled]="!classId()"><option [ngValue]="null">All sections</option>@for (s of secs(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }</select>
        <button type="button" class="btn-primary" (click)="load()" [disabled]="!picked().size">Find winners</button>
      </div>
    </section>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (loaded()) {
      <div class="flex flex-wrap items-center gap-2">
        @for (t of typeKeys(); track t) { <button type="button" (click)="toggleType(t)" class="px-4 py-2 rounded-xl text-xs font-black transition-all" [class]="types().has(t) ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ label(t) }} ({{ count(t) }})</button> }
        <a class="btn-primary !py-2.5 ml-auto" [routerLink]="['/exams/print/certificates']" [queryParams]="pq()">Print certificates ({{ shown().length }})</a>
        <a class="btn-ghost !py-2.5" [routerLink]="['/exams/print/honour']" [queryParams]="pq()">Print honour roll</a>
      </div>
      @for (g of groups(); track g.type) {
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <h4 class="text-lg font-black mb-3">{{ label(g.type) }}</h4>
          <div class="overflow-x-auto"><table class="w-full text-left text-sm"><tbody>@for (a of g.items; track $index) {
            <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 pr-4 text-xs font-black text-indigo-600 dark:text-indigo-300 whitespace-nowrap">{{ a.title }}</td><td class="py-2 pr-4 font-black whitespace-nowrap">{{ a.name }}<span class="block text-[11px] font-bold text-slate-400">S/O {{ a.father_name }}</span></td><td class="py-2 pr-4 whitespace-nowrap">{{ a.class_name }}-{{ a.section_name }} · Roll {{ a.roll_no ?? '-' }}</td><td class="py-2 text-right font-bold text-slate-500">{{ a.detail }}</td></tr> }</tbody></table></div>
        </section>
      }
      @if (!entries().length) { <p class="text-sm font-bold text-slate-400">No winners found. Check that marks are entered for every subject of the chosen exam.</p> }
    }
  </div>
  `
})
export class ExamAwards {
  private api = inject(Api);
  label = (t: string) => AWARD_TYPES[t] ?? t;
  exams = signal<ExamItem[]>([]); classList = signal<ClassInfo[]>([]);
  picked = signal<Set<number>>(new Set()); classId = signal<number | null>(null); sectionId = signal<number | null>(null);
  entries = signal<Award[]>([]); types = signal<Set<string>>(new Set()); loaded = signal(false); error = signal('');
  secs = computed(() => this.classList().find(c => c.id === this.classId())?.sections ?? []);
  typeKeys = computed(() => Object.keys(AWARD_TYPES).filter(t => this.entries().some(e => e.type === t)));
  shown = computed(() => this.entries().filter(e => this.types().has(e.type)));
  groups = computed(() => this.typeKeys().filter(t => this.types().has(t)).map(type => ({ type, items: this.entries().filter(e => e.type === type) })));
  count = (t: string) => this.entries().filter(e => e.type === t).length;
  pq = () => ({ examIds: [...this.picked()].join(','), classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined, types: [...this.types()].join(',') });

  constructor() {
    this.api.get<ExamItem[]>('/exam/exams').subscribe(e => { this.exams.set(e); const first = e.find(x => x.entered >= x.expected && x.expected > 0) ?? e.find(x => x.entered > 0); if (first) this.picked.set(new Set([first.id])); });
    this.api.get<ClassInfo[]>('/classes').subscribe(c => this.classList.set(c));
  }
  toggleExam(id: number) { const s = new Set(this.picked()); s.has(id) ? s.delete(id) : s.add(id); this.picked.set(s); }
  toggleType(t: string) { const s = new Set(this.types()); s.has(t) ? s.delete(t) : s.add(t); this.types.set(s); }
  setClass(id: number | null) { this.classId.set(id); this.sectionId.set(null); }
  load() {
    this.error.set('');
    this.api.get<{ entries: Award[] }>('/exam/awards', { examIds: [...this.picked()].join(','), classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined }).subscribe({
      next: r => { this.entries.set(r.entries); this.types.set(new Set(r.entries.map(e => e.type))); this.loaded.set(true); }, error: e => this.error.set(errorText(e)) });
  }
}
