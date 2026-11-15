import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { fmtDate, today } from './att';

interface Sec { id: number; class_name: string; grade: number; section_name: string; class_teacher: string | null; total: number; marked: number; present: number; late: number; absent: number; leave: number }
interface Dash {
  date: string; working: boolean; holiday: string | null; weekOff: boolean; sections: Sec[];
  totals: { students: number; marked: number; present: number; late: number; absent: number; leave: number };
  periods: { scheduled: number; marked: number; pendingByTeacher: { teacher: string; n: number }[] };
}

@Component({
  selector: 'app-att-dashboard',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-8">
    <div class="flex items-end gap-4"><div><label class="label" for="dd">Date</label><input id="dd" type="date" class="field" [ngModel]="date()" (ngModelChange)="setDate($event)"></div>
      <p class="pb-3 text-sm font-bold text-slate-400">{{ d(date()) }}</p></div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (data(); as x) {
      @if (!x.working) {
        <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ x.holiday ? 'Holiday: ' + x.holiday : 'This is a weekly off.' }} Attendance is not taken today.</p>
      }
      <section class="grid grid-cols-2 xl:grid-cols-5 gap-5">
        @for (k of kpis(); track k.label) {
          <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
            <p class="text-3xl font-black tracking-tighter" [class]="k.cls">{{ k.value }}</p>
            <p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p>
          </div>
        }
      </section>

      @if (pending().length) {
        <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
          <h3 class="text-xl font-black tracking-tight">Registers not taken yet ({{ pending().length }})</h3>
          <div class="flex flex-wrap gap-2">
            @for (s of pending(); track s.id) {
              <a [routerLink]="['/attendance/daily']" [queryParams]="{ sectionId: s.id, date: date() }" class="px-4 py-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs font-black hover:bg-rose-500/20"
                 [title]="s.class_teacher ? 'Class teacher: ' + s.class_teacher : 'No class teacher set'">{{ s.class_name.replace('Class ', '') }}-{{ s.section_name }}</a>
            }
          </div>
        </section>
      }

      <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-8">
        @for (g of groups(); track g.name) {
          <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
            <div class="flex items-center justify-between mb-4"><h3 class="font-black text-lg">{{ g.name }}</h3><span class="text-xs font-black" [class]="g.pct !== null && g.pct < 80 ? 'text-rose-500' : 'text-emerald-600'">{{ g.pct === null ? 'Not marked' : g.pct + '% present' }}</span></div>
            <div class="grid grid-cols-5 gap-2">
              @for (s of g.sections; track s.id) {
                <a [routerLink]="['/attendance/daily']" [queryParams]="{ sectionId: s.id, date: date() }" class="rounded-2xl py-2.5 text-center transition-all hover:scale-105"
                   [class]="s.marked ? 'bg-emerald-500/10' : 'bg-rose-500/10'" [attr.aria-label]="g.name + ' section ' + s.section_name + (s.marked ? ', ' + s.present + ' present of ' + s.total : ', not marked')">
                  <span class="block text-base font-black">{{ s.section_name }}</span>
                  <span class="block text-[11px] font-bold" [class]="s.marked ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-500'">{{ s.marked ? (s.present + s.late) + '/' + s.total : 'Pending' }}</span>
                  @if (s.absent) { <span class="block text-[10px] font-black text-rose-500">{{ s.absent }} absent</span> }
                </a>
              }
            </div>
          </div>
        }
      </section>

      <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-xl font-black tracking-tight">Period attendance</h3>
        <p class="text-sm font-bold text-slate-500">{{ x.periods.marked }} of {{ x.periods.scheduled }} lessons that have started have attendance.</p>
        @if (x.periods.pendingByTeacher.length) {
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Teachers who have not marked</p>
          <ul class="grid grid-cols-1 md:grid-cols-2 gap-2">
            @for (t of x.periods.pendingByTeacher; track t.teacher) { <li class="flex justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50 text-sm font-bold"><span>{{ t.teacher }}</span><span class="text-rose-500">{{ t.n }} period{{ t.n === 1 ? '' : 's' }}</span></li> }
          </ul>
        } @else if (x.periods.scheduled) { <p class="text-sm font-black text-emerald-600">Every lesson so far has attendance.</p> }
        @else { <p class="text-sm font-bold text-slate-400">No timetable lessons for this day.</p> }
      </section>
    }
  </div>
  `
})
export class AttDashboard {
  private api = inject(Api);
  d = fmtDate;
  date = signal(today());
  data = signal<Dash | null>(null);
  error = signal('');
  pending = computed(() => (this.data()?.working ? this.data()!.sections.filter(s => !s.marked && s.total > 0) : []));
  groups = computed(() => {
    const m = new Map<string, { name: string; sections: Sec[]; pct: number | null }>();
    for (const s of this.data()?.sections ?? []) (m.get(s.class_name) ?? m.set(s.class_name, { name: s.class_name, sections: [], pct: null }).get(s.class_name)!).sections.push(s);
    for (const g of m.values()) { const marked = g.sections.reduce((a, s) => a + s.marked, 0); g.pct = marked ? Math.round((g.sections.reduce((a, s) => a + s.present + s.late, 0) / marked) * 1000) / 10 : null; }
    return [...m.values()];
  });
  kpis = computed(() => {
    const t = this.data()?.totals; if (!t) return [];
    const pres = t.present + t.late;
    return [
      { label: 'Students', value: String(t.students), cls: '' }, { label: 'Present (incl. late)', value: String(pres), cls: 'text-emerald-600' },
      { label: 'Absent', value: String(t.absent), cls: 'text-rose-500' }, { label: 'On leave', value: String(t.leave), cls: 'text-amber-500' },
      { label: 'Attendance today', value: t.marked ? Math.round((pres / t.marked) * 1000) / 10 + '%' : '-', cls: '' }
    ];
  });
  constructor() { this.load(); }
  setDate(v: string) { if (v) { this.date.set(v); this.load(); } }
  load() { this.api.get<Dash>('/attendance/dashboard', { date: this.date() }).subscribe({ next: d => { this.data.set(d); this.error.set(''); }, error: e => this.error.set(errorText(e)) }); }
}
