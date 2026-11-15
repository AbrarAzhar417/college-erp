import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { AttMarkList } from './att-mark-list';
import { Cfg, MarkRow, Meta, MySection, fmtDate, today } from './att';

interface Lesson { section_id: number; period: number; subject_id: number; subject_name: string; class_name: string; section_name: string; time: string; marked: number; total: number }
interface PeriodView { section: string; period: number; subject: { id: number; name: string } | null; teacher: string | null; meta: Meta; students: MarkRow[] }

@Component({
  selector: 'app-att-period',
  imports: [FormsModule, AttMarkList],
  template: `
  <div class="space-y-6 max-w-5xl">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
      <div><label class="label" for="pd">Date</label><input id="pd" type="date" class="field" [max]="todayIso" [ngModel]="date()" (ngModelChange)="setDate($event)"></div>
      @if (manager) {
        <div class="col-span-2"><label class="label" for="pt">Teacher</label>
          <select id="pt" class="field" [ngModel]="teacherId()" (ngModelChange)="setTeacher($event)"><option [ngValue]="null">Choose teacher…</option>@for (t of teachers(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }</select></div>
      }
    </div>

    @if (note()) { <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ note() }}</p> }
    @if (holiday()) { <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">Holiday: {{ holiday() }}. No attendance today.</p> }

    @if (lessons().length) {
      <section class="space-y-3">
        <h3 class="text-xl font-black tracking-tight">{{ manager ? 'Lessons of this teacher' : 'My lessons' }} on {{ d(date()) }}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          @for (l of lessons(); track l.period + '-' + l.section_id) {
            <button type="button" (click)="open(l.section_id, l.period)" class="text-left p-5 rounded-[2rem] border-2 transition-all"
                    [class]="isOpen(l) ? 'border-indigo-600 bg-indigo-600/5' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-indigo-400'">
              <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Period {{ l.period + 1 }} · {{ l.time }}</p>
              <p class="text-lg font-black mt-1">{{ l.class_name }}-{{ l.section_name }} · {{ l.subject_name }}</p>
              <p class="text-xs font-black mt-2" [class]="l.marked ? 'text-emerald-600' : 'text-rose-500'">{{ l.marked ? 'Marked (' + l.marked + '/' + l.total + ')' : 'Not marked yet' }}</p>
            </button>
          }
        </div>
      </section>
    } @else if (loaded() && !note() && !holiday() && (teacherId() || !manager)) {
      <p class="text-sm font-bold text-slate-400">No lessons in the timetable for this day.</p>
    }

    @if (manager) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-lg font-black tracking-tight">Or pick any class and period</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <select class="field" aria-label="Class" [ngModel]="mClass()" (ngModelChange)="setMClass($event)">@for (c of mClasses(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
          <select class="field" aria-label="Section" [ngModel]="mSection()" (ngModelChange)="mSection.set($event)">@for (s of mSections(); track s.id) { <option [ngValue]="s.id">Section {{ s.section_name }}</option> }</select>
          <select class="field" aria-label="Period" [ngModel]="mPeriod()" (ngModelChange)="mPeriod.set($event)">@for (p of periodList(); track p) { <option [ngValue]="p">Period {{ p + 1 }}</option> }</select>
          <button type="button" class="btn-ghost" (click)="open(mSection()!, mPeriod())">Open</button>
        </div>
      </section>
    }

    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (view(); as v) {
      <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <div class="mb-6">
          <h3 class="text-xl font-black tracking-tight">{{ v.section }} · Period {{ v.period + 1 }}{{ time(v.period) }}</h3>
          <p class="text-xs font-bold text-slate-400 mt-1">{{ v.subject?.name ?? 'No lesson in the timetable' }}{{ v.teacher ? ' · ' + v.teacher : '' }}. Students who were absent in the morning start as absent.</p>
          @if (v.meta.lockReason) { <p class="mt-3 text-sm font-bold text-rose-500">{{ v.meta.lockReason }}</p> }
        </div>
        <att-mark-list [(rows)]="rows" [disabled]="!v.meta.canEdit || saving()" [showNote]="false" />
        @if (v.meta.canEdit && rows().length) { <div class="sticky bottom-4 mt-6 flex justify-end"><button type="button" class="btn-primary shadow-enterprise-lg" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save period attendance' }}</button></div> }
      </section>
    }
  </div>
  `
})
export class AttPeriod {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  d = fmtDate; todayIso = today();
  manager = this.auth.canWriteStudents();

  cfg = signal<Cfg | null>(null);
  date = signal(today());
  teachers = signal<{ id: number; name: string }[]>([]);
  teacherId = signal<number | null>(null);
  lessons = signal<Lesson[]>([]);
  note = signal(''); holiday = signal<string | null>(null); loaded = signal(false);
  view = signal<PeriodView | null>(null);
  rows = signal<MarkRow[]>([]);
  error = signal(''); saving = signal(false);
  private cur: { section: number; period: number } | null = null;

  // "any class" picker for the office
  all = signal<MySection[]>([]);
  mClass = signal<number | null>(null); mSection = signal<number | null>(null); mPeriod = signal(0);
  mClasses = computed(() => { const m = new Map<number, { id: number; name: string }>(); for (const s of this.all()) m.set(s.class_id, { id: s.class_id, name: s.class_name }); return [...m.values()]; });
  mSections = computed(() => this.all().filter(s => s.class_id === this.mClass()));
  periodList = computed(() => Array.from({ length: this.cfg()?.periodCount ?? 0 }, (_, i) => i));

  constructor() {
    this.api.get<Cfg>('/attendance/config').subscribe(c => this.cfg.set(c));
    if (this.manager) {
      this.api.get<{ id: number; name: string }[]>('/timetable/teachers').subscribe(t => this.teachers.set(t));
      this.api.get<MySection[]>('/attendance/my-sections').subscribe(s => { this.all.set(s); if (s.length) this.setMClass(s[0].class_id); });
    } else this.loadLessons();
  }

  time(p: number) { const t = this.cfg()?.periods[p]; return t ? ` (${t.start})` : ''; }
  setDate(v: string) { if (v) { this.date.set(v); this.view.set(null); this.loadLessons(); } }
  setTeacher(id: number | null) { this.teacherId.set(id); this.view.set(null); this.loadLessons(); }
  setMClass(id: number) { this.mClass.set(id); this.mSection.set(this.all().find(s => s.class_id === id)?.id ?? null); }
  isOpen(l: Lesson) { return this.cur?.section === l.section_id && this.cur?.period === l.period; }

  loadLessons() {
    if (this.manager && !this.teacherId()) { this.lessons.set([]); this.loaded.set(true); return; }
    this.api.get<{ lessons: Lesson[]; note?: string; holiday?: string | null }>('/attendance/my-lessons', { date: this.date(), teacherId: this.teacherId() ?? undefined }).subscribe({
      next: r => { this.lessons.set(r.lessons); this.note.set(r.note ?? ''); this.holiday.set(r.holiday ?? null); this.loaded.set(true); },
      error: e => { this.error.set(errorText(e)); this.loaded.set(true); }
    });
  }

  open(section: number, period: number) {
    if (!section && section !== 0) return;
    this.error.set(''); this.cur = { section, period };
    this.api.get<PeriodView>('/attendance/period', { sectionId: section, period, date: this.date() }).subscribe({
      next: v => { this.view.set(v); this.rows.set(v.students.map(r => ({ ...r, status: r.status ?? 'P' }))); },
      error: e => { this.view.set(null); this.error.set(errorText(e)); }
    });
  }

  save() {
    const c = this.cur; if (!c) return;
    this.saving.set(true);
    this.api.post('/attendance/period', {
      section_id: c.section, date: this.date(), period: c.period, subject_id: this.view()?.subject?.id,
      entries: this.rows().map(r => ({ student_id: r.id, status: r.status }))
    }).subscribe({
      next: () => { this.saving.set(false); this.toast.show('Period attendance saved.'); this.loadLessons(); this.open(c.section, c.period); },
      error: e => { this.saving.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
}
