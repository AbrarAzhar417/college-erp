import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { MySection } from '../attendance/att';
import { ExamItem, SheetData, SheetStudent, catClass, deltaText, pctClass, resultClass } from './exam';

@Component({
  selector: 'app-exam-sheet',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="xe">Exam</label>
        <select id="xe" class="field" [ngModel]="examId()" (ngModelChange)="setExam($event)">@for (e of examOptions(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }})</option> }</select></div>
      @if (manager) {
        <div><label class="label" for="xc">Class</label><select id="xc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="xs">Section</label><select id="xs" class="field" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">@for (s of sectionOptions(); track s.id) { <option [ngValue]="s.id">Section {{ s.section_name }}</option> }</select></div>
      } @else {
        <div class="col-span-2"><label class="label" for="xs2">My class</label><select id="xs2" class="field" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.class_name }} - Section {{ s.section_name }}</option> }</select></div>
      }
    </div>
    @if (!sections().length && loaded()) { <p class="p-6 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">You are not the class teacher (incharge) of any section yet. Ask the office to set it in Attendance settings.</p> }
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (data(); as x) {
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn-primary" (click)="makeCalls()"><span>Make parent call (GR) list</span></button>
        <a class="btn-ghost" [routerLink]="['/exams/followups']" [queryParams]="{ examId: x.exam.id, sectionId: x.section.id }">Open parent calls</a>
        <a class="btn-ghost" [routerLink]="['/exams/print/sheet']" [queryParams]="{ examId: x.exam.id, sectionId: x.section.id }">Print sheet</a>
        <a class="btn-ghost" [routerLink]="['/exams/print/cards']" [queryParams]="{ examId: x.exam.id, sectionId: x.section.id }">Print result cards</a>
        <a class="btn-ghost" [routerLink]="['/exams/print/slips']" [queryParams]="{ examId: x.exam.id, sectionId: x.section.id }">Roll number slips</a>
      </div>

      <section class="grid grid-cols-2 xl:grid-cols-4 gap-4">
        @for (k of kpis(); track k.label) { <div class="p-5 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><p class="text-2xl font-black" [class]="k.cls">{{ k.value }}</p><p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p></div> }
      </section>

      @if (pending().length) {
        <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm font-bold">Marks still missing: @for (p of pending(); track p.paper_id; let l = $last) { {{ p.subject }} ({{ p.teacher || 'no teacher' }}) {{ p.entered }}/{{ p.total }}{{ l ? '' : ', ' }} }. Results of students are final only when every subject is entered.</p>
      }

      <section class="bg-white dark:bg-slate-900/40 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
        <table class="w-full text-sm border-separate border-spacing-0" aria-label="Class result sheet">
          <thead>
            <tr class="text-[11px] font-black text-slate-400 uppercase tracking-wide">
              <th class="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-3 text-left">Roll</th><th class="sticky left-10 z-10 bg-white dark:bg-slate-900 px-3 py-3 text-left min-w-44">Student</th><th class="px-2">Cat</th>
              @for (p of x.papers; track p.paper_id) { <th class="px-2 py-3 text-center min-w-16" [title]="p.teacher ?? ''">{{ p.subject }}<br><span class="font-bold normal-case">/{{ p.max_marks }}</span></th> }
              <th class="px-3 text-center">Total</th><th class="px-3 text-center">%</th><th class="px-2 text-center">Grade</th><th class="px-3 text-center">Result</th><th class="px-2 text-center">Rank</th>
              <th class="px-3 text-center">{{ x.prevExam ? x.prevExam.name + ' %' : 'Before' }}</th><th class="px-3 text-center">Change</th><th class="px-3 text-center">Call</th>
            </tr>
          </thead>
          <tbody>
            @for (s of x.students; track s.id) {
              <tr [class]="s.result === 'FAIL' ? 'bg-rose-500/5' : s.reason === 'down' ? 'bg-amber-500/5' : ''">
                <td class="sticky left-0 bg-white dark:bg-slate-900 px-3 py-2 font-black text-slate-400">{{ s.roll_no ?? '-' }}</td>
                <td class="sticky left-10 bg-white dark:bg-slate-900 px-3 py-2 font-black whitespace-nowrap">{{ s.name }}</td>
                <td class="px-2 text-center">@if (s.category) { <span class="px-2 py-0.5 rounded-md text-[10px] font-black" [class]="cat(s.category)">{{ s.category }}</span> }</td>
                @for (p of x.papers; track p.paper_id) {
                  @let m = s.marks[p.subject_id];
                  <td class="px-2 text-center font-bold" [class]="m?.pass === false ? 'text-rose-600 font-black' : ''">{{ m?.status === 'A' ? 'A' : m?.status === 'L' ? 'L' : m?.marks ?? '·' }}</td>
                }
                <td class="px-3 text-center font-black">{{ s.max ? s.total + '/' + s.max : '-' }}</td>
                <td class="px-3 text-center font-black" [class]="pc(s.pct, x.exam.pass_percent)">{{ s.pct ?? '-' }}</td>
                <td class="px-2 text-center font-black">{{ s.grade ?? '' }}</td>
                <td class="px-3 text-center"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="rc(s.result)">{{ s.result === 'INCOMPLETE' ? 'Pending' : s.result === 'PASS' ? 'Pass' : 'Fail' }}</span></td>
                <td class="px-2 text-center font-black">{{ s.rank ?? '-' }}</td>
                <td class="px-3 text-center text-slate-500 font-bold">{{ s.prev?.pct ?? '-' }}</td>
                <td class="px-3 text-center font-black whitespace-nowrap" [class]="s.trend === 'up' ? 'text-emerald-600' : s.trend === 'down' ? 'text-rose-500' : 'text-slate-400'">
                  @if (s.delta !== null) { {{ s.trend === 'up' ? '▲' : s.trend === 'down' ? '▼' : '=' }} {{ dt(s.delta) }}@if (s.rankChange) { <span class="text-[10px]"> ({{ s.rankChange > 0 ? '+' : '' }}{{ s.rankChange }} rank)</span> } } @else { - }
                </td>
                <td class="px-3 text-center">@if (s.needsCall) { <span class="px-2.5 py-1 rounded-lg text-[10px] font-black bg-rose-500/15 text-rose-700 dark:text-rose-300">{{ s.reason === 'both' ? 'Fail+Down' : s.reason === 'fail' ? 'Fail' : 'Down' }}</span> }</td>
              </tr>
            }
          </tbody>
        </table>
        @if (!x.students.length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No students in this section.</p> }
        <p class="px-4 py-3 text-[11px] font-bold text-slate-400">A absent · L leave · red = failed subject · Call = student who failed or whose percentage fell by {{ x.dropPct }} points or more.</p>
      </section>

      <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-xl font-black tracking-tight">Subject results (subject teachers)</h3>
        <div class="overflow-x-auto"><table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="py-3 pr-4">Subject</th><th class="py-3 pr-4">Teacher</th><th class="py-3 pr-4 text-right">Average %</th><th class="py-3 pr-4 text-right">Highest</th><th class="py-3 pr-4 text-right">Lowest</th><th class="py-3 pr-4 text-right">Pass %</th><th class="py-3 text-right">Failed</th></tr></thead>
          <tbody>@for (p of x.papers; track p.paper_id) { <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="py-2.5 pr-4 font-black">{{ p.subject }}</td><td class="py-2.5 pr-4 text-slate-500">{{ p.teacher || '-' }}</td><td class="py-2.5 pr-4 text-right font-bold">{{ p.avgPct ?? '-' }}</td><td class="py-2.5 pr-4 text-right">{{ p.highest ?? '-' }}</td><td class="py-2.5 pr-4 text-right">{{ p.lowest ?? '-' }}</td><td class="py-2.5 pr-4 text-right font-black" [class]="pc(p.passPct, 70)">{{ p.passPct ?? '-' }}</td><td class="py-2.5 text-right font-bold text-rose-500">{{ p.failed }}</td></tr> }</tbody></table></div>
      </section>
    }
  </div>
  `
})
export class ExamSheet {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  manager = this.auth.canWriteStudents();
  cat = catClass; rc = resultClass; pc = pctClass; dt = deltaText;
  exams = signal<ExamItem[]>([]); sections = signal<MySection[]>([]); loaded = signal(false);
  examId = signal<number | null>(null); classId = signal<number | null>(null); sectionId = signal<number | null>(null);
  data = signal<SheetData | null>(null); error = signal('');
  classes = computed(() => { const m = new Map<number, { id: number; name: string }>(); for (const s of this.sections()) m.set(s.class_id, { id: s.class_id, name: s.class_name }); return [...m.values()]; });
  sectionOptions = computed(() => this.sections().filter(s => s.class_id === this.classId()));
  examOptions = computed(() => { const cn = this.sections().find(s => s.id === this.sectionId())?.class_name; return this.exams().filter(e => !cn || e.classes.includes(cn)); });
  pending = computed(() => (this.data()?.papers ?? []).filter(p => p.entered < p.total));
  kpis = computed(() => {
    const s = this.data()?.stats; if (!s) return [];
    return [{ label: 'Pass', value: `${s.pass} of ${s.complete}`, cls: 'text-emerald-600' }, { label: 'Fail', value: String(s.fail), cls: 'text-rose-500' }, { label: 'Pass percentage', value: s.passPct === null ? '-' : s.passPct + '%', cls: '' },
      { label: 'Class average', value: s.avg === null ? '-' : s.avg + '%', cls: '' }, { label: 'Highest / lowest', value: s.highest === null ? '-' : `${s.highest}% / ${s.lowest}%`, cls: '' }, { label: 'Results pending', value: String(s.incomplete), cls: s.incomplete ? 'text-amber-500' : '' },
      { label: 'Need a parent call', value: String(s.needCall), cls: s.needCall ? 'text-rose-500' : '' }];
  });

  constructor() {
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    this.api.get<ExamItem[]>('/exam/exams').subscribe(e => { this.exams.set(e); this.examId.set(Number(qp.get('examId')) || e.find(x => x.entered > 0)?.id || e[0]?.id || null); this.load(); });
    this.api.get<MySection[]>('/attendance/my-sections').subscribe({
      next: list => { this.sections.set(list); this.loaded.set(true); const pick = list.find(s => s.id === Number(qp.get('sectionId'))) ?? list[0]; if (pick) { this.classId.set(pick.class_id); this.sectionId.set(pick.id); this.fixExam(); this.load(); } },
      error: e => this.error.set(errorText(e)) });
  }
  private fixExam() { const o = this.examOptions(); if (o.length && !o.some(e => e.id === this.examId())) this.examId.set(o[0].id); }
  setExam(id: number) { this.examId.set(id); this.load(); }
  setClass(id: number) { this.classId.set(id); this.sectionId.set(this.sections().find(s => s.class_id === id)?.id ?? null); this.fixExam(); this.load(); }
  setSection(id: number) { this.sectionId.set(id); this.fixExam(); this.load(); }

  load() {
    const e = this.examId(), s = this.sectionId(); if (!e || !s) return;
    this.error.set('');
    this.api.get<SheetData>(`/exam/exams/${e}/sheet`, { sectionId: s }).subscribe({ next: d => this.data.set(d), error: x => { this.data.set(null); this.error.set(errorText(x)); } });
  }
  makeCalls() {
    const x = this.data(); if (!x) return;
    this.api.post<{ created: number; kept: number }>(`/exam/exams/${x.exam.id}/followups/generate`, { sectionId: x.section.id }).subscribe({
      next: r => this.toast.show(r.created ? `${r.created} students added to the parent call list.` : r.kept ? 'The call list is already made. Open Parent calls.' : 'No student needs a call in this exam.'),
      error: e => this.toast.show(errorText(e), 'error') });
  }
}
