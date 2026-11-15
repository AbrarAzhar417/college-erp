import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Sparkles, Wand2, CircleCheck, TriangleAlert, CircleX, Trash2 } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { Check, GenSlot, Subject, Teacher, TtData, buildCells } from './tt';
import { TtGrid } from './tt-grid';

interface Job {
  id: string; status: 'running' | 'done' | 'cancelled' | 'failed'; phase: string; pct: number; placed: number; total: number; error?: string;
  result?: {
    placed: number; total: number; initialCost: number; cost: number; ms: number; validationErrors: string[];
    unplaced: { sectionLabel: string; subjectName: string; teacherName: string; periods: number }[];
    breakdown: { teacherGaps: number; longRuns: number; unevenDays: number; sectionGaps: number; heavyLate: number; backToBack: number };
    teacherStats: { id: number; name: string; load: number; maxPerWeek: number; busiestDay: number; gaps: number }[];
  };
}

@Component({
  selector: 'app-tt-generate',
  imports: [FormsModule, RouterLink, LucideAngularModule, TtGrid],
  template: `
  <div class="space-y-8">

    <!-- Readiness -->
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <div class="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div>
          <h3 class="text-xl font-black tracking-tight">Before you generate</h3>
          @if (check(); as c) {
            <p class="text-sm font-bold text-slate-400 mt-2">{{ c.sections }} sections · {{ c.lessons }} subject entries · {{ c.periods }} periods per week · {{ c.teachers }} teachers</p>
          }
        </div>
        <button type="button" class="btn-ghost self-start" (click)="autoAssign()">
          <lucide-icon [img]="wandIcon" [size]="16" /> Assign teachers automatically
        </button>
      </div>

      @if (check(); as c) {
        @if (c.issues.length === 0) {
          <p class="mt-6 flex items-center gap-3 text-sm font-black text-emerald-600 dark:text-emerald-400">
            <lucide-icon [img]="okIcon" [size]="20" /> Everything is ready. Press Generate.
          </p>
        }
        <ul class="mt-6 space-y-2">
          @for (i of visibleIssues(); track $index) {
            <li class="flex items-start gap-3 p-4 rounded-2xl text-sm font-bold"
                [class]="i.level === 'error' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'">
              <lucide-icon [img]="i.level === 'error' ? errIcon : warnIcon" [size]="18" class="shrink-0 mt-0.5" /> <span>{{ i.message }}</span>
            </li>
          }
        </ul>
        @if (c.issues.length > 4) {
          <button type="button" class="mt-3 text-sm font-black text-indigo-600 dark:text-indigo-400" (click)="showAll.set(!showAll())">
            {{ showAll() ? 'Show fewer' : 'Show all ' + c.issues.length + ' notes' }}
          </button>
        }
      }
      @if (assignNote()) { <p class="mt-4 text-sm font-bold text-indigo-600 dark:text-indigo-400">{{ assignNote() }}</p> }
    </section>

    <!-- Generate -->
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <h3 class="text-xl font-black tracking-tight mb-6">Smart one-click generator</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        @for (o of efforts; track o.key) {
          <button type="button" (click)="effort.set(o.key)" [disabled]="running()"
                  class="text-left p-5 rounded-[1.8rem] border-2 transition-all"
                  [class]="effort() === o.key ? 'border-indigo-600 bg-indigo-600/5' : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400'">
            <p class="font-black">{{ o.label }}</p>
            <p class="text-xs font-bold text-slate-400 mt-1">{{ o.hint }}</p>
          </button>
        }
      </div>
      @if ((check()?.locked ?? 0) > 0) {
        <label class="mt-5 flex items-center gap-3 text-sm font-bold">
          <input type="checkbox" [(ngModel)]="keepLocked" class="w-5 h-5 accent-indigo-600"> Keep the {{ check()!.locked }} locked lesson periods where they are
        </label>
      }
      <div class="mt-8 flex flex-wrap items-center gap-4">
        <button type="button" class="btn-primary" [disabled]="running() || hasErrors()" (click)="generate()">
          <lucide-icon [img]="sparkIcon" [size]="18" /> {{ running() ? 'Working…' : 'Generate timetable' }}
        </button>
        @if (running()) { <button type="button" class="btn-ghost" (click)="cancel()">Stop</button> }
        @if (hasErrors()) { <span class="text-sm font-bold text-rose-500">Fix the red problems above first.</span> }
      </div>
      @if (error()) { <p role="alert" class="mt-4 text-sm font-bold text-rose-500">{{ error() }}</p> }

      @if (job(); as j) {
        @if (j.status === 'running') {
          <div class="mt-8">
            <div class="flex justify-between text-sm font-black mb-2"><span>{{ j.phase }}…</span><span>{{ j.pct }}%</span></div>
            <div class="h-4 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full bg-indigo-600 rounded-full transition-all duration-300" [style.width.%]="j.pct"></div></div>
            <p class="text-xs font-bold text-slate-400 mt-2">{{ j.placed }} of {{ j.total }} periods placed</p>
          </div>
        }
      }
    </section>

    <!-- Result -->
    @if (job()?.result; as r) {
      <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-8">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div>
            <h3 class="text-2xl font-black tracking-tight">Timetable ready (preview)</h3>
            <p class="text-sm font-bold text-slate-400 mt-1">Made in {{ (r.ms / 1000).toFixed(1) }} seconds. Nothing is saved until you publish.</p>
          </div>
          <button type="button" class="btn-primary self-start" (click)="publish(r.unplaced.length > 0)" [disabled]="publishing() || r.validationErrors.length > 0">
            {{ r.unplaced.length ? 'Publish partial timetable' : 'Publish timetable' }}
          </button>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="p-5 rounded-[1.8rem] bg-slate-50 dark:bg-slate-950/50">
            <p class="text-3xl font-black" [class]="r.validationErrors.length ? 'text-rose-500' : 'text-emerald-500'">{{ r.validationErrors.length }}</p>
            <p class="text-xs font-bold text-slate-400 mt-1">Clashes</p>
          </div>
          <div class="p-5 rounded-[1.8rem] bg-slate-50 dark:bg-slate-950/50">
            <p class="text-3xl font-black">{{ r.placed }}<span class="text-base text-slate-400">/{{ r.total }}</span></p>
            <p class="text-xs font-bold text-slate-400 mt-1">Periods placed</p>
          </div>
          <div class="p-5 rounded-[1.8rem] bg-slate-50 dark:bg-slate-950/50">
            <p class="text-3xl font-black">{{ improvement() }}%</p>
            <p class="text-xs font-bold text-slate-400 mt-1">Smoother than first draft</p>
          </div>
          <div class="p-5 rounded-[1.8rem] bg-slate-50 dark:bg-slate-950/50">
            <p class="text-3xl font-black">{{ loadRange() }}</p>
            <p class="text-xs font-bold text-slate-400 mt-1">Teacher load (periods/week)</p>
          </div>
        </div>

        @if (r.validationErrors.length) {
          <ul class="space-y-2">@for (e of r.validationErrors; track $index) { <li class="p-4 rounded-2xl bg-rose-500/10 text-rose-700 dark:text-rose-300 text-sm font-bold">{{ e }}</li> }</ul>
        }
        @if (r.unplaced.length) {
          <div class="p-5 rounded-[1.8rem] bg-amber-500/10">
            <p class="text-sm font-black text-amber-700 dark:text-amber-300">These lessons could not be placed. A teacher is probably overloaded. Try Deep, or give them to another teacher.</p>
            <ul class="mt-3 space-y-1 text-sm font-bold text-amber-800 dark:text-amber-200">
              @for (u of r.unplaced; track $index) { <li>{{ u.sectionLabel }} {{ u.subjectName }} ({{ u.periods }} periods) · {{ u.teacherName }}</li> }
            </ul>
          </div>
        }

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-bold">
          <p class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">Teacher free gaps: <b>{{ r.breakdown.teacherGaps }}</b></p>
          <p class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">Teachers with more than 3 periods in a row: <b>{{ r.breakdown.longRuns }}</b> times</p>
          <p class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">Heaviest day for any teacher: <b>{{ busiest() }} periods</b></p>
        </div>

        <div>
          <h4 class="text-lg font-black mb-4">Busiest teachers</h4>
          <div class="space-y-3">
            @for (t of r.teacherStats.slice(0, 8); track t.id) {
              <div class="flex items-center gap-4">
                <span class="w-40 truncate text-sm font-bold">{{ t.name }}</span>
                <div class="flex-1 h-3 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden"><div class="h-full bg-indigo-600 rounded-full" [style.width.%]="(t.load / t.maxPerWeek) * 100"></div></div>
                <span class="w-16 text-right text-sm font-black">{{ t.load }}/{{ t.maxPerWeek }}</span>
              </div>
            }
          </div>
        </div>

        <div>
          <h4 class="text-lg font-black mb-4">Preview a section</h4>
          <div class="grid grid-cols-2 gap-4 max-w-md mb-6">
            <select class="field" aria-label="Class" [ngModel]="pClass()" (ngModelChange)="setPClass($event)">
              @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
            </select>
            <select class="field" aria-label="Section" [ngModel]="pSection()" (ngModelChange)="pSection.set($event)">
              @for (s of pSections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }
            </select>
          </div>
          @if (tt.settings(); as s) {
            <tt-grid [days]="s.days" [periods]="tt.periods()" [breakAfter]="s.breakAfter" [cells]="previewCells()" />
          }
        </div>
      </section>
    }

    <!-- Published -->
    @if ((check()?.published ?? 0) > 0) {
      <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-col md:flex-row md:items-center justify-between gap-5">
        <p class="font-black">A timetable is published ({{ check()!.published }} lesson periods).</p>
        <div class="flex gap-3">
          <a routerLink="/timetable/view" class="btn-primary">Open timetable</a>
          <button type="button" class="btn-ghost" (click)="clearAll()"><lucide-icon [img]="trashIcon" [size]="16" /> Clear</button>
        </div>
      </section>
    }
  </div>
  `
})
export class TtGenerate implements OnDestroy {
  private api = inject(Api);
  private toast = inject(ToastService);
  tt = inject(TtData);

  okIcon = CircleCheck; warnIcon = TriangleAlert; errIcon = CircleX; sparkIcon = Sparkles; wandIcon = Wand2; trashIcon = Trash2;
  efforts = [
    { key: 'quick', label: 'Quick', hint: 'About 4 seconds. Good for a first look.' },
    { key: 'balanced', label: 'Balanced', hint: 'About 10 seconds. Recommended.' },
    { key: 'deep', label: 'Deep', hint: 'About 25 seconds. Smoothest teacher days.' }
  ] as const;

  check = signal<Check | null>(null);
  effort = signal<'quick' | 'balanced' | 'deep'>('balanced');
  keepLocked = true;
  job = signal<Job | null>(null);
  error = signal('');
  assignNote = signal('');
  publishing = signal(false);
  running = computed(() => this.job()?.status === 'running');
  showAll = signal(false);
  visibleIssues = computed(() => {
    const all = this.check()?.issues ?? [];
    const sorted = [...all.filter(i => i.level === 'error'), ...all.filter(i => i.level === 'warning')];
    return this.showAll() ? sorted : sorted.slice(0, 4);
  });
  hasErrors = computed(() => !!this.check()?.issues.some(i => i.level === 'error'));

  classes = signal<ClassInfo[]>([]);
  pClass = signal<number | null>(null);
  pSection = signal<number | null>(null);
  pSections = computed(() => this.classes().find(c => c.id === this.pClass())?.sections ?? []);
  private slots = signal<GenSlot[]>([]);
  private subjects = new Map<number, string>();
  private teachers = new Map<number, string>();
  private alive = true;

  previewCells = computed(() => {
    const sec = this.pSection();
    return buildCells(this.slots().filter(s => s.sectionId === sec).map(s => ({
      day: s.day, period: s.period, subjectId: s.subjectId, title: this.subjects.get(s.subjectId) ?? '?', sub: this.teachers.get(s.teacherId) ?? '', grp: s.grp, locked: s.locked
    })));
  });
  improvement = computed(() => {
    const r = this.job()?.result; if (!r || !r.initialCost) return 0;
    return Math.max(0, Math.round(((r.initialCost - r.cost) / r.initialCost) * 100));
  });
  loadRange = computed(() => {
    const t = this.job()?.result?.teacherStats ?? []; if (!t.length) return '-';
    return `${Math.min(...t.map(x => x.load))} to ${Math.max(...t.map(x => x.load))}`;
  });
  busiest = computed(() => Math.max(0, ...(this.job()?.result?.teacherStats.map(t => t.busiestDay) ?? [0])));

  constructor() {
    this.refreshCheck();
    this.api.get<ClassInfo[]>('/classes').subscribe(c0 => { const c = c0.filter(x => this.tt.inWing(x.id)); this.classes.set(c); if (c.length) this.setPClass(c[0].id); });
    this.api.get<Subject[]>('/timetable/subjects').subscribe(l => l.forEach(s => this.subjects.set(s.id, s.name)));
    this.api.get<Teacher[]>('/timetable/teachers').subscribe(l => l.forEach(t => this.teachers.set(t.id, t.name)));
  }
  ngOnDestroy() { this.alive = false; }

  refreshCheck() { this.api.get<Check>('/timetable/check', { wing: this.tt.wing() }).subscribe({ next: c => this.check.set(c), error: e => this.error.set(errorText(e)) }); }
  setPClass(id: number) { this.pClass.set(id); this.pSection.set(this.classes().find(c => c.id === id)?.sections[0]?.id ?? null); }

  autoAssign() {
    this.api.post<{ assigned: number; unassigned: { section: string; subject: string; reason: string }[] }>('/timetable/assign/auto', {}).subscribe({
      next: r => {
        this.assignNote.set(r.unassigned.length
          ? `Assigned ${r.assigned} subjects. ${r.unassigned.length} could not be assigned, for example ${r.unassigned[0].section} ${r.unassigned[0].subject}: ${r.unassigned[0].reason}`
          : `Assigned teachers to ${r.assigned} subjects.`);
        this.refreshCheck();
      },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }

  generate() {
    this.error.set(''); this.job.set(null); this.slots.set([]);
    this.api.post<{ jobId: string }>('/timetable/generate', { effort: this.effort(), keepLocked: this.keepLocked, wing: this.tt.wing() }).subscribe({
      next: r => this.poll(r.jobId),
      error: e => { this.error.set(e?.error?.issues?.[0]?.message ?? errorText(e)); this.refreshCheck(); }
    });
  }
  private poll(id: string) {
    this.api.get<Job>(`/timetable/generate/${id}`).subscribe({
      next: j => {
        if (!this.alive) return;
        this.job.set(j);
        if (j.status === 'running') setTimeout(() => this.poll(id), 600);
        else if (j.status === 'done') this.api.get<GenSlot[]>(`/timetable/generate/${id}/slots`).subscribe(s => this.slots.set(s));
        else if (j.status === 'failed') this.error.set(j.error ?? 'Generation failed.');
      },
      error: e => this.error.set(errorText(e))
    });
  }
  cancel() { const j = this.job(); if (j) this.api.post(`/timetable/generate/${j.id}/cancel`, {}).subscribe(); }

  publish(partial: boolean) {
    const j = this.job(); if (!j) return;
    if (partial && !confirm('Some lessons are missing. Publish this partial timetable anyway?')) return;
    this.publishing.set(true);
    this.api.post('/timetable/publish', { jobId: j.id, allowPartial: partial }).subscribe({
      next: () => { this.publishing.set(false); this.toast.show('Timetable published.'); this.job.set(null); this.refreshCheck(); },
      error: e => { this.publishing.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
  clearAll() {
    if (!confirm('Delete the whole published timetable? This cannot be undone.')) return;
    this.api.delete('/timetable/slots?wing=' + this.tt.wing()).subscribe({ next: () => { this.toast.show('Timetable cleared.'); this.refreshCheck(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
}
