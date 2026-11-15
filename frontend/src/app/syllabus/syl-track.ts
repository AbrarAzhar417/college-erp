import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { CalMonth, Cov, Item, KINDS, PlanFull, SylCfg, covBar, monthName, weekDates } from './syl';

type St = 'pending' | 'in_progress' | 'done' | 'skipped';
const STATES: { key: St; label: string; on: string }[] = [
  { key: 'done', label: 'Done', on: 'bg-emerald-600 text-white' }, { key: 'in_progress', label: 'In progress', on: 'bg-sky-600 text-white' },
  { key: 'pending', label: 'Not yet', on: 'bg-slate-600 text-white' }, { key: 'skipped', label: 'Skipped', on: 'bg-amber-500 text-white' }
];

@Component({
  selector: 'app-syl-track',
  imports: [FormsModule, RouterLink],
  template: `
  @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (d(); as x) {
  <div class="space-y-6 max-w-5xl">
    <div class="flex flex-wrap items-end gap-4">
      <a routerLink="/syllabus/mine" class="btn-ghost !py-2.5">Back</a>
      <div><label class="label" for="ts">Section</label><select id="ts" class="field" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">@for (s of x.sections; track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }</select></div>
      <h3 class="text-xl font-black tracking-tight pb-2">{{ x.plan.class_name }} · {{ x.plan.subject }}</h3>
    </div>
    @if (!canTrack()) { <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm font-bold">You can only mark progress for the sections and subjects you teach. You are viewing this section.</p> }
    @if (cov(); as c) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <div class="flex justify-between text-sm font-black mb-2"><span>Taught so far: {{ c.pct ?? 0 }}%</span><span class="text-slate-400">Should be by now: {{ c.plannedPct ?? 0 }}%</span></div>
        <div class="relative h-4 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full" [class]="bar(c)" [style.width.%]="c.pct ?? 0"></div>@if (c.plannedPct !== null) { <div class="absolute top-0 bottom-0 w-0.5 bg-slate-700 dark:bg-slate-200" [style.left.%]="c.plannedPct"></div> }</div>
        <p class="text-xs font-black mt-2" [class]="c.behind ? 'text-rose-500' : 'text-emerald-600'">{{ c.behind ? c.behind + ' topic(s) of past weeks are not done yet' : 'You are on track' }}</p>
      </section>
    }
    @for (m of months(); track m.month) {
      <section class="space-y-3"><h4 class="text-lg font-black">{{ mn(m.month) }}</h4>
        @for (w of m.weeks; track w.week) {
          @if (itemsOf(m.month, w.week).length) {
            <div class="p-4 md:p-5 rounded-[2rem] border-2 bg-white dark:bg-slate-900/40" [class]="isNow(m.month, w.week) ? 'border-indigo-500' : isLate(m.month, w.week) ? 'border-rose-300 dark:border-rose-900' : 'border-slate-200 dark:border-slate-800'">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p class="text-sm font-black">Week {{ w.week }} <span class="text-slate-400 font-bold">· {{ wd(w) }}</span>@if (isNow(m.month, w.week)) { <span class="ml-2 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px]">This week</span> }@if (isLate(m.month, w.week)) { <span class="ml-2 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-600 text-[10px]">Behind</span> }</p>
                @if (canTrack()) { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="weekDone(m.month, w.week)">Mark the whole week done</button> }
              </div>
              <ul class="space-y-2">
                @for (it of itemsOf(m.month, w.week); track it.id) {
                  <li class="flex flex-wrap items-center gap-3">
                    <span class="flex-1 min-w-52"><span class="block text-sm font-black">{{ it.topic }}</span><span class="block text-[11px] font-bold text-slate-400">{{ it.chapter }}{{ it.periods ? ' · ' + it.periods + ' periods' : '' }}</span></span>
                    <span class="inline-flex gap-1" role="group">@for (s of states; track s.key) { <button type="button" [disabled]="!canTrack()" (click)="set(it, s.key)" [attr.aria-pressed]="status(it) === s.key" class="px-3 h-9 rounded-xl text-[11px] font-black transition-all disabled:opacity-50" [class]="status(it) === s.key ? s.on : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'">{{ s.label }}</button> }</span>
                  </li>
                }
              </ul>
            </div>
          }
        }
      </section>
    }
  </div>
  }
  `
})
export class SylTrack {
  private api = inject(Api);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private id = toSignal(this.route.paramMap.pipe(map(p => Number(p.get('id')))));
  states = STATES; mn = monthName; wd = weekDates; bar = (c: Cov) => covBar(c.pct, c.plannedPct);
  d = signal<PlanFull | null>(null); cal = signal<CalMonth[]>([]); cfg = signal<SylCfg | null>(null);
  sectionId = signal<number | null>(null); prog = signal<Record<number, string>>({}); cov = signal<Cov | null>(null); canTrack = signal(false); error = signal('');
  months = computed(() => this.cal().filter(m => (this.d()?.items ?? []).some(i => i.month === m.month)));
  itemsOf = (month: string, week: number): Item[] => (this.d()?.items ?? []).filter(i => i.month === month && i.week === week);
  isNow = (m: string, w: number) => this.cfg()?.currentMonth === m && this.cfg()?.currentWeek === w;
  isLate = (m: string, w: number) => { const cw = this.cal().find(x => x.month === m)?.weeks[w - 1]; return !!cw && !!this.cfg() && cw.to < this.cfg()!.today && this.itemsOf(m, w).some(i => !['done', 'skipped'].includes(this.status(i))); };
  status = (it: Item): string => this.prog()[it.id] ?? 'pending';

  constructor() {
    this.api.get<SylCfg>('/syllabus/config').subscribe(c => this.cfg.set(c));
    this.api.get<CalMonth[]>('/syllabus/calendar').subscribe(c => this.cal.set(c));
    this.api.get<PlanFull>(`/syllabus/plans/${this.id()}`).subscribe({
      next: p => { this.d.set(p); const want = Number(this.route.snapshot.queryParamMap.get('sectionId')); this.sectionId.set(p.sections.find(s => s.id === want)?.id ?? p.sections[0]?.id ?? null); this.loadProg(); },
      error: e => this.error.set(errorText(e)) });
  }
  setSection(id: number) { this.sectionId.set(id); this.loadProg(); }
  loadProg() {
    const s = this.sectionId(); if (!s) return;
    this.api.get<{ progress: { item_id: number; status: string }[]; coverage: Cov; canTrack: boolean }>(`/syllabus/plans/${this.id()}/progress`, { sectionId: s }).subscribe(r => {
      this.prog.set(Object.fromEntries(r.progress.map(p => [p.item_id, p.status]))); this.cov.set(r.coverage); this.canTrack.set(r.canTrack); });
  }
  set(it: Item, status: St) {
    this.api.put('/syllabus/progress', { item_id: it.id, section_id: this.sectionId(), status }).subscribe({ next: () => { this.prog.set({ ...this.prog(), [it.id]: status }); this.refreshCov(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  weekDone(month: string, week: number) {
    const ids = this.itemsOf(month, week).map(i => i.id);
    this.api.post('/syllabus/progress/bulk', { section_id: this.sectionId(), item_ids: ids, status: 'done' }).subscribe({ next: () => { const p = { ...this.prog() }; ids.forEach(i => p[i] = 'done'); this.prog.set(p); this.refreshCov(); this.toast.show('Week marked done.'); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  private refreshCov() { this.api.get<{ coverage: Cov }>(`/syllabus/plans/${this.id()}/progress`, { sectionId: this.sectionId() ?? undefined }).subscribe(r => this.cov.set(r.coverage)); }
}
