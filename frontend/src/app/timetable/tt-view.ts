import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Printer, Lock, Pencil } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { SettingsService } from '../core/settings';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { DAY_NAMES, Slot, Teacher, TtData, buildCells } from './tt';
import { TtGrid } from './tt-grid';

interface SubRow { period: number; time: string; section: string; subject: string; candidates: { id: number; name: string; qualified: boolean; lessonsToday: number }[] }

@Component({
  selector: 'app-tt-view',
  imports: [FormsModule, LucideAngularModule, TtGrid],
  template: `
  <div class="space-y-6">
    <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-4 no-print">
      <div class="flex flex-wrap gap-2">
        @for (m of modes(); track m.key) {
          <button type="button" (click)="setMode(m.key)" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
                  [class]="mode() === m.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ m.label }}</button>
        }
      </div>
      <div class="flex gap-3">
        @if (mode() === 'section' && auth.canTimetable()) {
          <button type="button" class="btn-ghost" (click)="toggleEdit()" [class.!bg-indigo-600]="edit()" [class.!text-white]="edit()"><lucide-icon [img]="editIcon" [size]="16" /> {{ edit() ? 'Done editing' : 'Edit by hand' }}</button>
        }
        <button type="button" class="btn-ghost" (click)="print()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button>
      </div>
    </div>

    <!-- Filters -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl no-print">
      @if (mode() === 'teacher') {
        <select class="field col-span-2" aria-label="Teacher" [ngModel]="teacherId()" (ngModelChange)="setTeacher($event)">
          @for (t of teachers(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
        </select>
      } @else {
        <select class="field" aria-label="Class" [ngModel]="classId()" (ngModelChange)="setClass($event)">
          @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
        </select>
        @if (mode() === 'section') {
          <select class="field" aria-label="Section" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">
            @for (s of sections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }
          </select>
        } @else {
          <select class="field" aria-label="Day" [ngModel]="day()" (ngModelChange)="day.set($event)">
            @for (d of tt.settings()?.days ?? []; track d) { <option [ngValue]="d">{{ dayName(d) }}</option> }
          </select>
        }
      }
    </div>

    @if (edit() && mode() === 'section') {
      <div class="p-4 rounded-2xl bg-indigo-600/10 text-sm font-bold text-indigo-700 dark:text-indigo-300 flex flex-wrap items-center gap-4 no-print">
        <span class="inline-flex gap-2"><button type="button" class="px-3 py-1 rounded-lg" [class]="!build() ? 'bg-indigo-600 text-white' : 'bg-white/60 dark:bg-slate-800'" (click)="setBuild(false)">Move lessons</button><button type="button" class="px-3 py-1 rounded-lg" [class]="build() ? 'bg-indigo-600 text-white' : 'bg-white/60 dark:bg-slate-800'" (click)="setBuild(true)">Build by hand</button></span>
        @if (build()) { <span>Tap any period to choose its subject. Clashes are explained and blocked.</span> } @else { <span>Tap a lesson, then tap where it should go. Clashes are blocked automatically.</span> }
        @if (selected()) { <button type="button" class="btn-ghost !py-2" (click)="toggleLock()"><lucide-icon [img]="lockIcon" [size]="14" /> Lock or unlock this lesson</button> }
      </div>
    }

    <div class="print-area bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <h3 class="text-xl font-black tracking-tight mb-1">{{ heading() }}</h3>
      <p class="text-xs font-bold text-slate-400 mb-6">{{ settings.instituteName() }}</p>

      @if (!loaded()) { <p class="text-sm font-bold text-slate-400">Loading…</p> }
      @else if (slots().length === 0) {
        <p class="text-sm font-bold text-slate-400">Nothing is published here yet. @if (auth.canTimetable()) { Go to "Auto timetable" and generate one. }</p>
      }

      @if (tt.settings(); as s) {
        @if ((slots().length || (edit() && mode() === 'section')) && mode() !== 'day') {
          <tt-grid [days]="s.days" [periods]="tt.periods()" [breakAfter]="s.breakAfter" [cells]="cells()" [editable]="edit() && mode() === 'section'" [selected]="selected()" (cellClick)="onCell($event)" />
          @if (build() && pick(); as pk) {
            <div class="no-print mt-5 p-5 rounded-2xl bg-indigo-600/5 border border-indigo-500/20 space-y-3" role="region" aria-label="Choose subject">
              <div class="flex flex-wrap items-center gap-3"><h4 class="font-black">{{ dayName(pk.day) }}, period {{ pk.period + 1 }}</h4>
                @if (opts()?.current) { <button type="button" class="btn-ghost !py-1" (click)="clearCell()">Clear this period</button> }
                <button type="button" class="btn-ghost !py-1" (click)="pick.set(null)">Close</button></div>
              <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                @for (o of opts()?.lessons ?? []; track o.subject_id) {
                  <button type="button" class="text-left p-3 rounded-xl border text-sm" [disabled]="!o.ok" [class]="o.ok ? 'border-slate-200 dark:border-slate-700 hover:border-indigo-500 bg-white dark:bg-slate-900' : 'border-slate-200 dark:border-slate-800 opacity-60'" (click)="place(o.subject_id)">
                    <span class="font-black block">{{ o.subject }}</span><span class="text-xs font-bold text-slate-500">{{ o.teacher || 'no teacher' }} · {{ o.placed }}/{{ o.planned }} placed</span>
                    @if (!o.ok) { <span class="block text-xs font-bold text-rose-500 mt-1">{{ o.why }}</span> }
                  </button>
                } @empty { <p class="text-sm font-bold text-slate-400">This section has no subjects yet (Curriculum).</p> }
              </div>
            </div>
          }
        }
        @if (slots().length && mode() === 'day') {
          <div class="overflow-x-auto">
            <table class="w-full min-w-[720px] border-separate border-spacing-1.5 text-sm">
              <thead><tr><th class="w-20"></th>@for (p of tt.periods(); track $index) { <th class="text-[11px] font-black text-slate-400 uppercase">P{{ $index + 1 }}<br><span class="font-bold">{{ p.start }}</span></th> }</tr></thead>
              <tbody>
                @for (sec of sections(); track sec.id) {
                  <tr>
                    <th class="text-left font-black">Section {{ sec.name }}</th>
                    @for (p of tt.periods(); track $index; let pi = $index) {
                      @let c = dayCells().get(sec.id + '-' + pi);
                      <td class="p-0">
                        @if (c) { <div class="tt-cell rounded-xl px-2.5 py-2 min-h-[3rem]" [style.--h]="c.hue"><span class="block text-xs font-black leading-tight">{{ c.title }}</span><span class="block text-[10px] font-bold opacity-80">{{ c.sub }}</span></div> }
                        @else { <div class="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 min-h-[3rem]"></div> }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>

    <!-- Substitute finder -->
    @if (mode() === 'teacher' && auth.canTimetable()) {
      <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5 no-print">
        <h3 class="text-xl font-black tracking-tight">Teacher absent? Find substitutes</h3>
        <div class="flex flex-wrap gap-4 items-end">
          <div class="w-48"><label class="label" for="subday">Day</label>
            <select id="subday" class="field" [ngModel]="subDay()" (ngModelChange)="subDay.set($event)">
              @for (d of tt.settings()?.days ?? []; track d) { <option [ngValue]="d">{{ dayName(d) }}</option> }
            </select></div>
          <button type="button" class="btn-primary" (click)="findSubs()">Find substitutes</button>
        </div>
        @if (subs() !== null) {
          @if (subs()!.length === 0) { <p class="text-sm font-bold text-slate-400">This teacher has no lessons on that day.</p> }
          @for (r of subs(); track r.period) {
            <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
              <p class="font-black text-sm">Period {{ r.period + 1 }} ({{ r.time }}) · {{ r.section }} {{ r.subject }}</p>
              <p class="text-sm font-bold text-slate-500 dark:text-slate-400 mt-1">
                @if (r.candidates.length === 0) { No free teacher. }
                @for (c of r.candidates; track c.id; let last = $last) { {{ c.name }}{{ c.qualified ? ' (teaches this subject)' : '' }}, {{ c.lessonsToday }} lessons that day{{ last ? '' : ' · ' }} }
              </p>
            </div>
          }
        }
      </section>
    }
  </div>
  `
})
export class TtView {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  settings = inject(SettingsService);
  tt = inject(TtData);
  printIcon = Printer; lockIcon = Lock; editIcon = Pencil;

  mode = signal<'section' | 'teacher' | 'day'>('section');
  classes = signal<ClassInfo[]>([]);
  teachers = signal<Teacher[]>([]);
  classId = signal<number | null>(null);
  sectionId = signal<number | null>(null);
  teacherId = signal<number | null>(null);
  day = signal(1);
  subDay = signal(1);
  slots = signal<Slot[]>([]);
  loaded = signal(false);
  edit = signal(false);
  selected = signal<string | null>(null);
  build = signal(false);
  pick = signal<{ day: number; period: number } | null>(null);
  opts = signal<{ lessons: { subject_id: number; subject: string; teacher: string | null; planned: number; placed: number; ok: boolean; why: string }[]; current: unknown } | null>(null);
  subs = signal<SubRow[] | null>(null);

  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  dayName = (d: number) => DAY_NAMES[d];

  modes = computed(() => {
    const m: { key: 'section' | 'teacher' | 'day'; label: string }[] = [{ key: 'section', label: 'Section' }, { key: 'teacher', label: 'Teacher' }, { key: 'day', label: 'Whole class by day' }];
    return m;
  });

  cells = computed(() => {
    const teacherMode = this.mode() === 'teacher';
    return buildCells(this.slots().map(s => ({
      day: s.day, period: s.period, subjectId: s.subject_id, grp: s.grp, locked: !!s.locked,
      title: s.subject_name, sub: teacherMode ? `${s.grade}-${s.section_name}` : s.teacher_name
    })));
  });
  dayCells = computed(() => {
    const m = new Map<string, { title: string; sub: string; hue: number }>();
    for (const s of this.slots()) if (s.day === this.day()) m.set(`${s.section_id}-${s.period}`, { title: s.subject_name, sub: s.teacher_name, hue: (s.subject_id * 47 + 12) % 360 });
    return m;
  });
  heading = computed(() => {
    if (this.mode() === 'teacher') return this.teachers().find(t => t.id === this.teacherId())?.name ?? 'Teacher timetable';
    const c = this.classes().find(x => x.id === this.classId());
    if (this.mode() === 'day') return `${c?.name ?? ''} · ${DAY_NAMES[this.day()]}`;
    return `${c?.name ?? ''} · Section ${this.sections().find(s => s.id === this.sectionId())?.name ?? ''}`;
  });

  constructor() {
    this.api.get<Teacher[]>('/timetable/teachers').subscribe(t => this.teachers.set(t));
    this.api.get<ClassInfo[]>('/classes').subscribe(c0 => {
      const c = c0.filter(x => this.tt.inWing(x.id));
      this.classes.set(c);
      if (c.length) { this.classId.set(c[0].id); this.sectionId.set(c[0].sections[0]?.id ?? null); }
      this.api.get<{ teacher: { id: number } | null }>('/timetable/mine').subscribe(m => {
        if (m.teacher && this.auth.isTeacher()) { this.mode.set('teacher'); this.teacherId.set(m.teacher.id); }
        this.load();
      });
    });
    effect(() => {
      const days = this.tt.settings()?.days;
      if (days?.length) {
        if (!days.includes(this.day())) this.day.set(days[0]);
        if (!days.includes(this.subDay())) this.subDay.set(days[0]);
      }
    });
  }

  setMode(m: 'section' | 'teacher' | 'day') {
    this.mode.set(m); this.edit.set(false); this.selected.set(null); this.subs.set(null);
    if (m === 'teacher' && this.teacherId() == null) this.teacherId.set(this.teachers()[0]?.id ?? null);
    this.load();
  }
  setClass(id: number) { this.classId.set(id); this.sectionId.set(this.classes().find(c => c.id === id)?.sections[0]?.id ?? null); this.selected.set(null); this.load(); }
  setSection(id: number) { this.sectionId.set(id); this.selected.set(null); this.load(); }
  setTeacher(id: number) { this.teacherId.set(id); this.subs.set(null); this.load(); }

  load() {
    this.loaded.set(false);
    const q: Record<string, number | undefined> = {};
    if (this.mode() === 'section') q['sectionId'] = this.sectionId() ?? undefined;
    else if (this.mode() === 'teacher') q['teacherId'] = this.teacherId() ?? undefined;
    else q['classId'] = this.classId() ?? undefined;
    if ((this.mode() === 'teacher' && !this.teacherId()) || (this.mode() === 'section' && !this.sectionId())) { this.slots.set([]); this.loaded.set(true); return; }
    this.api.get<Slot[]>('/timetable/slots', q).subscribe({
      next: s => { this.slots.set(this.mode() === 'teacher' ? s.filter(x => this.tt.inWing(x.class_id)) : s); this.loaded.set(true); },
      error: e => { this.toast.show(errorText(e), 'error'); this.loaded.set(true); }
    });
  }

  toggleEdit() { this.edit.set(!this.edit()); this.selected.set(null); }
  print() { window.print(); }

  setBuild(on: boolean) { this.build.set(on); this.selected.set(null); this.pick.set(null); }
  private loadOpts() {
    const p = this.pick(); if (!p) return;
    this.api.get<any>('/timetable/options', { section_id: this.sectionId() ?? undefined, day: p.day, period: p.period }).subscribe({ next: r => this.opts.set(r), error: e => this.toast.show(errorText(e), 'error') });
  }
  place(subjectId: number) {
    const p = this.pick(); if (!p) return;
    this.api.post('/timetable/place', { section_id: this.sectionId(), day: p.day, period: p.period, subject_id: subjectId }).subscribe({
      next: () => { this.toast.show('Placed.'); this.pick.set(null); this.load(); }, error: e => this.toast.show(errorText(e), 'error')
    });
  }
  clearCell() {
    const p = this.pick(); if (!p) return;
    this.api.delete(`/timetable/place?section_id=${this.sectionId()}&day=${p.day}&period=${p.period}`).subscribe({
      next: () => { this.toast.show('Cleared.'); this.pick.set(null); this.load(); }, error: e => this.toast.show(errorText(e), 'error')
    });
  }

  onCell(c: { day: number; period: number }) {
    if (this.build()) { this.pick.set(c); this.opts.set(null); this.loadOpts(); return; }
    const key = `${c.day}-${c.period}`;
    const sel = this.selected();
    if (!sel) { if (this.cells().has(key)) this.selected.set(key); return; }
    if (sel === key) { this.selected.set(null); return; }
    const [fd, fp] = sel.split('-').map(Number);
    this.api.post('/timetable/move', { section_id: this.sectionId(), from: { day: fd, period: fp }, to: { day: c.day, period: c.period } }).subscribe({
      next: () => { this.selected.set(null); this.toast.show('Lesson moved.'); this.load(); },
      error: e => { this.toast.show(errorText(e), 'error'); }
    });
  }

  toggleLock() {
    const sel = this.selected(); if (!sel) return;
    const [d, p] = sel.split('-').map(Number);
    const cur = this.cells().get(sel)?.locked;
    this.api.post('/timetable/lock', { section_id: this.sectionId(), day: d, period: p, locked: !cur }).subscribe({
      next: () => { this.toast.show(cur ? 'Lesson unlocked.' : 'Lesson locked. The generator will keep it here.'); this.load(); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }

  findSubs() {
    this.api.get<SubRow[]>('/timetable/substitutes', { teacher_id: this.teacherId() ?? undefined, day: this.subDay() }).subscribe({
      next: r => this.subs.set(r), error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
