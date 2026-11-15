import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { saveText } from '../core/files';
import { ToastService } from '../core/toast';
import { DAY_NAMES, Slot, TtData } from './tt';

@Component({
  selector: 'app-tt-master',
  imports: [FormsModule],
  template: `
  <div class="space-y-6">
    <div class="no-print flex flex-wrap items-center gap-3">
      <div class="flex gap-2">
        @for (m of modes; track m.key) {
          <button type="button" (click)="mode.set(m.key)" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest" [class]="mode() === m.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ m.label }}</button>
        }
      </div>
      <button type="button" class="btn-ghost ml-auto" (click)="csv()">Download CSV</button>
      <button type="button" class="btn-primary" (click)="print()">Print (landscape)</button>
    </div>
    @if (!rows().length) { <p class="text-sm font-bold text-slate-400">No timetable is published in this wing yet.</p> }
    @for (d of days(); track d) {
      <section class="break-inside-avoid-page">
        <h3 class="font-black text-lg mb-2">{{ dayName(d) }} <span class="text-sm font-bold text-slate-400">— {{ tt.wing() === 'school' ? 'School' : 'College' }} wing, {{ mode() === 'section' ? 'by class' : 'by teacher' }}</span></h3>
        <div class="overflow-x-auto"><table class="w-full text-xs border-collapse">
          <thead><tr><th class="border border-slate-300 dark:border-slate-700 px-2 py-1 text-left">{{ mode() === 'section' ? 'Class' : 'Teacher' }}</th>
            @for (p of periodNums(); track p) { <th class="border border-slate-300 dark:border-slate-700 px-2 py-1">{{ p + 1 }}<br><span class="font-bold text-slate-400">{{ tt.periods()[p]?.start }}</span></th> }</tr></thead>
          <tbody>@for (r of keys(); track r.key) {
            <tr><td class="border border-slate-300 dark:border-slate-700 px-2 py-1 font-black whitespace-nowrap">{{ r.label }}</td>
              @for (p of periodNums(); track p) { <td class="border border-slate-300 dark:border-slate-700 px-2 py-1 text-center">{{ cell(r.key, d, p) }}</td> }</tr> }</tbody>
        </table></div>
      </section>
    }
  </div>
  `
})
export class TtMaster {
  private api = inject(Api);
  private toast = inject(ToastService);
  tt = inject(TtData);
  modes = [{ key: 'section' as const, label: 'Classes' }, { key: 'teacher' as const, label: 'Teachers' }];
  mode = signal<'section' | 'teacher'>('section');
  all = signal<Slot[]>([]);
  rows = computed(() => this.all().filter(s => this.tt.inWing(s.class_id)));
  days = computed(() => this.tt.settings()?.days ?? []);
  periodNums = computed(() => Array.from({ length: this.tt.settings()?.periodCount ?? 0 }, (_, i) => i));
  dayName = (d: number) => DAY_NAMES[d];

  private map = computed(() => {
    const m = new Map<string, string>();
    for (const s of this.rows()) {
      const key = this.mode() === 'section' ? `s${s.section_id}` : `t${s.teacher_id}`;
      const text = this.mode() === 'section' ? `${s.subject_name}\n${s.teacher_name}` : `${s.subject_name}\n${s.grade}-${s.section_name}`;
      const k = `${key}|${s.day}|${s.period}`; m.set(k, m.has(k) ? m.get(k) + ' / ' + text : text);
    }
    return m;
  });
  keys = computed(() => {
    const seen = new Map<string, string>();
    for (const s of this.rows()) {
      if (this.mode() === 'section') seen.set(`s${s.section_id}`, `${s.grade}-${s.section_name}`); else seen.set(`t${s.teacher_id}`, s.teacher_name);
    }
    return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  });
  cell(key: string, d: number, p: number) { return (this.map().get(`${key}|${d}|${p}`) ?? '').replace('\n', ' · '); }

  constructor() { this.api.get<Slot[]>('/timetable/slots').subscribe({ next: r => this.all.set(r), error: e => this.toast.show(errorText(e), 'error') }); }

  csv() {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const out = [['Day', this.mode() === 'section' ? 'Class' : 'Teacher', ...this.periodNums().map(p => 'P' + (p + 1))].map(q).join(',')];
    for (const d of this.days()) for (const r of this.keys()) out.push([DAY_NAMES[d], r.label, ...this.periodNums().map(p => this.cell(r.key, d, p))].map(q).join(','));
    saveText(`master-timetable-${this.tt.wing()}-${this.mode()}.csv`, '﻿' + out.join('\n'));
  }
  print() {
    const st = document.createElement('style'); st.textContent = '@page{size:A4 landscape;margin:8mm}'; document.head.appendChild(st);
    window.print(); setTimeout(() => st.remove(), 1000);
  }
}
