import { Component, inject, signal } from '@angular/core';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { TtData } from './tt';

interface Quality {
  wing: string; placed: number; score: number; grade: string;
  metrics: { teacherGaps: number; longRuns: number; sectionGaps: number; backToBack: number; heavyLate: number; unplaced: number; scienceRuns: number };
  fairness: { target: number; average: number; lowest: number; highest: number; spread: number; aboveTarget: number; belowTarget: number; teachers: { id: number; name: string; load: number; diff: number }[] };
  teachers: { id: number; name: string; load: number; maxPerWeek: number; busiestDay: number; maxPerDay: number; gaps: number; longRuns: number; over: boolean }[];
  sections: { id: number; label: string; planned: number; placed: number; free: number; gaps: number }[];
  classTeacher: { label: string; teacher: string; days: number; of: number }[];
  issues: string[];
}

@Component({
  selector: 'app-tt-quality',
  template: `
  <div class="space-y-6">
    @if (q(); as r) {
      @if (!r.placed) {
        <p class="text-sm font-bold text-slate-400">There is no published timetable in this wing yet. Make one in "Auto timetable" first.</p>
      } @else {
        <div class="grid md:grid-cols-3 gap-4">
          <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 p-6 bg-white dark:bg-slate-900/40">
            <p class="text-[11px] font-black uppercase tracking-widest text-slate-400">Quality score</p>
            <p class="text-6xl font-black tracking-tighter mt-2" [class]="r.score >= 75 ? 'text-emerald-600' : r.score >= 55 ? 'text-amber-600' : 'text-rose-600'">{{ r.score }}<span class="text-2xl text-slate-400">/100</span></p>
            <p class="text-sm font-black mt-1">{{ r.grade }}</p>
            <p class="text-xs font-bold text-slate-400 mt-2">A rough guide made from the counts on the right. It helps you compare two timetables; it is not a verdict.</p>
          </div>
          <div class="md:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
            @for (m of metricList(r); track m.label) {
              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900/40">
                <p class="text-2xl font-black" [class.text-rose-600]="m.bad && m.value > 0">{{ m.value }}</p>
                <p class="text-xs font-black">{{ m.label }}</p><p class="text-[11px] font-bold text-slate-400">{{ m.hint }}</p>
              </div>
            }
          </div>
        </div>

        <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 p-6 bg-white dark:bg-slate-900/40">
          <h3 class="font-black">Balance and fairness</h3>
          <p class="text-xs font-bold text-slate-400 mb-4">Target: {{ r.fairness.target }} periods a week for every teacher. Average {{ r.fairness.average }}, lowest {{ r.fairness.lowest }}, highest {{ r.fairness.highest }}, spread {{ r.fairness.spread }}. {{ r.fairness.aboveTarget }} above and {{ r.fairness.belowTarget }} below the target.</p>
          <div class="space-y-1.5">
            @for (t of r.fairness.teachers; track t.id) {
              <div class="flex items-center gap-3 text-xs font-bold">
                <span class="w-40 shrink-0 truncate">{{ t.name }}</span>
                <div class="flex-1 h-3 rounded-full bg-slate-500/10 relative overflow-hidden" [attr.aria-label]="t.name + ' ' + t.load + ' periods'">
                  <div class="h-full rounded-full" [style.width.%]="bar(t.load, r.fairness)" [class]="t.diff === 0 ? 'bg-emerald-500' : (t.diff > 0 ? 'bg-rose-500' : 'bg-amber-500')"></div>
                  <div class="absolute top-0 bottom-0 w-0.5 bg-slate-900 dark:bg-white" [style.left.%]="bar(r.fairness.target, r.fairness)"></div>
                </div>
                <span class="w-20 text-right" [class.text-rose-600]="t.diff > 0">{{ t.load }} ({{ t.diff > 0 ? '+' : '' }}{{ t.diff }})</span>
              </div>
            }
          </div>
        </div>

        <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 p-6 bg-white dark:bg-slate-900/40">
          <h3 class="font-black mb-3">Things to look at</h3>
          @if (r.issues.length) { <ul class="space-y-1 text-sm font-bold text-amber-700 dark:text-amber-400 list-disc pl-5">@for (i of r.issues; track i) { <li>{{ i }}</li> }</ul> }
          @else { <p class="text-sm font-bold text-emerald-600">Nothing found.</p> }
        </div>

        <div class="grid lg:grid-cols-2 gap-6">
          <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-x-auto">
            <h3 class="font-black p-6 pb-2">Teacher load</h3>
            <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest">
              <th class="px-6 py-3">Teacher</th><th class="px-3 py-3">Week</th><th class="px-3 py-3">Busiest day</th><th class="px-3 py-3">Free gaps</th></tr></thead>
              <tbody>@for (t of r.teachers; track t.id) {
                <tr class="border-t border-slate-100 dark:border-slate-800/60">
                  <td class="px-6 py-2 font-black">{{ t.name }}</td>
                  <td class="px-3 py-2 font-bold" [class.text-rose-600]="t.load > t.maxPerWeek">{{ t.load }} / {{ t.maxPerWeek }}</td>
                  <td class="px-3 py-2 font-bold" [class.text-rose-600]="t.busiestDay > t.maxPerDay">{{ t.busiestDay }} / {{ t.maxPerDay }}</td>
                  <td class="px-3 py-2 font-bold">{{ t.gaps }}</td></tr> }</tbody></table>
          </div>
          <div class="space-y-6">
            <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-x-auto">
              <h3 class="font-black p-6 pb-2">Sections</h3>
              <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                <th class="px-6 py-3">Section</th><th class="px-3 py-3">Placed</th><th class="px-3 py-3">Free periods</th><th class="px-3 py-3">Gaps</th></tr></thead>
                <tbody>@for (s of r.sections; track s.id) {
                  <tr class="border-t border-slate-100 dark:border-slate-800/60"><td class="px-6 py-2 font-black">{{ s.label }}</td>
                    <td class="px-3 py-2 font-bold" [class.text-rose-600]="s.placed < s.planned">{{ s.placed }} / {{ s.planned }}</td><td class="px-3 py-2 font-bold">{{ s.free }}</td><td class="px-3 py-2 font-bold">{{ s.gaps }}</td></tr> }</tbody></table>
            </div>
            @if (r.classTeacher.length) {
              <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-x-auto">
                <h3 class="font-black p-6 pb-2">Class teacher in period 1</h3>
                <table class="w-full text-left text-sm"><tbody>@for (c of r.classTeacher; track c.label) {
                  <tr class="border-t border-slate-100 dark:border-slate-800/60"><td class="px-6 py-2 font-black">{{ c.label }}</td><td class="px-3 py-2 font-bold">{{ c.teacher }}</td>
                    <td class="px-3 py-2 font-bold" [class.text-rose-600]="c.days < c.of">{{ c.days }} of {{ c.of }} days</td></tr> }</tbody></table>
              </div>
            }
          </div>
        </div>
      }
    } @else { <p class="text-sm font-bold text-slate-400">Loading…</p> }
  </div>
  `
})
export class TtQuality {
  private api = inject(Api);
  private toast = inject(ToastService);
  private tt = inject(TtData);
  q = signal<Quality | null>(null);

  constructor() {
    this.api.get<Quality>('/timetable/quality', { wing: this.tt.wing() }).subscribe({ next: r => this.q.set(r), error: e => this.toast.show(errorText(e), 'error') });
  }

  bar(n: number, f: Quality['fairness']) { return Math.min(100, (n / Math.max(f.highest, f.target, 1)) * 100); }

  metricList(r: Quality) {
    const m = r.metrics;
    return [
      { label: 'Teacher free gaps', value: m.teacherGaps, hint: 'Empty periods between a teacher\'s lessons', bad: false },
      { label: 'Long runs', value: m.longRuns, hint: '4 lessons or more in a row', bad: false },
      { label: 'Section gaps', value: m.sectionGaps, hint: 'Empty periods inside a class day', bad: true },
      { label: 'Same subject back to back', value: m.backToBack, hint: 'Not counting double periods', bad: false },
      { label: 'Heavy subjects late', value: m.heavyLate, hint: 'In the second half of the day', bad: false },
      { label: 'Science run over 2', value: m.scienceRuns, hint: 'More than 2 science lessons in a row', bad: true },
      { label: 'Not placed', value: m.unplaced, hint: 'Planned periods missing', bad: true }
    ];
  }
}
