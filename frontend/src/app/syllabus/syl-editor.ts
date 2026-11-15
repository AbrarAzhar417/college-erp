import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { CalMonth, CalWeek, ImportRow, Item, KINDS, PLAN_STATUS, PlanFull, SylCfg, fmtDate, kb, monthName, parseCsv, toImportRows, weekDates } from './syl';

interface F { id: number; month: string; week: number; kind: string; topic: string; chapter: string; outcomes: string; activities: string; resources: string; assessment: string; periods: number | string | null }
const blank = (month: string, week: number): F => ({ id: 0, month, week, kind: 'lesson', topic: '', chapter: '', outcomes: '', activities: '', resources: '', assessment: '', periods: null });

@Component({
  selector: 'app-syl-editor',
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  template: `
  @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (d(); as x) {
  <div class="space-y-6">
    <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <a routerLink="/syllabus/plans" class="text-xs font-black text-indigo-600 dark:text-indigo-300">All plans</a>
          <h3 class="text-2xl md:text-3xl font-black tracking-tighter mt-1">{{ x.plan.class_name }} · {{ x.plan.subject }}</h3>
          <p class="text-sm font-bold text-slate-400 mt-1">Session {{ x.plan.session }} · for every section of the class · {{ x.items.length }} topics, {{ totalPeriods() }} periods{{ x.plan.author ? ' · by ' + x.plan.author : '' }}</p>
          <p class="mt-2"><span class="px-3 py-1.5 rounded-lg text-xs font-black" [class]="st(x.plan.status).cls">{{ st(x.plan.status).label }}</span>
            @if (x.plan.status === 'approved') { <span class="ml-3 text-xs font-bold text-slate-400">approved by {{ x.plan.approver }} on {{ d2(x.plan.approved_at) }}</span> }</p>
          @if (x.plan.note) { <p class="mt-2 text-sm font-bold text-amber-700 dark:text-amber-300">Note: {{ x.plan.note }}</p> }
          @if (!x.canEdit) { <p class="mt-2 text-xs font-bold text-slate-400">{{ x.plan.status === 'draft' ? 'You cannot change this plan.' : 'This plan is ' + (x.plan.status === 'approved' ? 'approved' : 'waiting for approval') + ', so it is locked. The office can return it to draft.' }}</p> }
        </div>
        <div class="flex flex-wrap gap-2 lg:justify-end">
          @if (x.canEdit && x.plan.status === 'draft') { <button type="button" class="btn-primary !py-3" (click)="setStatus('submitted')">Send for approval</button> }
          @if (x.plan.status === 'submitted' && x.canApprove) { <button type="button" class="btn-primary !py-3" (click)="setStatus('approved')">Approve</button><button type="button" class="btn-ghost !py-3" (click)="giveBack()">Return to teacher</button> }
          @if (x.plan.status === 'submitted' && !x.canApprove) { <button type="button" class="btn-ghost !py-3" (click)="setStatus('draft')">Withdraw</button> }
          @if (x.plan.status === 'approved' && x.canApprove) { <button type="button" class="btn-ghost !py-3" (click)="setStatus('draft')">Re-open as draft</button> }
          <a [routerLink]="['/syllabus/print/plan']" [queryParams]="{ planId: x.plan.id }" class="btn-ghost !py-3">Print</a>
          <button type="button" class="btn-ghost !py-3" (click)="word()">Word file</button>
          <button type="button" class="btn-ghost !py-3" (click)="showCopy.set(!showCopy())">Copy to…</button>
          @if (x.canApprove || (x.plan.status === 'draft' && x.canEdit)) { <button type="button" class="btn-ghost !py-3 !text-rose-500" (click)="removePlan()">Delete</button> }
        </div>
      </div>
      @if (showCopy()) {
        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50 flex flex-wrap items-end gap-4">
          <div><label class="label" for="cc">Copy these topics to class</label><select id="cc" class="field" [(ngModel)]="copyClass">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
          <div><label class="label" for="cm">If a plan already exists</label><select id="cm" class="field" [(ngModel)]="copyMode"><option value="append">Add to it</option><option value="replace">Replace its topics</option></select></div>
          <button type="button" class="btn-primary" (click)="copy()">Copy</button>
          <p class="text-xs font-bold text-slate-400 basis-full">The new plan is a draft. Change it to suit the class (same subject, same weeks).</p>
        </div>
      }
    </section>

    <div class="flex flex-wrap gap-2">@for (t of tabs; track t.key) { <button type="button" (click)="tab.set(t.key)" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all" [class]="tab() === t.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ t.label }}{{ t.key === 'files' && x.files.length ? ' (' + x.files.length + ')' : '' }}</button> }</div>

    <!-- ================= WEEK PLAN ================= -->
    @if (tab() === 'plan') {
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn-ghost !py-2.5" (click)="expandAll(true)">Open all months</button><button type="button" class="btn-ghost !py-2.5" (click)="expandAll(false)">Close all</button>
        <span class="text-xs font-bold text-slate-400">{{ x.perWeek ? 'This subject has about ' + x.perWeek + ' periods every week.' : '' }} Holidays and exams are shown on each week.</span>
      </div>
      @for (m of months(); track m) {
        <section class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-hidden">
          <button type="button" class="w-full flex items-center justify-between gap-3 px-6 py-5 text-left" (click)="toggle(m)" [attr.aria-expanded]="open().has(m)">
            <span class="text-lg font-black tracking-tight">{{ mn(m) }}</span>
            <span class="text-xs font-bold text-slate-400">{{ count(m) }} topics · {{ periodsIn(m) }} periods {{ open().has(m) ? '▲' : '▼' }}</span>
          </button>
          @if (open().has(m)) {
            <div class="px-4 pb-5 space-y-3">
              @for (w of [1, 2, 3, 4]; track w) {
                @let cw = calWeek(m, w);
                <div class="grid grid-cols-12 gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
                  <div class="col-span-12 md:col-span-3 space-y-1.5">
                    <p class="text-sm font-black">Week {{ w }}</p>
                    @if (cw) { <p class="text-[11px] font-bold text-slate-400">{{ wd(cw) }} · {{ cw.working }} school days</p>
                      @for (h of cw.holidays; track h.date) { <p class="text-[11px] font-black text-slate-500">Holiday: {{ h.name }}</p> }
                      @for (e of cw.exams; track e.id) { <p class="text-[11px] font-black text-rose-600 dark:text-rose-300">Exam: {{ e.name }}</p> }
                      @for (e of cw.events; track e.id) { <p class="text-[11px] font-black text-indigo-600 dark:text-indigo-300">{{ e.title }}</p> } }
                    @if (x.perWeek) { <p class="text-[11px] font-black" [class]="over(m, w) ? 'text-rose-500' : 'text-slate-400'">{{ planned(m, w) }} of {{ capacity(m, w) }} periods planned{{ over(m, w) ? ' (too many)' : '' }}</p> }
                  </div>
                  <div class="col-span-12 md:col-span-9 space-y-2">
                    @for (it of itemsOf(m, w); track it.id; let i = $index; let last = $last) {
                      @if (form() && form()!.id === it.id) { <ng-container *ngTemplateOutlet="formTpl" /> }
                      @else {
                        <div class="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-slate-900">
                          <span class="mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-black" [class]="kind(it.kind).cls">{{ kind(it.kind).label }}</span>
                          <div class="flex-1 min-w-0"><p class="text-sm font-black">{{ it.topic }}</p>
                            <p class="text-[11px] font-bold text-slate-400">{{ it.chapter }}{{ it.chapter && it.periods ? ' · ' : '' }}{{ it.periods ? it.periods + ' periods' : '' }}</p>
                            @if (it.outcomes) { <p class="text-xs text-slate-500 mt-1">{{ it.outcomes }}</p> }</div>
                          @if (x.canEdit) {
                            <span class="flex items-center gap-0.5 shrink-0">
                              <button type="button" class="w-8 h-8 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-30" [disabled]="i === 0" (click)="move(m, w, it.id, -1)" aria-label="Move up">↑</button>
                              <button type="button" class="w-8 h-8 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-30" [disabled]="last" (click)="move(m, w, it.id, 1)" aria-label="Move down">↓</button>
                              <button type="button" class="px-2.5 h-8 rounded-lg text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="edit(it)">Edit</button>
                              <button type="button" class="px-2.5 h-8 rounded-lg text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="remove(it)">Delete</button>
                            </span>
                          }
                        </div>
                      }
                    }
                    @if (form() && form()!.id === 0 && form()!.month === m && form()!.week === w) { <ng-container *ngTemplateOutlet="formTpl" /> }
                    @if (x.canEdit && !(form() && form()!.id === 0 && form()!.month === m && form()!.week === w)) {
                      <div class="flex gap-2">
                        <input class="field !py-2.5 !text-sm" placeholder="Add a topic and press Enter" [attr.aria-label]="'Add a topic to week ' + w + ' of ' + mn(m)" [ngModel]="quick[m + '|' + w] || ''" (ngModelChange)="quick[m + '|' + w] = $event" (keydown.enter)="quickAdd(m, w)">
                        <button type="button" class="px-4 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10 whitespace-nowrap" (click)="addDetailed(m, w)">With details</button>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </section>
      }
    }

    <ng-template #formTpl>
      @if (form(); as f) {
        <div class="p-4 rounded-2xl bg-white dark:bg-slate-900 border-2 border-indigo-500/40 space-y-3">
          <div class="grid grid-cols-12 gap-3">
            <div class="col-span-12 md:col-span-6"><label class="label" for="ft">Topic</label><input id="ft" class="field !py-2.5" [(ngModel)]="f.topic" name="ft"></div>
            <div class="col-span-6 md:col-span-3"><label class="label" for="fc">Chapter / book reference</label><input id="fc" class="field !py-2.5" [(ngModel)]="f.chapter" name="fc" placeholder="Unit 3, pp 20 to 35"></div>
            <div class="col-span-3 md:col-span-2"><label class="label" for="fk">Kind</label><select id="fk" class="field !py-2.5" [(ngModel)]="f.kind" name="fk">@for (k of kindKeys; track k) { <option [value]="k">{{ kind(k).label }}</option> }</select></div>
            <div class="col-span-3 md:col-span-1"><label class="label" for="fp">Periods</label><input id="fp" type="number" min="0" max="40" class="field !py-2.5" [(ngModel)]="f.periods" name="fp"></div>
            <div class="col-span-12 md:col-span-6"><label class="label" for="fo">Learning outcomes (students will be able to…)</label><textarea id="fo" rows="2" class="field !py-2.5" [(ngModel)]="f.outcomes" name="fo"></textarea></div>
            <div class="col-span-12 md:col-span-6"><label class="label" for="fa">Activities and teaching method</label><textarea id="fa" rows="2" class="field !py-2.5" [(ngModel)]="f.activities" name="fa"></textarea></div>
            <div class="col-span-12 md:col-span-4"><label class="label" for="fr">Resources</label><input id="fr" class="field !py-2.5" [(ngModel)]="f.resources" name="fr"></div>
            <div class="col-span-12 md:col-span-4"><label class="label" for="fs">Assessment / homework</label><input id="fs" class="field !py-2.5" [(ngModel)]="f.assessment" name="fs"></div>
            <div class="col-span-6 md:col-span-2"><label class="label" for="fm">Month</label><select id="fm" class="field !py-2.5" [(ngModel)]="f.month" name="fm">@for (m of months(); track m) { <option [value]="m">{{ mn(m) }}</option> }</select></div>
            <div class="col-span-6 md:col-span-2"><label class="label" for="fw">Week</label><select id="fw" class="field !py-2.5" [(ngModel)]="f.week" name="fw"><option [ngValue]="1">Week 1</option><option [ngValue]="2">Week 2</option><option [ngValue]="3">Week 3</option><option [ngValue]="4">Week 4</option></select></div>
          </div>
          <div class="flex gap-2"><button type="button" class="btn-primary !py-2.5" (click)="saveForm()">Save topic</button><button type="button" class="btn-ghost !py-2.5" (click)="form.set(null)">Cancel</button></div>
        </div>
      }
    </ng-template>

    <!-- ================= DETAILS ================= -->
    @if (tab() === 'details') {
      <form (ngSubmit)="saveDetails()" class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5 max-w-3xl">
        <div><label class="label" for="dov">Overview and aims of the subject</label><textarea id="dov" name="dov" rows="4" class="field" [(ngModel)]="det.overview" [disabled]="!x.canEdit"></textarea></div>
        <div><label class="label" for="dbk">Books and references</label><input id="dbk" name="dbk" class="field" [(ngModel)]="det.books" [disabled]="!x.canEdit"></div>
        <div><label class="label" for="das">How the subject is assessed</label><textarea id="das" name="das" rows="3" class="field" [(ngModel)]="det.assessment" [disabled]="!x.canEdit"></textarea></div>
        @if (x.canEdit) { <button class="btn-primary" type="submit">Save</button> }
      </form>
    }

    <!-- ================= IMPORT ================= -->
    @if (tab() === 'import') {
      <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
        <div><h3 class="text-xl font-black tracking-tight">Bring in a syllabus you already have</h3>
          <p class="text-sm font-bold text-slate-400 mt-1">Upload a Word (.docx) file with a table, a CSV file, or paste a table copied from Word or Excel. Columns like Month, Week, Topic, Chapter, Learning outcomes, Activities, Resources, Assessment and Periods are recognised by their headings. Empty Month or Week cells take the value of the row above.</p></div>
        @if (!x.canEdit) { <p class="text-sm font-bold text-amber-600">This plan is locked, so you cannot import into it.</p> }
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="space-y-3"><label class="label !ml-0" for="ifile">Word, CSV or text file</label><input id="ifile" type="file" accept=".docx,.csv,.txt" class="field" (change)="onFile($event)" [disabled]="!x.canEdit">
            <div class="grid grid-cols-2 gap-3"><div><label class="label" for="idm">If a row has no month</label><select id="idm" class="field !py-2.5" [(ngModel)]="defMonth" (ngModelChange)="reparse()">@for (m of cfg()?.months ?? []; track m) { <option [value]="m">{{ mn(m) }}</option> }</select></div>
              <div><label class="label" for="idw">If a row has no week</label><select id="idw" class="field !py-2.5" [(ngModel)]="defWeek" (ngModelChange)="reparse()"><option [ngValue]="1">Week 1</option><option [ngValue]="2">Week 2</option><option [ngValue]="3">Week 3</option><option [ngValue]="4">Week 4</option></select></div></div></div>
          <div class="space-y-3"><label class="label !ml-0" for="ipaste">Or paste a table here</label><textarea id="ipaste" rows="5" class="field" placeholder="Month&#9;Week&#9;Topic&#9;Periods" [(ngModel)]="pasteText" [disabled]="!x.canEdit"></textarea><button type="button" class="btn-ghost" (click)="parsePaste()">Read the pasted table</button></div>
        </div>
        @if (importMsg()) { <p role="alert" class="text-sm font-bold" [class]="importRows().length ? 'text-slate-500' : 'text-rose-500'">{{ importMsg() }}</p> }
        @if (importRows().length) {
          <div class="space-y-3">
            <p class="text-sm font-black">{{ okCount() }} of {{ importRows().length }} rows are ready{{ importRows().length - okCount() ? ' (red rows are missing a topic, month or week and will be skipped)' : '' }}.</p>
            <div class="max-h-96 overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800"><table class="w-full text-left text-xs">
              <thead class="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr class="font-black uppercase tracking-wide text-slate-400"><th class="px-3 py-2">Month</th><th class="px-3 py-2">Week</th><th class="px-3 py-2">Topic</th><th class="px-3 py-2">Chapter</th><th class="px-3 py-2">Periods</th></tr></thead>
              <tbody>@for (r of importRows(); track $index) { <tr class="border-t border-slate-100 dark:border-slate-800" [class.bg-rose-500/10]="!r.ok"><td class="px-3 py-1.5 whitespace-nowrap">{{ r.month ? mn(r.month) : '?' }}</td><td class="px-3 py-1.5">{{ r.week }}</td><td class="px-3 py-1.5 font-bold">{{ r.topic }}</td><td class="px-3 py-1.5">{{ r.chapter }}</td><td class="px-3 py-1.5">{{ r.periods }}</td></tr> }</tbody></table></div>
            <div class="flex flex-wrap items-center gap-4">
              <select class="field !w-64 !py-2.5" [(ngModel)]="importMode" aria-label="Import mode"><option value="append">Add to the existing topics</option><option value="replace">Replace all existing topics</option></select>
              <button type="button" class="btn-primary" (click)="doImport()" [disabled]="!okCount() || !x.canEdit">Import {{ okCount() }} topics</button>
            </div>
          </div>
        }
      </section>
    }

    <!-- ================= FILES ================= -->
    @if (tab() === 'files') {
      <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5 max-w-3xl">
        <div><h3 class="text-xl font-black tracking-tight">Attached files</h3><p class="text-sm font-bold text-slate-400 mt-1">Keep the board's syllabus, a Word or PDF file, datesheets or notes with this plan (up to 10 MB each).</p></div>
        @if (x.canEdit) { <input type="file" class="field" (change)="upload($event)" aria-label="Attach a file"> }
        <ul class="space-y-2">@for (f of x.files; track f.id) {
          <li class="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50 text-sm"><span class="font-black">{{ f.name }} <span class="text-slate-400 font-bold">{{ size(f.size) }} · {{ d2(f.created_at) }}{{ f.by ? ' · ' + f.by : '' }}</span></span>
            <span class="whitespace-nowrap"><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="download(f)">Download</button>@if (x.canEdit) { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="deleteFile(f.id)">Delete</button> }</span></li> }</ul>
        @if (!x.files.length) { <p class="text-sm font-bold text-slate-400">No files attached.</p> }
      </section>
    }

    <!-- ================= VERSIONS ================= -->
    @if (tab() === 'versions') {
      <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5 max-w-3xl">
        <div><h3 class="text-xl font-black tracking-tight">Saved versions</h3><p class="text-sm font-bold text-slate-400 mt-1">A version is saved automatically when the plan is approved. Save one yourself before big changes, and go back to it if needed. Going back removes the progress marks of topics that no longer exist.</p></div>
        @if (x.canEdit) { <div class="flex gap-3"><input class="field" placeholder="Name of this version" [(ngModel)]="versionLabel" aria-label="Version name"><button type="button" class="btn-primary whitespace-nowrap" (click)="saveVersion()">Save a version</button></div> }
        <ul class="space-y-2">@for (v of x.versions; track v.id) {
          <li class="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50 text-sm"><span class="font-black">{{ v.label }} <span class="text-slate-400 font-bold">{{ d2(v.created_at) }}{{ v.by ? ' · ' + v.by : '' }}</span></span>
            @if (x.canEdit) { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="restore(v.id)">Go back to this</button> }</li> }</ul>
        @if (!x.versions.length) { <p class="text-sm font-bold text-slate-400">No versions yet.</p> }
      </section>
    }
  </div>
  }
  `
})
export class SylEditor {
  private api = inject(Api);
  private http = inject(HttpClient);
  private router = inject(Router);
  private toast = inject(ToastService);
  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => Number(p.get('id')))));
  st = (s: string) => PLAN_STATUS[s]; kind = (k: string) => KINDS[k] ?? KINDS['lesson']; kindKeys = Object.keys(KINDS); mn = monthName; wd = weekDates; size = kb;
  d2 = (s: string | null) => fmtDate(s ?? '');
  tabs = [{ key: 'plan', label: 'Week-wise plan' }, { key: 'details', label: 'Overview and books' }, { key: 'import', label: 'Import' }, { key: 'files', label: 'Files' }, { key: 'versions', label: 'Versions' }] as const;
  tab = signal<'plan' | 'details' | 'import' | 'files' | 'versions'>('plan');
  d = signal<PlanFull | null>(null); cfg = signal<SylCfg | null>(null); cal = signal<CalMonth[]>([]); classes = signal<ClassInfo[]>([]);
  open = signal<Set<string>>(new Set()); form = signal<F | null>(null); quick: Record<string, string> = {}; error = signal('');
  det = { overview: '', books: '', assessment: '' };
  showCopy = signal(false); copyClass: number | null = null; copyMode = 'append'; versionLabel = '';
  pasteText = ''; table: string[][] = []; importRows = signal<ImportRow[]>([]); importMsg = signal(''); importMode = 'append'; defMonth = ''; defWeek = 1;

  months = computed(() => [...new Set([...(this.cfg()?.months ?? []), ...(this.d()?.items ?? []).map(i => i.month)])].sort());
  totalPeriods = computed(() => (this.d()?.items ?? []).reduce((a, i) => a + (i.periods ?? 0), 0));
  okCount = computed(() => this.importRows().filter(r => r.ok).length);

  constructor() {
    this.api.get<SylCfg>('/syllabus/config').subscribe(c => { this.cfg.set(c); this.defMonth = c.months[0] ?? ''; this.openDefault(); });
    this.api.get<CalMonth[]>('/syllabus/calendar').subscribe(c => this.cal.set(c));
    this.api.get<ClassInfo[]>('/classes').subscribe(c => { this.classes.set(c); this.copyClass = c[0]?.id ?? null; });
    this.load();
  }
  private openDefault() { const c = this.cfg(); if (c && !this.open().size) this.open.set(new Set([c.months.includes(c.currentMonth) ? c.currentMonth : c.months[0]].filter(Boolean))); }
  load() {
    this.api.get<PlanFull>(`/syllabus/plans/${this.id()}`).subscribe({
      next: p => { this.d.set(p); this.det = { overview: p.plan.overview ?? '', books: p.plan.books ?? '', assessment: p.plan.assessment ?? '' }; this.error.set(''); },
      error: e => this.error.set(errorText(e)) });
  }

  // ---- reading the plan ----
  itemsOf(m: string, w: number): Item[] { return (this.d()?.items ?? []).filter(i => i.month === m && i.week === w); }
  count(m: string) { return (this.d()?.items ?? []).filter(i => i.month === m).length; }
  periodsIn(m: string) { return (this.d()?.items ?? []).filter(i => i.month === m).reduce((a, i) => a + (i.periods ?? 0), 0); }
  planned(m: string, w: number) { return this.itemsOf(m, w).reduce((a, i) => a + (i.periods ?? 0), 0); }
  calWeek(m: string, w: number): CalWeek | undefined { return this.cal().find(x => x.month === m)?.weeks[w - 1]; }
  capacity(m: string, w: number) { const per = this.d()?.perWeek ?? 0, cw = this.calWeek(m, w); return cw && cw.days ? Math.round(((per * cw.working) / cw.days) * 10) / 10 : per; }
  over = (m: string, w: number) => this.planned(m, w) > this.capacity(m, w) + 0.01;
  toggle(m: string) { const s = new Set(this.open()); s.has(m) ? s.delete(m) : s.add(m); this.open.set(s); }
  expandAll(on: boolean) { this.open.set(on ? new Set(this.months()) : new Set()); }

  // ---- changing topics ----
  quickAdd(m: string, w: number) {
    const topic = (this.quick[`${m}|${w}`] ?? '').trim(); if (!topic) return;
    this.api.post('/syllabus/plans/' + this.id() + '/items', { month: m, week: w, topic }).subscribe({ next: () => { this.quick[`${m}|${w}`] = ''; this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  addDetailed(m: string, w: number) { this.form.set(blank(m, w)); }
  edit(it: Item) { this.form.set({ id: it.id, month: it.month, week: it.week, kind: it.kind, topic: it.topic, chapter: it.chapter ?? '', outcomes: it.outcomes ?? '', activities: it.activities ?? '', resources: it.resources ?? '', assessment: it.assessment ?? '', periods: it.periods }); }
  saveForm() {
    const f = this.form(); if (!f) return;
    if (!f.topic.trim()) { this.toast.show('Write the topic first.', 'error'); return; }
    const req = f.id ? this.api.put(`/syllabus/items/${f.id}`, f) : this.api.post(`/syllabus/plans/${this.id()}/items`, f);
    req.subscribe({ next: () => { this.form.set(null); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  remove(it: Item) { if (!confirm(`Delete "${it.topic}"? Its progress marks are deleted too.`)) return; this.api.delete(`/syllabus/items/${it.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
  move(m: string, w: number, id: number, dir: -1 | 1) {
    const ids = this.itemsOf(m, w).map(i => i.id), i = ids.indexOf(id), j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.api.post(`/syllabus/plans/${this.id()}/reorder`, { ids }).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') });
  }
  saveDetails() { this.api.put(`/syllabus/plans/${this.id()}`, this.det).subscribe({ next: () => { this.toast.show('Saved.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }

  // ---- workflow ----
  setStatus(status: string, note?: string) {
    if (status === 'approved' && !confirm('Approve this plan? Teachers can no longer change it.')) return;
    this.api.post(`/syllabus/plans/${this.id()}/status`, { status, note }).subscribe({ next: () => { this.toast.show(status === 'submitted' ? 'Sent for approval.' : status === 'approved' ? 'Plan approved.' : 'Plan is a draft again.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  giveBack() { const note = prompt('What should the teacher change? (optional)') ?? undefined; if (note === undefined) return; this.setStatus('draft', note); }
  removePlan() { if (!confirm('Delete this whole plan with its topics, files and progress? This cannot be undone.')) return; this.api.delete(`/syllabus/plans/${this.id()}`).subscribe({ next: () => this.router.navigate(['/syllabus/plans']), error: e => this.toast.show(errorText(e), 'error') }); }
  copy() {
    if (this.copyMode === 'replace' && !confirm('Replace the topics of the plan in that class?')) return;
    this.api.post<{ id: number; copied: number }>(`/syllabus/plans/${this.id()}/copy`, { class_id: this.copyClass, mode: this.copyMode }).subscribe({ next: r => { this.toast.show(`${r.copied} topics copied.`); this.router.navigate(['/syllabus/plan', r.id]).then(() => location.reload()); }, error: e => this.toast.show(errorText(e), 'error') });
  }

  // ---- Word, files, versions ----
  private saveBlob(blob: Blob, name: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
  word() { const p = this.d()!.plan; this.http.get(`/api/syllabus/plans/${p.id}/export.docx`, { responseType: 'blob' }).subscribe({ next: b => this.saveBlob(b, `Syllabus ${p.class_name} ${p.subject}.docx`), error: () => this.toast.show('The Word file could not be made.', 'error') }); }
  download(f: { id: number; name: string }) { this.http.get(`/api/syllabus/files/${f.id}`, { responseType: 'blob' }).subscribe({ next: b => this.saveBlob(b, f.name), error: () => this.toast.show('The file could not be downloaded.', 'error') }); }
  upload(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { this.toast.show('The file is bigger than 10 MB.', 'error'); return; }
    this.http.post(`/api/syllabus/plans/${this.id()}/files?name=${encodeURIComponent(file.name)}`, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }).subscribe({
      next: () => { this.toast.show('File attached.'); (ev.target as HTMLInputElement).value = ''; this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  deleteFile(id: number) { if (!confirm('Delete this file?')) return; this.api.delete(`/syllabus/files/${id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
  saveVersion() { this.api.post(`/syllabus/plans/${this.id()}/versions`, { label: this.versionLabel }).subscribe({ next: () => { this.versionLabel = ''; this.toast.show('Version saved.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  restore(vid: number) { if (!confirm('Go back to this version? The current plan is saved as "Before restore" first.')) return; this.api.post(`/syllabus/plans/${this.id()}/restore/${vid}`, {}).subscribe({ next: () => { this.toast.show('Version restored.'); this.tab.set('plan'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }

  // ---- import ----
  reparse() { if (this.table.length) this.importTable(this.table); }
  importTable(t: string[][]) {
    this.table = t;
    const rows = toImportRows(t, this.cfg()?.months ?? [], this.defMonth, this.defWeek);
    this.importRows.set(rows); this.importMsg.set(rows.length ? '' : 'No rows with a topic were found in this table.');
  }
  parsePaste() { this.importTable(parseCsv(this.pasteText)); }
  onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
    this.importMsg.set('Reading the file…'); this.importRows.set([]);
    if (/\.docx$/i.test(file.name)) {
      this.http.post<{ tables: string[][][]; lines: string[] }>('/api/syllabus/import/docx', file, { headers: { 'Content-Type': 'application/octet-stream' } }).subscribe({
        next: r => { const best = [...r.tables].sort((a, b) => b.length - a.length)[0]; this.importTable(best ?? r.lines.map(l => [l])); }, error: e => this.importMsg.set(errorText(e)) });
    } else file.text().then(t => this.importTable(parseCsv(t)));
  }
  doImport() {
    const rows = this.importRows().filter(r => r.ok);
    if (this.importMode === 'replace' && !confirm('Replace ALL existing topics of this plan with the imported ones?')) return;
    this.api.post<{ imported: number; skipped: number }>(`/syllabus/plans/${this.id()}/items/bulk`, { mode: this.importMode, rows }).subscribe({
      next: r => { this.toast.show(`${r.imported} topics imported.`); this.importRows.set([]); this.table = []; this.pasteText = ''; this.tab.set('plan'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
}
