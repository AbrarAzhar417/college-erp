import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { ExamCfg, ExamItem, FU_STATUS, Followup, REASON_LABEL, catClass, fmtDate, phones, today } from './exam';

@Component({
  selector: 'app-exam-followups',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="fe">Exam</label><select id="fe" class="field" [ngModel]="examId()" (ngModelChange)="set('examId', $event)"><option [ngValue]="null">All exams</option>@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }</select></div>
      @if (manager) {
        <div><label class="label" for="fc">Class</label><select id="fc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)"><option [ngValue]="null">All</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="fs">Section</label><select id="fs" class="field" [ngModel]="sectionId()" (ngModelChange)="set('sectionId', $event)" [disabled]="!classId()"><option [ngValue]="null">All</option>@for (s of secs(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }</select></div>
      }
      <div><label class="label" for="ft">Status</label><select id="ft" class="field" [ngModel]="status()" (ngModelChange)="set('status', $event)"><option value="">Any</option>@for (k of statusKeys; track k) { <option [value]="k">{{ fs(k) }}</option> }</select></div>
      <div><label class="label" for="fk">Category</label><select id="fk" class="field" [ngModel]="category()" (ngModelChange)="set('category', $event)"><option value="">Any</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="-">Not set</option></select></div>
    </div>

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <h3 class="text-lg font-black tracking-tight">Call parents to a meeting (PTM)</h3>
      @if (cfg(); as c) {
        <p class="text-xs font-bold text-slate-400">Categories A and B meet at <b>{{ c.categories.A.venue }}</b>. Category C meets at <b>{{ c.categories.C.venue }}</b>. Choose the date for each place, tick the students and press Set.</p>
      }
      <div class="flex flex-wrap items-end gap-4">
        <div><label class="label" for="pk">Date for A and B ({{ cfg()?.categories?.A?.venue }})</label><input id="pk" type="date" class="field" [(ngModel)]="dateKmcb"></div>
        <div><label class="label" for="pg">Date for C ({{ cfg()?.categories?.C?.venue }})</label><input id="pg" type="date" class="field" [(ngModel)]="dateGovt"></div>
        <button type="button" class="btn-primary" (click)="schedule()" [disabled]="!selected().size">Set meeting for {{ selected().size }} selected</button>
        <a class="btn-ghost" [routerLink]="['/exams/print/letters']" [queryParams]="printQuery()">Print parent letters</a>
        <a class="btn-ghost" [routerLink]="['/exams/print/calls']" [queryParams]="printQuery()">Print call list</a>
      </div>
    </section>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="flex items-center gap-4"><label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [checked]="allSelected()" (change)="toggleAll()"> Select all ({{ rows().length }})</label></div>
    <div class="space-y-3">
      @for (f of rows(); track f.id) {
        <section class="bg-white dark:bg-slate-900/40 p-5 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise" [class.ring-2]="selected().has(f.id)" [class.ring-indigo-400]="selected().has(f.id)">
          <div class="grid grid-cols-12 gap-4 items-start">
            <label class="col-span-1 pt-1"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [checked]="selected().has(f.id)" (change)="toggle(f.id)" [attr.aria-label]="'Select ' + f.name"></label>
            <div class="col-span-11 md:col-span-4">
              <p class="text-base font-black">{{ f.name }} <span class="px-2 py-0.5 rounded-md text-[10px] font-black" [class]="cc(f.category)">{{ f.category ?? 'No category' }}</span></p>
              <p class="text-xs font-bold text-slate-400">S/O {{ f.father_name }} · {{ f.class_name }}-{{ f.section_name }} · Roll {{ f.roll_no ?? '-' }}</p>
              @if (f.p_number) { <p class="text-xs font-black text-indigo-600 dark:text-indigo-300 mt-1">P number: {{ f.p_number }}</p> }
              <p class="mt-2 text-xs font-bold">@for (p of ph(f); track p) { <a [href]="'tel:' + p" class="inline-block mr-3 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-indigo-500">{{ p }}</a> } @if (!ph(f).length) { <span class="text-rose-500">No phone number</span> }</p>
            </div>
            <div class="col-span-12 md:col-span-3">
              <p class="text-xs font-black text-rose-600 dark:text-rose-300">{{ rl(f.reason) }}</p>
              <p class="text-sm font-black mt-1">{{ f.exam_name }}: {{ f.pct ?? '-' }}%{{ f.prev_pct !== null ? ' (before ' + f.prev_pct + '%)' : '' }}</p>
              @if (f.failed) { <p class="text-xs font-bold text-slate-500 mt-1">Failed: {{ f.failed }}</p> }
              <p class="text-xs font-bold text-slate-400 mt-2">Meeting place: <b>{{ f.venue || 'Set the category first' }}</b></p>
            </div>
            <div class="col-span-12 md:col-span-4 space-y-2">
              <div class="grid grid-cols-2 gap-2">
                <select class="field !py-2 !text-xs" [(ngModel)]="f.status" [name]="'s' + f.id" aria-label="Status">@for (k of statusKeys; track k) { <option [value]="k">{{ fs(k) }}</option> }</select>
                <input type="date" class="field !py-2 !text-xs" [(ngModel)]="f.call_date" [name]="'c' + f.id" aria-label="Call date" title="Date of the call">
                <input type="date" class="field !py-2 !text-xs" [(ngModel)]="f.ptm_date" [name]="'p' + f.id" aria-label="Meeting date" title="Meeting date">
                <button type="button" class="btn-ghost !py-2" (click)="save(f)">Save</button>
              </div>
              <input class="field !py-2 !text-xs" placeholder="What the parent said" [(ngModel)]="f.notes" [name]="'n' + f.id" aria-label="Notes">
            </div>
          </div>
        </section>
      }
    </div>
    @if (loaded() && !rows().length) { <p class="text-sm font-bold text-slate-400">No parent calls here. Open the Class sheet of a section and press "Make parent call (GR) list".</p> }
  </div>
  `
})
export class ExamFollowups {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  manager = this.auth.canWriteStudents();
  cc = catClass; fs = (k: string) => FU_STATUS[k]; rl = (k: string) => REASON_LABEL[k] ?? k; ph = phones; d = fmtDate;
  statusKeys = Object.keys(FU_STATUS);
  cfg = signal<ExamCfg | null>(null); exams = signal<ExamItem[]>([]); classList = signal<ClassInfo[]>([]);
  examId = signal<number | null>(null); classId = signal<number | null>(null); sectionId = signal<number | null>(null); status = signal(''); category = signal('');
  rows = signal<Followup[]>([]); selected = signal<Set<number>>(new Set()); error = signal(''); loaded = signal(false);
  dateKmcb = today(); dateGovt = today();
  classes = computed(() => this.classList());
  secs = computed(() => this.classList().find(c => c.id === this.classId())?.sections ?? []);
  allSelected = computed(() => this.rows().length > 0 && this.selected().size === this.rows().length);

  constructor() {
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    if (qp.get('examId')) this.examId.set(Number(qp.get('examId')));
    if (qp.get('sectionId')) this.sectionId.set(Number(qp.get('sectionId')));
    this.api.get<ExamCfg>('/exam/config').subscribe(c => this.cfg.set(c));
    this.api.get<ExamItem[]>('/exam/exams').subscribe(e => this.exams.set(e));
    this.api.get<ClassInfo[]>('/classes').subscribe(c => { this.classList.set(c); const s = c.find(x => x.sections.some(y => y.id === this.sectionId())); if (s) this.classId.set(s.id); });
    this.load();
  }
  set(k: 'examId' | 'sectionId' | 'status' | 'category', v: any) { (this[k] as any).set(v); this.load(); }
  setClass(id: number | null) { this.classId.set(id); this.sectionId.set(null); this.load(); }
  printQuery() { return { examId: this.examId() ?? undefined, classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined, status: this.status() || undefined, category: this.category() || undefined, ids: this.selected().size ? [...this.selected()].join(',') : undefined }; }

  load() {
    this.api.get<Followup[]>('/exam/followups', { examId: this.examId() ?? undefined, classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined, status: this.status(), category: this.category() })
      .subscribe({ next: r => { this.rows.set(r); this.selected.set(new Set()); this.loaded.set(true); this.error.set(''); }, error: e => { this.error.set(errorText(e)); this.loaded.set(true); } });
  }
  toggle(id: number) { const s = new Set(this.selected()); s.has(id) ? s.delete(id) : s.add(id); this.selected.set(s); }
  toggleAll() { this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map(r => r.id))); }

  save(f: Followup) {
    this.api.put(`/exam/followups/${f.id}`, { status: f.status, call_date: f.call_date, ptm_date: f.ptm_date, notes: f.notes }).subscribe({ next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error') });
  }
  schedule() {
    this.api.post<{ scheduled: number }>('/exam/followups/schedule', { ids: [...this.selected()], ptm_date_kmcb: this.dateKmcb, ptm_date_govt: this.dateGovt }).subscribe({
      next: r => { this.toast.show(`Meeting date set for ${r.scheduled} students.`); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
}
