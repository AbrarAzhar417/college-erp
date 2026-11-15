import { Component, computed, inject, signal } from '@angular/core';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { DAY_NAMES, Slot, Teacher, TtData } from './tt';

@Component({
  selector: 'app-tt-free',
  template: `
  <div class="space-y-6">
    <div class="no-print flex flex-wrap items-center gap-3">
      <p class="text-sm font-bold text-slate-500 max-w-2xl">For each teacher, the periods in which they have no lesson, day by day. Use it to give extra duty (invigilation, substitution, supervision) to the people who have time. Gaps between two lessons are shown in bold.</p>
      <button type="button" class="btn-ghost ml-auto" (click)="csv()">Download CSV</button><button type="button" class="btn-primary" (click)="print()">Print (landscape)</button>
    </div>
    @if (!rows().length) { <p class="text-sm font-bold text-slate-400">No timetable is published in this wing yet.</p> }
    @else {
      <div class="overflow-x-auto"><table class="w-full text-xs border-collapse">
        <thead><tr><th class="border border-slate-300 dark:border-slate-700 px-2 py-2 text-left">Teacher</th>
          @for (d of days(); track d) { <th class="border border-slate-300 dark:border-slate-700 px-2 py-2">{{ dayName(d) }}</th> }
          <th class="border border-slate-300 dark:border-slate-700 px-2 py-2">Free / week</th></tr></thead>
        <tbody>@for (r of rows(); track r.id) {
          <tr><td class="border border-slate-300 dark:border-slate-700 px-2 py-1.5 font-black whitespace-nowrap">{{ r.name }}</td>
            @for (c of r.cells; track $index) { <td class="border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-center">@for (p of c; track p.n) { <span [class.font-black]="p.gap" [class.text-amber-600]="p.gap" class="mr-1">{{ p.n + 1 }}</span> } @empty { <span class="text-slate-400">—</span> }</td> }
            <td class="border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-center font-black">{{ r.free }}</td></tr> }</tbody>
      </table></div>
      <p class="text-[11px] font-bold text-slate-400">Numbers are period numbers. A teacher whose day has no lessons at all is shown with every period free.</p>
    }
  </div>
  `
})
export class TtFree {
  private api = inject(Api);
  private toast = inject(ToastService);
  tt = inject(TtData);
  slots = signal<Slot[]>([]); teachers = signal<Teacher[]>([]);
  days = computed(() => this.tt.settings()?.days ?? []);
  dayName = (d: number) => DAY_NAMES[d];
  rows = computed(() => {
    const P = this.tt.settings()?.periodCount ?? 0, days = this.days();
    const mine = this.slots().filter(s => this.tt.inWing(s.class_id));
    const byT = new Map<number, Set<string>>(); for (const s of mine) (byT.get(s.teacher_id) ?? byT.set(s.teacher_id, new Set()).get(s.teacher_id)!).add(`${s.day}-${s.period}`);
    return this.teachers().filter(t => byT.has(t.id)).map(t => {
      const used = byT.get(t.id)!; let free = 0;
      const cells = days.map(d => {
        const taken = Array.from({ length: P }, (_, p) => used.has(`${d}-${p}`)), first = taken.indexOf(true), last = taken.lastIndexOf(true);
        const out: { n: number; gap: boolean }[] = [];
        for (let p = 0; p < P; p++) if (!taken[p]) out.push({ n: p, gap: first >= 0 && p > first && p < last });
        free += out.length; return out;
      });
      return { id: t.id, name: t.name, cells, free };
    }).sort((a, b) => b.free - a.free || a.name.localeCompare(b.name));
  });

  constructor() {
    this.api.get<Slot[]>('/timetable/slots').subscribe({ next: r => this.slots.set(r), error: e => this.toast.show(errorText(e), 'error') });
    this.api.get<Teacher[]>('/timetable/teachers').subscribe({ next: r => this.teachers.set(r) });
  }
  csv() {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Teacher', ...this.days().map(d => DAY_NAMES[d]), 'Free per week'].map(q).join(',')];
    for (const r of this.rows()) lines.push([r.name, ...r.cells.map(c => c.map(p => p.n + 1).join(' ')), r.free].map(q).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })); a.download = `free-periods-${this.tt.wing()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  print() { const st = document.createElement('style'); st.textContent = '@page{size:A4 landscape;margin:8mm}'; document.head.appendChild(st); window.print(); setTimeout(() => st.remove(), 1000); }
}
