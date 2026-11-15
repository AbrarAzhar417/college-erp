import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { Teacher } from './tt';

interface Cand { id: number; name: string; qualified: boolean; lessonsToday: number; subsThisMonth: number; subsThisWeek: number; weekLoad: number; secondThisWeek: boolean }
interface Lesson { section_id: number; period: number; subject: string; class_name: string; section_name: string; time: string; given: { sub_teacher_id: number; sub_name: string } | null; candidates: Cand[] }
interface Rec { section_id: number; period: number; time: string; class_name: string; section_name: string; subject: string; absent_name: string; sub_name: string; note: string | null }
interface Away { id: number; name: string; why: string; lessons: number; covered: number; uncovered: number }
interface View { date: string; lessons: Lesson[]; recorded: Rec[] }

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

@Component({
  selector: 'app-tt-subs',
  imports: [FormsModule],
  template: `
  <div class="space-y-6 max-w-5xl">
    <div class="no-print space-y-4">
      <p class="text-sm font-bold text-slate-500">Choose the date and the teacher who is absent. The list shows each of their lessons and the teachers who are free at that time, a teacher who already has 6 lessons that day, a full week, or has covered twice this week is not offered. Someone who has covered once this week appears only when nobody else is free.</p>
      @if (away().length) {
        <div class="rounded-2xl border border-rose-300/60 bg-rose-500/5 p-4 space-y-3" role="region" aria-label="Teachers away on this date">
          <p class="text-sm font-black">Away on {{ date() }}: pick a teacher</p>
          <div class="flex flex-wrap gap-2">
            @for (a of away(); track a.id) {
              <button type="button" (click)="pick(a.id)" class="px-4 py-2 rounded-xl text-xs font-black border" [class]="teacherId() === a.id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-700'">
                {{ a.name }} · {{ a.why }} · {{ a.uncovered }} of {{ a.lessons }} lesson(s) not covered</button>
            }
          </div>
          @if (teacherId() && canEdit()) { <button type="button" class="btn-primary" [disabled]="busy()" (click)="autoAssign()">Cover all their lessons automatically</button> }
        </div>
      }
      <div class="grid sm:grid-cols-3 gap-3 max-w-2xl">
        <input class="field" type="date" aria-label="Date" [ngModel]="date()" (ngModelChange)="date.set($event); load()">
        <select class="field sm:col-span-2" aria-label="Absent teacher" [ngModel]="teacherId()" (ngModelChange)="teacherId.set($event); load()">
          <option [ngValue]="0">Choose absent teacher</option>
          @for (t of teachers(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
        </select>
      </div>
      @for (l of view()?.lessons ?? []; track l.section_id + '-' + l.period) {
        <div class="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900/40 flex flex-wrap items-center gap-3">
          <div class="min-w-48"><p class="font-black">Period {{ l.period + 1 }} <span class="text-slate-400">{{ l.time }}</span></p><p class="text-sm font-bold text-slate-500">{{ l.class_name }}-{{ l.section_name }} · {{ l.subject }}</p></div>
          @if (l.given) { <span class="px-3 py-1 rounded-xl bg-emerald-500/10 text-emerald-700 text-xs font-black">Covered by {{ l.given.sub_name }}</span> }
          <select class="field max-w-xs ml-auto" [disabled]="!canEdit()" [attr.aria-label]="'Substitute for period ' + (l.period + 1)" [ngModel]="l.given?.sub_teacher_id ?? 0" (ngModelChange)="assign(l, $event)">
            <option [ngValue]="0">Choose substitute</option>
            @for (c of l.candidates; track c.id) { <option [ngValue]="c.id">{{ c.name }}{{ c.qualified ? ' ★' : '' }} ({{ c.lessonsToday }} today, {{ c.weekLoad }} this week, covered {{ c.subsThisWeek }} this week){{ c.secondThisWeek ? ' – 2nd this week' : '' }}</option> }
          </select>
        </div>
      } @empty { @if (teacherId()) { <p class="text-sm font-bold text-slate-400">This teacher has no lessons on that day.</p> } }
    </div>

    @if ((view()?.recorded?.length ?? 0) > 0) {
      <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-x-auto print:border-0">
        <div class="flex items-center justify-between p-6 pb-2"><h3 class="font-black">Substitutions on {{ date() }}</h3><button type="button" class="btn-ghost no-print" (click)="print()">Print</button></div>
        <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest">
          <th class="px-6 py-3">Period</th><th class="px-3 py-3">Class</th><th class="px-3 py-3">Subject</th><th class="px-3 py-3">Absent</th><th class="px-3 py-3">Substitute</th><th class="px-3 py-3 w-40">Signature</th><th class="px-3 py-3 no-print"></th></tr></thead>
          <tbody>@for (r of view()!.recorded; track r.section_id + '-' + r.period) {
            <tr class="border-t border-slate-100 dark:border-slate-800/60"><td class="px-6 py-3 font-black">{{ r.period + 1 }} <span class="text-slate-400 font-bold">{{ r.time }}</span></td>
              <td class="px-3 py-3 font-bold">{{ r.class_name }}-{{ r.section_name }}</td><td class="px-3 py-3 font-bold">{{ r.subject }}</td>
              <td class="px-3 py-3 font-bold">{{ r.absent_name }}</td><td class="px-3 py-3 font-black">{{ r.sub_name }}</td><td class="px-3 py-3 border-b border-slate-400"></td>
              <td class="px-3 py-3 no-print"><button type="button" class="text-rose-600 text-xs font-black" (click)="remove(r)">Remove</button></td></tr> }</tbody></table>
      </div>
    }

    @if (auth.canTimetable()) {
      <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-x-auto no-print">
        <div class="flex items-center justify-between p-6 pb-2 gap-3 flex-wrap"><h3 class="font-black">Lessons covered in a month</h3>
          <input class="field max-w-44" type="month" aria-label="Month" [ngModel]="month()" (ngModelChange)="month.set($event); loadSummary()"></div>
        <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-6 py-3">Teacher</th><th class="px-3 py-3">Lessons covered</th></tr></thead>
          <tbody>@for (r of summary(); track r.id) { <tr class="border-t border-slate-100 dark:border-slate-800/60"><td class="px-6 py-2 font-black">{{ r.name }}</td><td class="px-3 py-2 font-bold">{{ r.covered }}</td></tr> }
            @empty { <tr><td colspan="2" class="px-6 py-6 font-bold text-slate-400">None recorded.</td></tr> }</tbody></table>
      </div>
    }
  </div>
  `
})
export class TtSubs {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  date = signal(today());
  month = signal(today().slice(0, 7));
  teacherId = signal(0);
  teachers = signal<Teacher[]>([]);
  view = signal<View | null>(null);
  away = signal<Away[]>([]);
  busy = signal(false);
  summary = signal<{ id: number; name: string; covered: number }[]>([]);
  readonly canEdit = computed(() => this.auth.canTimetable());

  constructor() {
    this.api.get<Teacher[]>('/timetable/teachers').subscribe({ next: r => this.teachers.set(r), error: e => this.toast.show(errorText(e), 'error') });
    this.load(); this.loadSummary();
  }
  pick(id: number) { this.teacherId.set(id); this.load(); }
  loadAway() { this.api.get<Away[]>('/timetable/absent', { date: this.date() }).subscribe({ next: r => this.away.set(r) }); }
  autoAssign() {
    this.busy.set(true);
    this.api.post<{ assigned: unknown[]; left: { period: number; class: string }[] }>('/timetable/subs/auto', { date: this.date(), teacher_id: this.teacherId() }).subscribe({
      next: r => { this.busy.set(false); this.toast.show(`${r.assigned.length} lesson(s) covered${r.left.length ? `, ${r.left.length} still need someone by hand (${r.left.map(l => 'P' + l.period + ' ' + l.class).join(', ')})` : '.'}`, r.left.length ? 'error' : 'ok'); this.load(); this.loadSummary(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); } });
  }
  load() { this.loadAway(); this.api.get<View>('/timetable/subs', { date: this.date(), teacher_id: this.teacherId() }).subscribe({ next: r => this.view.set(r), error: e => this.toast.show(errorText(e), 'error') }); }
  loadSummary() { if (this.auth.canTimetable()) this.api.get<{ rows: { id: number; name: string; covered: number }[] }>('/timetable/subs/summary', { month: this.month() }).subscribe({ next: r => this.summary.set(r.rows) }); }
  assign(l: Lesson, subId: number) {
    if (!subId) return;
    this.api.post('/timetable/subs', { date: this.date(), section_id: l.section_id, period: l.period, absent_teacher_id: this.teacherId(), sub_teacher_id: subId }).subscribe({
      next: () => { this.toast.show('Substitute recorded.'); this.load(); this.loadSummary(); }, error: e => { this.toast.show(errorText(e), 'error'); this.load(); } });
  }
  remove(r: Rec) {
    this.api.delete(`/timetable/subs?date=${this.date()}&section_id=${r.section_id}&period=${r.period}`).subscribe({ next: () => { this.load(); this.loadSummary(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  print() { window.print(); }
}
