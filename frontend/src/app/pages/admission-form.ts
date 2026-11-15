import { SettingsService } from '../core/settings';
import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { qrSvg } from '../core/qr';
import { ToastService } from '../core/toast';
import { CatPreview } from '../fee/fee-categories';
import { fmtDate, money } from '../fee/fee';
import { Sibling } from './students';
import { TransportPicker, TrRoute } from './transport-picker';
import { SchoolForm } from './admission/school-form';
import { CollegeForm } from './admission/college-form';
import { BOARDS, Entry, ENTRIES } from './admission/form-entries';
import { PhotoCropper } from './photo-cropper';
import { RegistrationForm } from './admission/registration-form';
import { Chart, ChartRow, Exam, FeeView, FormView, GROUPS, Marks, dateInWords, fmtCnic, fmtPhone } from './admission/form-data';

interface Full {
  id: number; reg_no: string; name: string; father_name: string; gender: string; dob: string | null; phone: string | null; address: string | null; roll_no: number | null;
  father_cnic: string | null; category: 'A' | 'B' | 'C' | null; p_number: string | null; father_phone: string | null; mother_phone: string | null; photo?: string | null;
  admission_date: string; section_id: number; section_name: string; class_id: number; grade: number; class_name: string;
  tr_route_id: number | null; tr_stop_id: number | null; tr_mode: string | null;
}
interface ClassData { id: number; name: string; grade: number; sections: { id: number; name: string }[] }
type Info = Record<string, any>;
const when = (f: string) => (f === 'monthly' ? 'Every month' : f === 'annual' ? 'Every year' : 'One time');

export interface PrintSetup { size: 'a4' | 'letter' | 'legal' | 'a5'; orient: 'portrait' | 'landscape'; top: number; right: number; bottom: number; left: number; scale: number }
const PAPERS = [
  { k: 'a4', label: 'A4 (210 x 297 mm)', w: 210, h: 297 }, { k: 'letter', label: 'Letter (216 x 279 mm)', w: 216, h: 279 },
  { k: 'legal', label: 'Legal (216 x 356 mm)', w: 216, h: 356 }, { k: 'a5', label: 'A5 (148 x 210 mm)', w: 148, h: 210 },
];
const DEFAULT_PS: PrintSetup = { size: 'a4', orient: 'portrait', top: 8, right: 8, bottom: 8, left: 8, scale: 100 };
const PS_KEY = 'erp.formPrint';
function loadSetup(): PrintSetup {
  try {
    const o = JSON.parse(localStorage.getItem(PS_KEY) ?? 'null');
    if (o && PAPERS.some(z => z.k === o.size) && ['portrait', 'landscape'].includes(o.orient)) return { ...DEFAULT_PS, ...o };
  } catch { /* ignore */ }
  return { ...DEFAULT_PS };
}

@Component({
  selector: 'app-admission-form',
  imports: [LucideAngularModule, FormsModule, RouterLink, SchoolForm, CollegeForm, RegistrationForm, TransportPicker, PhotoCropper],
  template: `
  <div class="no-print space-y-4 mb-6">
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="btn-primary" (click)="print()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button>
      <a routerLink="/students" class="btn-ghost">&larr; Students</a>
      <div class="flex gap-2" role="group" aria-label="Which form">
        <button type="button" class="btn-ghost" [class.!bg-indigo-600]="type() === 'registration'" [class.!text-white]="type() === 'registration'" (click)="pick('registration')">Registration form (all students)</button>
        <button type="button" class="btn-ghost" [class.!bg-indigo-600]="type() === 'school'" [class.!text-white]="type() === 'school'" (click)="pick('school')">Application form (VI - IX)</button>
        <button type="button" class="btn-ghost" [class.!bg-indigo-600]="type() === 'college'" [class.!text-white]="type() === 'college'" (click)="pick('college')">College form (HSSC)</button>
      </div>
      @if (isBlank) {
        <div class="flex items-center gap-2"><label class="label !mb-0" for="af-class">Fee chart for</label>
          <select id="af-class" class="field !w-auto" [ngModel]="chartClass()" (ngModelChange)="pickChart($event)"><option [ngValue]="null">No chart (leave the fee lines empty)</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <span class="text-sm font-bold text-slate-400">Blank form to be filled by hand.</span>
      }
    </div>
    <details class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4" aria-label="Print settings">
      <summary class="cursor-pointer font-black text-sm">Print settings: {{ sizeLabel() }}, {{ ps().orient }}, margins {{ ps().top }}/{{ ps().right }}/{{ ps().bottom }}/{{ ps().left }} mm, scale {{ ps().scale }}%</summary>
      <div class="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
        <div><label class="label" for="ps-size">Paper size</label>
          <select id="ps-size" class="field" [ngModel]="ps().size" (ngModelChange)="setPs('size', $event)">@for (z of sizes; track z.k) { <option [value]="z.k">{{ z.label }}</option> }</select></div>
        <div><label class="label" for="ps-or">Orientation</label>
          <select id="ps-or" class="field" [ngModel]="ps().orient" (ngModelChange)="setPs('orient', $event)"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>
        <div><label class="label" for="ps-t">Top margin (mm)</label><input id="ps-t" type="number" min="0" max="40" class="field" [ngModel]="ps().top" (ngModelChange)="setPs('top', $event)" /></div>
        <div><label class="label" for="ps-r">Right margin (mm)</label><input id="ps-r" type="number" min="0" max="40" class="field" [ngModel]="ps().right" (ngModelChange)="setPs('right', $event)" /></div>
        <div><label class="label" for="ps-b">Bottom margin (mm)</label><input id="ps-b" type="number" min="0" max="40" class="field" [ngModel]="ps().bottom" (ngModelChange)="setPs('bottom', $event)" /></div>
        <div><label class="label" for="ps-l">Left margin (mm)</label><input id="ps-l" type="number" min="0" max="40" class="field" [ngModel]="ps().left" (ngModelChange)="setPs('left', $event)" /></div>
        <div><label class="label" for="ps-s">Scale (%)</label><input id="ps-s" type="number" min="50" max="130" class="field" [ngModel]="ps().scale" (ngModelChange)="setPs('scale', $event)" /></div>
        <div class="flex items-end"><button type="button" class="btn-ghost" (click)="resetPs()">Reset</button></div>
      </div>
      <p class="text-xs font-bold text-slate-400 mt-2">In the browser print window keep "Margins: Default" and "Scale: 100%", and pick the same paper size. Settings are remembered on this computer. Lower the scale if a page spills onto a second sheet.</p>
    </details>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

  </div>

  @if (cropFile(); as cf) { <app-photo-cropper [file]="cf" (done)="onCrop($event)" (cancel)="cropFile.set(null)" /> }
  <div [class]="showPanel() ? 'grid gap-6 items-start print:block xl:grid-cols-[27rem_minmax(0,1fr)]' : ''">
      @if (!isBlank && st() && auth.canWriteStudents()) {
        <section class="no-print xl:sticky xl:top-3 xl:max-h-[calc(100vh-1.5rem)] xl:overflow-y-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-6" aria-label="Fill in the form">
          <div class="flex flex-wrap items-center gap-3"><h2 class="font-black text-lg">{{ isNew ? 'New admission' : 'Details' }}: fill in the order of the form</h2>
            <span class="text-xs font-bold text-slate-400">Whatever you type is written on the form below at once. Save when done, then print.</span></div>
          @for (sec of sections(); track sec.title) {
            <div><h3 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">{{ sec.title }}</h3>
              <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                @for (e of sec.items; track $index) {
                  @switch (e.t) {
                    @case ('auto') { <div><span class="label">{{ e.label }}</span><div class="field !bg-slate-100 dark:!bg-slate-800 font-black">{{ st()?.reg_no || 'Given when saved' }}</div></div> }
                    @case ('category') { <div><label class="label" for="e-cat">{{ e.label }}</label><select id="e-cat" class="field" [ngModel]="cat()" (ngModelChange)="setCat($event)"><option value="">Not set</option><option value="A">A - Father working in KRL</option><option value="B">B - Father retired from KRL</option><option value="C">C - Father in private job</option></select></div> }
                    @case ('class') {
                      <div><label class="label" for="e-class">Class</label><select id="e-class" class="field" [ngModel]="d('class_id')" (ngModelChange)="setClass($event)"><option [ngValue]="null" disabled>Choose class</option>@for (c of formClasses(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
                      <div><label class="label" for="e-sec">Section</label><select id="e-sec" class="field" [ngModel]="d('section_id')" (ngModelChange)="setSt('section_id', $event)" [disabled]="!d('class_id')"><option [ngValue]="null" disabled>Choose section</option>@for (x of sectionList(); track x.id) { <option [ngValue]="x.id">Section {{ x.name }}</option> }</select></div>
                    }
                    @case ('photo') {
                      <div class="flex items-center gap-3">@if (d('photo')) { <img [src]="d('photo')" alt="Student photo" class="w-12 h-[3.75rem] rounded-lg object-cover border border-slate-200"> }
                        <label class="btn-ghost cursor-pointer inline-block">{{ d('photo') ? 'Change photo' : 'Choose photo' }}<input type="file" accept="image/*" class="hidden" (change)="pickPhoto($event)"></label>
                        @if (d('photo')) { <button type="button" class="btn-ghost" (click)="setSt('photo', '')">Remove</button> }</div>
                    }
                    @case ('transport') {
                      <div class="sm:col-span-2 lg:col-span-3"><app-transport-picker [routes]="routes()" [savedRouteId]="savedRoute()" [routeId]="routeId()" (routeIdChange)="setRoute($event)" [stopId]="stopId()" (stopIdChange)="stopId.set($event)" [mode]="mode()" (modeChange)="mode.set($event)" /></div>
                      @if (fee(); as f) { <p class="sm:col-span-2 lg:col-span-3 text-sm font-bold text-slate-500">Monthly fee <b>Rs {{ mny(f.monthly) }}</b>{{ f.once ? ' · one-time Rs ' + mny(f.once) : '' }} · payable at admission <b>Rs {{ mny(f.firstPayable) }}</b></p> }
                    }
                    @case ('sibs') {
                      <div class="sm:col-span-2 lg:col-span-3 space-y-2">@for (i of range(e.n ?? 4); track i) {
                        <div class="grid grid-cols-2 gap-3"><input class="field" [attr.aria-label]="'Brother or sister ' + (i + 1) + ' name'" [placeholder]="'Name ' + (i + 1)" [ngModel]="sibList()[i]?.name || ''" (ngModelChange)="setSib(i, 'name', $event)"><input class="field" [attr.aria-label]="'Brother or sister ' + (i + 1) + ' class and session'" placeholder="Class and session" [ngModel]="sibList()[i]?.class_session || ''" (ngModelChange)="setSib(i, 'class_session', $event)"></div> }</div>
                    }
                    @case ('exam') {
                      <div class="sm:col-span-2 lg:col-span-3"><span class="label">{{ e.label }}</span><div class="grid grid-cols-2 sm:grid-cols-7 gap-2">@for (x of examParts; track x[0]) {
                      @if (x[0] === 'board') { <select class="field" [attr.aria-label]="e.label + ' board'" [ngModel]="info()[e.p + '_board'] || ''" (ngModelChange)="setInfo(e.p + '_board', $event)"><option value="">Board</option>@for (b of boards; track b) { <option [value]="b">{{ b }}</option> }@if (info()[e.p + '_board'] && !boards.includes(info()[e.p + '_board'])) { <option [value]="info()[e.p + '_board']">{{ info()[e.p + '_board'] }}</option> }</select> }
                      @else { <input class="field" [attr.aria-label]="e.label + ' ' + x[1]" [placeholder]="x[1]" [ngModel]="info()[e.p + '_' + x[0]] || ''" (ngModelChange)="setInfo(e.p + '_' + x[0], $event)"> } }</div></div>
                    }
                    @default {
                      <div [class.sm:col-span-2]="e.wide" [class.lg:col-span-2]="e.wide"><label class="label" [attr.for]="'e-' + e.k">{{ e.label }}</label>
                        @switch (e.kind) {
                          @case ('date') { <input [id]="'e-' + e.k" type="date" class="field" [ngModel]="val(e)" (ngModelChange)="put(e, $event)"> }
                          @case ('group') { <select [id]="'e-' + e.k" class="field" [ngModel]="val(e)" (ngModelChange)="put(e, $event)"><option value="">-</option>@for (o of groupList; track o) { <option [value]="o">{{ o }}</option> }</select> }
                          @case ('yesno') { <select [id]="'e-' + e.k" class="field" [ngModel]="val(e)" (ngModelChange)="put(e, $event)"><option value="">-</option><option value="no">No</option><option value="yes">Yes</option></select> }
                          @case ('gender') { <select [id]="'e-' + e.k" class="field" [ngModel]="val(e)" (ngModelChange)="put(e, $event)"><option value="male">Boy</option><option value="female">Girl</option></select> }
                          @case ('decision') { <select [id]="'e-' + e.k" class="field" [ngModel]="val(e)" (ngModelChange)="put(e, $event)"><option value="">Not decided</option><option value="granted">Admission granted</option><option value="not_granted">Admission not granted</option><option value="recommended">Recommended</option></select> }
                          @case ('pick') {
                            <select [id]="'e-' + e.k" class="field" [ngModel]="pickSel(e)" (ngModelChange)="pickSet(e, $event)"><option value="">-</option>@for (o of e.opts; track o) { <option [value]="o">{{ o }}</option> }<option value="__other">Other (type it)</option></select>
                            @if (pickSel(e) === '__other') { <input class="field mt-1" [attr.aria-label]="e.label + ' (other)'" placeholder="Type here" [value]="val(e)" (input)="put(e, $any($event.target).value)"> }
                          }
                          @case ('area') { <textarea [id]="'e-' + e.k" rows="2" class="field" [ngModel]="val(e)" (ngModelChange)="put(e, $event)"></textarea> }
                          @case ('tel') { <input [id]="'e-' + e.k" type="tel" inputmode="numeric" maxlength="12" placeholder="0300-1234567" class="field" [value]="val(e)" (input)="typed(e, $event)"> }
                          @case ('cnic') { <input [id]="'e-' + e.k" inputmode="numeric" maxlength="15" placeholder="12345-1234567-1" class="field" [value]="val(e)" (input)="typed(e, $event)"> }
                          @default { <input [id]="'e-' + e.k" class="field" [ngModel]="val(e)" (ngModelChange)="put(e, $event)"> }
                        }
                      </div>
                    }
                  }
                }
              </div></div>
          }
          <div class="flex flex-wrap gap-3 items-center"><button type="button" class="btn-primary" [disabled]="saving()" (click)="save()">{{ isNew ? 'Save student' : 'Save details' }}</button>
            <button type="button" class="btn-ghost" (click)="print()">Print this form</button>
            <span class="text-xs font-bold text-slate-400">Saving writes the student record, category and bus too, so the fee voucher follows this form.</span></div>
        </section>
      }

  @if (isBlank || st()) {
   <div id="form-preview" class="overflow-x-auto print:overflow-visible" [style.--pw]="pw()" [style.--ps]="ps().scale / 100">
    @if (type() === 'school') { <app-school-form [v]="view()" /> } @else if (type() === 'registration') { <app-registration-form [v]="view()" /> } @else { <app-college-form [v]="view()" /> }
   </div>
  }
  </div>
  `
})
export class AdmissionForm implements OnDestroy {
  private settings = inject(SettingsService);
  private api = inject(Api); private san = inject(DomSanitizer); private toast = inject(ToastService); auth = inject(AuthService);
  private route = inject(ActivatedRoute); private router = inject(Router);
  sizes = PAPERS; sizeLabel = computed(() => PAPERS.find(z => z.k === this.ps().size)?.label ?? '');
  ps = signal<PrintSetup>(loadSetup());
  pw = computed(() => {
    const q = this.ps(), z = PAPERS.find(x => x.k === q.size) ?? PAPERS[0], w = q.orient === 'landscape' ? z.h : z.w;
    return Math.max(60, (w - q.left - q.right) / (q.scale / 100)) + 'mm';
  });
  private styleEl: HTMLStyleElement | null = null;
  private applyPs = effect(() => {
    const q = this.ps(); try { localStorage.setItem(PS_KEY, JSON.stringify(q)); } catch { /* storage may be blocked */ }
    if (!this.styleEl) { this.styleEl = document.createElement('style'); this.styleEl.id = 'form-page-style'; document.head.appendChild(this.styleEl); }
    this.styleEl.textContent = `@page { size: ${q.size === 'a4' ? 'A4' : q.size === 'a5' ? 'A5' : q.size === 'letter' ? 'letter' : 'legal'} ${q.orient}; margin: ${q.top}mm ${q.right}mm ${q.bottom}mm ${q.left}mm; }`;
  });
  setPs(k: keyof PrintSetup, v: any) {
    this.ps.update(q => {
      if (k === 'size' || k === 'orient') return { ...q, [k]: v };
      const n = Number(v), lim = k === 'scale' ? [50, 130] : [0, 40];
      return { ...q, [k]: Number.isFinite(n) ? Math.min(lim[1], Math.max(lim[0], n)) : q[k] };
    });
  }
  resetPs() { this.ps.set({ ...DEFAULT_PS }); }
  ngOnDestroy() { this.styleEl?.remove(); this.styleEl = null; }
  readonly printIcon = Printer; mny = money; groupList = GROUPS;
  private idParam = this.route.snapshot.paramMap.get('id') ?? 'blank';
  isBlank = this.idParam === 'blank';
  type = signal<'school' | 'college' | 'registration'>(['college', 'registration'].includes(this.route.snapshot.queryParamMap.get('type') ?? '') ? this.route.snapshot.queryParamMap.get('type') as 'college' | 'registration' : 'school');
  draft = signal<Record<string, any>>({});
  st = computed<Full | null>(() => {
    if (this.isBlank) return null; const d = this.draft(); if (!Object.keys(d).length) return null;
    const c = this.classes().find(x => x.id === d['class_id']), sec = c?.sections?.find(x => x.id === d['section_id']);
    return { ...d, class_name: c?.name ?? d['class_name'] ?? '', section_name: sec?.name ?? d['section_name'] ?? '', grade: c?.grade ?? d['grade'] ?? 0 } as Full;
  });
  info = signal<Info>({}); sibs = signal<Sibling[]>([]); missing = signal<string[]>([]); qr = signal<SafeHtml | null>(null);
  error = signal(''); saving = signal(false); order = signal(1);
  cat = signal(''); routeId = signal<number | null>(null); stopId = signal<number | null>(null); mode = signal('both');
  routes = signal<TrRoute[]>([]); savedRoute = signal<number | null>(null); preview = signal<CatPreview | null>(null);
  classes = signal<ClassData[]>([]); chartClass = signal<number | null>(null); chartData = signal<{ A: CatPreview; B: CatPreview; C: CatPreview } | null>(null);

  stops = computed(() => this.routes().find(r => r.id === this.routeId())?.stops ?? []);
  isNew = this.idParam === 'new';
  sections = computed(() => ENTRIES[this.type()]);
  examParts: [string, string][] = [['year', 'Year'], ['roll', 'Roll no'], ['marks', 'Marks'], ['total', 'Total'], ['grade', 'Grade / %'], ['subjects', 'Subjects'], ['board', 'Board']];
  range = (n: number) => Array.from({ length: n }, (_, i) => i);
  formClasses = computed(() => this.isNew && this.type() !== 'registration' ? this.classes().filter(c => (this.type() === 'college') === (c.grade >= 11)) : this.classes());
  sectionList = computed(() => this.classes().find(c => c.id === this.draft()['class_id'])?.sections ?? []);
  d = (k: string) => this.draft()[k] ?? null;
  val = (e: Entry) => String((e.src === 'st' ? this.draft()[e.k!] : this.info()[e.k!]) ?? '');
  showPanel = computed(() => !this.isBlank && !!this.st() && this.auth.canWriteStudents());
  /** Switch the form and, on a narrow screen where the form sits below the entry panel, bring it into view. */
  pick(t: 'school' | 'college' | 'registration') {
    this.type.set(t);
    if (window.innerWidth < 1280) setTimeout(() => document.getElementById('form-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  boards = BOARDS;
  private otherOn = signal<Record<string, boolean>>({});
  /** The value shown in a pick-list: the answer itself, or "Other" when the saved text is not one of the ready-made choices. */
  pickSel(e: Entry): string {
    const v = this.val(e);
    if (this.otherOn()[e.k!] || (v && !e.opts!.includes(v))) return '__other';
    return v;
  }
  pickSet(e: Entry, v: string) {
    if (v === '__other') { this.otherOn.update(o => ({ ...o, [e.k!]: true })); if (e.opts!.includes(this.val(e))) this.put(e, ''); return; }
    this.otherOn.update(o => ({ ...o, [e.k!]: false })); this.put(e, v);
  }
  typed(e: Entry, ev: Event) {
    const t = ev.target as HTMLInputElement, f = e.kind === 'cnic' ? fmtCnic(t.value) : fmtPhone(t.value);
    t.value = f; this.put(e, f);
  }
  put(e: Entry, v: string) { if (e.src === 'st') this.setSt(e.k!, v); else this.setInfo(e.k!, v); }
  sibList = computed<{ name: string; class_session: string }[]>(() => {
    const own = this.info()['siblings'];
    return Array.isArray(own) && own.length ? own : this.sibs().map(s => ({ name: s.name, class_session: `${s.class_name}-${s.section_name}` }));
  });

  transportFee = computed(() => {
    const r = this.routes().find(x => x.id === this.routeId()); if (!r) return 0;
    const s = r.stops.find(x => x.id === this.stopId()), both = s?.fee_both ?? r.fee_both ?? 0;
    return this.mode() === 'both' ? both : (s?.fee_one ?? r.fee_one ?? both);
  });

  fee = computed<FeeView | null>(() => {
    const p = this.preview(); if (!p || this.isBlank) return null;
    const isTr = (n: string) => n.trim().toLowerCase() === 'transport fee';
    const rows = p.rows.filter(r => !isTr(r.name)).map(r => ({ name: r.name, when: when(r.frequency), amount: r.amount }));
    const trHead = p.rows.filter(r => isTr(r.name)).reduce((a, r) => a + r.amount - r.discount, 0);
    const tf = this.transportFee(), r = this.routes().find(x => x.id === this.routeId());
    const monthly = p.monthly - trHead + tf;
    return {
      category: this.cat(), rows, discounts: p.lines, monthly, once: p.once, firstPayable: monthly + p.once,
      transport: r ? { name: 'Transport Fee', when: 'Every month', amount: tf } : null
    };
  });

  chart = computed<Chart | null>(() => {
    const d = this.chartData(), cid = this.chartClass(); if (!d || !cid) return null;
    const order: string[] = [], rows = new Map<string, ChartRow>();
    for (const c of ['A', 'B', 'C'] as const) for (const r of d[c].rows) {
      const key = r.name + '|' + r.frequency;
      if (!rows.has(key)) { rows.set(key, { name: r.name, when: when(r.frequency), A: 0, B: 0, C: 0 }); order.push(key); }
      rows.get(key)![c] = r.amount - r.discount;
    }
    return {
      className: this.classes().find(c => c.id === cid)?.name ?? '', rows: order.map(k => rows.get(k)!),
      monthly: { A: d.A.monthly, B: d.B.monthly, C: d.C.monthly }, once: { A: d.A.once, B: d.B.once, C: d.C.once },
      routes: this.routes().map(r => ({ name: r.name, both: r.fee_both ?? 0, one: r.fee_one ?? r.fee_both ?? 0 }))
    };
  });

  view = computed<FormView>(() => {
    const s = this.st(), i = this.info(), t = (k: string): string => String(i[k] ?? ''), dt = (k: string) => (i[k] ? fmtDate(i[k]) : '');
    const ex = (p: string): Exam => ({ year: t(p + '_year'), roll: t(p + '_roll'), marks: t(p + '_marks'), total: t(p + '_total'), grade: t(p + '_grade'), subjects: t(p + '_subjects'), board: t(p + '_board') });
    const mk = (p: string): Marks => ({ urdu: t(p + '_urdu'), english: t(p + '_english'), maths: t(p + '_maths'), science: t(p + '_science'), total: t(p + '_total') });
    const r = this.routes().find(x => x.id === this.routeId()), stop = r?.stops.find(x => x.id === this.stopId());
    const filled = !!s;
    return {
      filled, regNo: s?.reg_no ?? '', issueDate: i['issue_date'] ? fmtDate(i['issue_date']) : (filled ? fmtDate(new Date().toISOString().slice(0, 10)) : ''), category: this.cat() || s?.category || '',
      className: s?.class_name ?? '', session: t('apply_session'),
      name: (s?.name ?? '').toUpperCase(), dob: s?.dob ? fmtDate(s.dob) : '', pob: t('place_of_birth'), religion: t('religion'), nationality: t('nationality'), bform: t('student_bform'),
      father: (s?.father_name ?? '').toUpperCase(), fatherQual: t('father_qualification'), fatherDesig: t('father_designation'), fatherDiv: t('father_division'), cnic: s?.father_cnic ?? '',
      pno: s?.p_number ?? '', spsBps: t('father_sps_bps'), income: t('father_income'), address: s?.address ?? '', permanent: t('permanent_address'),
      telOffice: t('office_phone'), telRes: t('res_phone') || (s?.phone ?? ''), cell: s?.father_phone || s?.mother_phone || '', mother: t('mother_qual_occ'),
      prevSchool: t('prev_school'), duesUpto: t('dues_paid_upto'), prevClass: t('prev_class'), medium: t('medium'), distinction: t('distinction'), cocurricular: t('cocurricular'), sports: t('sports'),
      group: t('subject_group'), ssc: ex('ssc'), hssc1: ex('hssc1'), health: t('health_issue') === 'yes' ? 'Yes' : t('health_issue') === 'no' ? 'No' : '', disease: t('disease'), doctor: t('doctor'),
      diseaseStatus: t('disease_status'), future: t('future_plan'), siblings: this.sibList(),
      transport: { need: !!r, route: r?.name ?? '', stop: stop?.name ?? '', mode: this.mode(), fee: this.transportFee(), times: this.tripTimes(r, stop) },
      photo: s?.photo ?? null, qr: this.qr(), missing: this.missing(),
      testDate: dt('test_date'), house: t('house'), decision: t('decision'), decisionDate: dt('decision_date'), admissionNo: s?.reg_no ?? '', section: s?.section_name ?? '', admissionDate: s?.admission_date ? fmtDate(s.admission_date.slice(0, 10)) : '',
      feeReceived: t('fee_received'), receiptNo: t('receipt_no'), receiptDate: dt('receipt_date'),
      fee: this.fee(), chart: this.chart(),
      bloodGroup: t('blood_group'), officialAddress: t('official_address'), admitClass: t('admit_class') || (s?.class_name ?? ''), reported: t('reported_test') === 'yes' ? 'Yes' : t('reported_test') === 'no' ? 'No' : '',
      dobWords: dateInWords(s?.dob), remarks: t('remarks'), result: mk('res'), retest: mk('ret')
    };
  });

  constructor() {
    this.api.get<TrRoute[]>('/transport/lookup').subscribe({ next: r => this.routes.set(r), error: () => { /* the form prints without transport */ } });
    this.api.get<ClassData[]>('/classes').subscribe({ next: c => { this.classes.set(c); this.loadFee(); }, error: () => { /* optional */ } });
    if (this.isBlank) return;
    if (this.isNew) {
      this.draft.set({ id: null, reg_no: '', name: '', father_name: '', gender: 'male', dob: '', phone: '', address: '', class_id: null, section_id: null, roll_no: null, father_cnic: '', category: '', p_number: '', father_phone: '', mother_phone: '', admission_date: new Date().toISOString().slice(0, 10) });
      this.info.set({ issue_date: new Date().toISOString().slice(0, 10) });
      return;
    }
    const id = Number(this.idParam);
    this.api.get<Full>(`/students/${id}`).subscribe({
      next: s => {
        this.draft.set({ ...s }); this.cat.set(s.category ?? ''); this.routeId.set(s.tr_route_id); this.savedRoute.set(s.tr_route_id); this.stopId.set(s.tr_stop_id); this.mode.set(s.tr_mode || 'both');
        if (!this.route.snapshot.queryParamMap.get('type')) this.type.set(s.grade >= 11 ? 'college' : 'school');
        try { this.qr.set(this.san.bypassSecurityTrustHtml(qrSvg(`${this.settings.publicUrl() || location.origin}/students/${id}`))); } catch { /* the QR is optional */ }
        this.api.get<{ order: number }>(`/students/${id}/family`).subscribe({ next: f => { this.order.set(f.order); this.loadFee(); }, error: () => this.loadFee() });
      },
      error: e => this.error.set(errorText(e))
    });
    this.api.get<Sibling[]>(`/students/${id}/siblings`).subscribe({ next: r => this.sibs.set(r), error: () => { /* optional */ } });
    this.api.get<{ missing: string[] }>(`/students/${id}/documents`).subscribe({ next: r => this.missing.set(r.missing), error: () => { /* optional */ } });
    this.api.get<Info>(`/students/${id}/application`).subscribe({ next: r => this.info.set(r), error: () => { /* only the office can read it */ } });
  }

  private familyTimer: any;
  setSt(k: string, v: unknown) {
    this.draft.update(o => ({ ...o, [k]: v }));
    if (['father_cnic', 'father_phone', 'mother_phone', 'phone'].includes(k)) { clearTimeout(this.familyTimer); this.familyTimer = setTimeout(() => this.lookupFamily(), 500); }
  }
  setClass(id: number | null) { this.draft.update(o => ({ ...o, class_id: id, section_id: null })); this.loadFee(); }
  pickPhoto(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    this.cropFile.set(f); (ev.target as HTMLInputElement).value = '';
  }
  cropFile = signal<File | null>(null);
  onCrop(url: string) { this.setSt('photo', url); this.cropFile.set(null); }
  /** A new admission: look for brothers and sisters by CNIC / phone, so the family discount shows in the fee and they are written on the form. */
  private lookupFamily() {
    if (!this.isNew) return; const d = this.draft();
    const cnic = String(d['father_cnic'] || ''), ph = [d['father_phone'], d['mother_phone'], d['phone']].map(x => String(x || ''));
    if (cnic.replace(/\D/g, '').length < 13 && !ph.some(p => p.replace(/\D/g, '').length >= 10)) { this.sibs.set([]); this.order.set(1); this.loadFee(); return; }
    this.api.get<Sibling[]>('/students/siblings', { cnic, phone1: ph[0], phone2: ph[1], phone3: ph[2] }).subscribe({
      next: r => { this.sibs.set(r); this.order.set(r.length + 1); this.loadFee(); }, error: () => { /* only a help */ }
    });
  }

  private tripTimes(r: TrRoute | undefined, s: TrRoute['stops'][number] | undefined): string {
    if (!r) return '';
    const up = s?.pickup_time || r.morning_time, dn = s?.drop_time || r.afternoon_time, m = this.mode(), out: string[] = [];
    if (m !== 'drop' && up) out.push('Pick up ' + up);
    if (m !== 'pickup' && dn) out.push('Drop ' + dn);
    return out.join(' · ');
  }

  loadFee() {
    const s = this.st(); if (!s || !s.class_id) { this.preview.set(null); return; }
    this.api.get<CatPreview>('/fee/category-preview', { classId: s.class_id, category: this.cat() || undefined, transport: this.routeId() ? 1 : undefined, order: this.order() })
      .subscribe({ next: p => this.preview.set(p), error: () => { /* the form prints without fees */ } });
  }
  setCat(c: string) { this.cat.set(c); this.loadFee(); }
  setRoute(r: number | null) { this.routeId.set(r); this.stopId.set(null); this.loadFee(); }
  setInfo(k: string, v: string) { this.info.update(o => ({ ...o, [k]: v })); }
  setSib(i: number, k: 'name' | 'class_session', v: string) {
    const l = this.sibList().map(x => ({ ...x }));
    while (l.length <= i) l.push({ name: '', class_session: '' });
    l[i][k] = v; this.info.update(o => ({ ...o, siblings: l }));
  }
  pickChart(id: number | null) {
    this.chartClass.set(id); this.chartData.set(null); if (!id) return;
    const get = (c: string) => this.api.get<CatPreview>('/fee/category-preview', { classId: id, category: c });
    get('A').subscribe(A => get('B').subscribe(B => get('C').subscribe(C => { if (this.chartClass() === id) this.chartData.set({ A, B, C }); })));
  }

  save(force = false) {
    const d = this.draft();
    if (!String(d['name'] || '').trim() || !String(d['father_name'] || '').trim()) { this.toast.show("Write the student's name and the father's name first.", 'error'); return; }
    if (!d['section_id']) { this.toast.show('Choose the class and section.', 'error'); return; }
    this.saving.set(true);
    const body: Record<string, unknown> = {
      name: d['name'], father_name: d['father_name'], gender: d['gender'] || 'male', dob: d['dob'] || '', phone: d['phone'] || '', address: d['address'] || '', section_id: d['section_id'], roll_no: d['roll_no'] ?? null,
      father_cnic: d['father_cnic'] || '', category: this.cat(), category_reason: 'Admission form', p_number: d['p_number'] || '', father_phone: d['father_phone'] || '', mother_phone: d['mother_phone'] || '',
      tr_route_id: this.routeId(), tr_stop_id: this.stopId(), tr_mode: this.mode(), force: force || undefined
    };
    if (d['photo'] !== undefined && (this.isNew || typeof d['photo'] === 'string')) body['photo'] = d['photo'] || null;
    const id = this.isNew ? null : Number(this.idParam);
    const req = id ? this.api.put<any>(`/students/${id}`, body) : this.api.post<any>('/students', body);
    req.subscribe({
      next: r => {
        const sid = id ?? r.id;
        this.api.put(`/students/${sid}/application`, this.info()).subscribe({
          next: saved => {
            this.saving.set(false); this.info.set(saved as Info);
            this.toast.show(id ? 'Saved.' : `Student added. Reg no: ${r.reg_no}`);
            if (r?.warning) this.toast.show(r.warning, 'error');
            if (r?.voucher_id) this.toast.show('First fee voucher was made. Print it from Fee management.');
            else if (r?.voucher_note) this.toast.show('No first voucher: ' + r.voucher_note, 'error');
            if (!id) this.router.navigate(['/students/form', sid], { queryParams: { type: this.type() }, replaceUrl: true });
            else this.loadFee();
          },
          error: e => { this.saving.set(false); this.toast.show('The student was saved but the form details were not: ' + errorText(e), 'error'); if (!id) this.router.navigate(['/students/form', sid], { queryParams: { type: this.type() }, replaceUrl: true }); }
        });
      },
      error: e => {
        this.saving.set(false);
        if (e?.status === 409 && e?.error?.duplicate && confirm(e.error.message)) { this.save(true); return; }
        this.toast.show(errorText(e), 'error');
      }
    });
  }
  print() { window.print(); }
}
