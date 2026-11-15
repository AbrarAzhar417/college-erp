import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { AttMarkList } from './att-mark-list';
import { MarkRow, Meta, MySection, fmtDate, initialRows, today } from './att';

@Component({
  selector: 'app-att-daily',
  imports: [FormsModule, RouterLink, AttMarkList],
  template: `
  <div class="space-y-6 max-w-5xl">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
      <div><label class="label" for="dt">Date</label><input id="dt" type="date" class="field" [max]="todayIso" [ngModel]="date()" (ngModelChange)="setDate($event)"></div>
      @if (manager) {
        <div><label class="label" for="dc">Class</label>
          <select id="dc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="ds">Section</label>
          <select id="ds" class="field" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">@for (s of sectionOptions(); track s.id) { <option [ngValue]="s.id">Section {{ s.section_name }}</option> }</select></div>
      } @else {
        <div class="col-span-2"><label class="label" for="ds2">My class</label>
          <select id="ds2" class="field" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.class_name }} - Section {{ s.section_name }}</option> }</select></div>
      }
      @if (sectionId()) { <a [routerLink]="['/attendance/register']" [queryParams]="{ sectionId: sectionId(), month: date().slice(0, 7) }" class="btn-ghost">Monthly register</a> }
    </div>

    @if (!sections().length && loaded()) {
      <p class="p-6 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">You are not the class teacher of any section yet. Ask the office to set it in Attendance settings. You can still take period attendance for your lessons.</p>
    }
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (data(); as x) {
      @if (!x.meta.working) { <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ x.meta.holiday ? 'Holiday: ' + x.meta.holiday : 'Weekly off.' }} Attendance is not taken on this day.</p> }
      @else if (x.meta.lockReason) { <p class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ x.meta.lockReason }}</p> }

      <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <div class="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h3 class="text-xl font-black tracking-tight">{{ x.section }} · {{ d(x.meta.date) }}</h3>
            <p class="text-xs font-bold text-slate-400 mt-1">{{ x.meta.marked ? 'Saved' + (x.meta.markedBy ? ' by ' + x.meta.markedBy : '') + '. You can change it below.' : 'Not marked yet. Everyone starts as present, tap the ones who are not.' }}</p>
          </div>
          @if (!x.meta.marked && x.meta.canEdit && x.meta.working) { <button type="button" class="btn-ghost" (click)="fillFromPeriods()">Fill from period attendance</button> }
        </div>
        @if (!rows().length) { <p class="text-sm font-bold text-slate-400">There are no students in this section.</p> }
        <att-mark-list [(rows)]="rows" [disabled]="!x.meta.canEdit || !x.meta.working || saving()" />
        @if (rows().length && x.meta.canEdit && x.meta.working) {
          <div class="sticky bottom-4 mt-6 flex justify-end"><button type="button" class="btn-primary shadow-enterprise-lg" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save attendance' }}</button></div>
        }
      </section>
    }
  </div>
  `
})
export class AttDaily {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  d = fmtDate; todayIso = today();
  manager = this.auth.canWriteStudents();

  date = signal(today());
  sections = signal<MySection[]>([]);
  loaded = signal(false);
  classId = signal<number | null>(null);
  sectionId = signal<number | null>(null);
  data = signal<{ section: string; meta: Meta; students: MarkRow[] } | null>(null);
  rows = signal<MarkRow[]>([]);
  error = signal(''); saving = signal(false);
  classes = computed(() => { const m = new Map<number, { id: number; name: string }>(); for (const s of this.sections()) m.set(s.class_id, { id: s.class_id, name: s.class_name }); return [...m.values()]; });
  sectionOptions = computed(() => this.sections().filter(s => s.class_id === this.classId()));

  constructor() {
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    if (qp.get('date')) this.date.set(qp.get('date')!);
    this.api.get<MySection[]>('/attendance/my-sections').subscribe({
      next: list => {
        this.sections.set(list); this.loaded.set(true);
        const want = Number(qp.get('sectionId')), pick = list.find(s => s.id === want) ?? list[0];
        if (pick) { this.classId.set(pick.class_id); this.sectionId.set(pick.id); this.load(); }
      },
      error: e => this.error.set(errorText(e))
    });
  }

  setDate(v: string) { if (v) { this.date.set(v); this.load(); } }
  setClass(id: number) { this.classId.set(id); this.sectionId.set(this.sections().find(s => s.class_id === id)?.id ?? null); this.load(); }
  setSection(id: number) { this.sectionId.set(id); this.load(); }

  load() {
    const id = this.sectionId(); if (!id) return;
    this.error.set('');
    this.api.get<{ section: string; meta: Meta; students: MarkRow[] }>('/attendance/daily', { sectionId: id, date: this.date() }).subscribe({
      next: r => { this.data.set(r); this.rows.set(initialRows(r.students)); },
      error: e => { this.data.set(null); this.rows.set([]); this.error.set(errorText(e)); }
    });
  }

  save() {
    const missing = this.rows().find(r => !r.status);
    if (missing) { this.toast.show(`Choose a status for ${missing.name}.`, 'error'); return; }
    this.saving.set(true);
    this.api.post<{ saved: number; counts: Record<string, number> }>('/attendance/daily', {
      section_id: this.sectionId(), date: this.date(), entries: this.rows().map(r => ({ student_id: r.id, status: r.status, note: r.note }))
    }).subscribe({
      next: r => { this.saving.set(false); this.toast.show(`Saved: ${r.counts['P']} present, ${r.counts['A']} absent, ${r.counts['L']} leave, ${r.counts['LT']} late.`); this.load(); },
      error: e => { this.saving.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }

  fillFromPeriods() {
    this.api.post<{ filled: number }>('/attendance/daily/fill-from-periods', { section_id: this.sectionId(), date: this.date() }).subscribe({
      next: r => { this.toast.show(r.filled ? `${r.filled} students filled from period attendance.` : 'No period attendance was found for this day.', r.filled ? 'ok' : 'error'); this.load(); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
