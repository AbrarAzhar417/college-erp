import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { Cov, PLAN_STATUS, covBar } from './syl';

interface Row { section_id: number; subject_id: number; class_id: number; class_name: string; section_name: string; subject: string; plan_id: number | null; plan_status: string | null; coverage: Cov | null; thisWeek: { id: number; topic: string; chapter: string | null }[] }

@Component({
  selector: 'app-syl-mine',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    @if (manager) { <div class="w-72"><label class="label" for="mt">Teacher</label><select id="mt" class="field" [ngModel]="teacherId()" (ngModelChange)="setTeacher($event)"><option [ngValue]="null">Choose teacher…</option>@for (t of teachers(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }</select></div> }
    @if (note()) { <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ note() }}</p> }
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      @for (r of rows(); track r.section_id + '-' + r.subject_id) {
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
          <div class="flex items-start justify-between gap-3"><div><h3 class="text-lg font-black tracking-tight">{{ r.class_name }}-{{ r.section_name }} · {{ r.subject }}</h3></div>
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-black whitespace-nowrap" [class]="st(r.plan_status ?? 'none').cls">{{ st(r.plan_status ?? 'none').label }}</span></div>
          @if (r.coverage; as c) {
            <div><div class="flex justify-between text-xs font-black mb-1.5"><span>Taught so far</span><span>{{ c.pct ?? 0 }}%{{ c.plannedPct !== null ? ' (should be ' + c.plannedPct + '%)' : '' }}</span></div>
              <div class="relative h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full" [class]="bar(c)" [style.width.%]="c.pct ?? 0"></div>@if (c.plannedPct !== null) { <div class="absolute top-0 bottom-0 w-0.5 bg-slate-700 dark:bg-slate-200" [style.left.%]="c.plannedPct"></div> }</div>
              @if (c.behind) { <p class="text-xs font-black text-rose-500 mt-2">{{ c.behind }} topic{{ c.behind > 1 ? 's' : '' }} behind schedule</p> } @else if (c.items) { <p class="text-xs font-black text-emerald-600 mt-2">On track</p> }</div>
          }
          @if (r.thisWeek.length) { <div><p class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">This week</p><ul class="text-sm font-bold space-y-1">@for (t of r.thisWeek; track t.id) { <li>{{ t.topic }}</li> }</ul></div> }
          <div class="flex flex-wrap gap-2 pt-1">
            @if (r.plan_id) { <a [routerLink]="['/syllabus/track', r.plan_id]" [queryParams]="{ sectionId: r.section_id }" class="btn-primary !py-2.5">Mark progress</a><a [routerLink]="['/syllabus/plan', r.plan_id]" class="btn-ghost !py-2.5">Open plan</a> }
            @else { <button type="button" class="btn-primary !py-2.5" (click)="create(r)">Make the plan</button> }
          </div>
        </section>
      }
    </div>
    @if (loaded() && !rows().length && !note()) { <p class="text-sm font-bold text-slate-400">No subjects are assigned to this teacher yet.</p> }
  </div>
  `
})
export class SylMine {
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  manager = this.auth.canWriteStudents();
  st = (s: string) => PLAN_STATUS[s]; bar = (c: Cov) => covBar(c.pct, c.plannedPct);
  teachers = signal<{ id: number; name: string }[]>([]); teacherId = signal<number | null>(null);
  rows = signal<Row[]>([]); note = signal(''); error = signal(''); loaded = signal(false);
  constructor() { if (this.manager) { this.api.get<{ id: number; name: string }[]>('/timetable/teachers').subscribe(t => this.teachers.set(t)); this.loaded.set(true); } else this.load(); }
  setTeacher(id: number | null) { this.teacherId.set(id); this.load(); }
  load() {
    if (this.manager && !this.teacherId()) { this.rows.set([]); return; }
    this.api.get<{ rows: Row[]; note?: string }>('/syllabus/mine', { teacherId: this.teacherId() ?? undefined }).subscribe({ next: r => { this.rows.set(r.rows); this.note.set(r.note ?? ''); this.loaded.set(true); }, error: e => this.error.set(errorText(e)) });
  }
  create(r: Row) { this.api.post<{ id: number }>('/syllabus/plans', { class_id: r.class_id, subject_id: r.subject_id }).subscribe({ next: x => this.router.navigate(['/syllabus/plan', x.id]), error: e => this.toast.show(errorText(e), 'error') }); }
}
