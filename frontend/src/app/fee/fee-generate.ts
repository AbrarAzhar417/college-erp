import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Sparkles, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { FeePrintService, FeeSettings, Head, StudentHit, money, monthLabel, today } from './fee';

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

@Component({
  selector: 'app-fee-generate',
  imports: [FormsModule, RouterLink, LucideAngularModule],
  template: `
  <div class="space-y-8 max-w-4xl">
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-8">
      <div>
        <h3 class="text-xl font-black tracking-tight">Generate fee vouchers</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Amounts come from the Fee structure, each student's extra fees and concessions, and any unpaid balance is added as arrears.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div><label class="label" for="gm">Fee month</label><input id="gm" type="month" class="field" [ngModel]="month()" (ngModelChange)="setMonth($event)"></div>
        <div><label class="label" for="gi">Issue date</label><input id="gi" type="date" class="field" [(ngModel)]="issue"></div>
        <div><label class="label" for="gd">Due date</label><input id="gd" type="date" class="field" [(ngModel)]="due"></div>
        <div><label class="label" for="gf">Late fine after due date (Rs)</label><input id="gf" type="number" min="0" class="field" [(ngModel)]="lateFine"></div>
      </div>

      <div>
        <span class="label !ml-0">Which fees</span>
        <label class="flex items-center gap-3 text-sm font-bold mb-3"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [(ngModel)]="includeMonthly"> Monthly fees (tuition, computer lab, transport...)</label>
        @if (extraHeads().length) {
          <div class="flex flex-wrap gap-2">
            @for (h of extraHeads(); track h.id) {
              <button type="button" (click)="toggleHead(h.id)" class="px-4 py-2 rounded-xl text-xs font-black transition-all"
                      [class]="picked().has(h.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ h.name }}</button>
            }
          </div>
        }
        @if (!includeMonthly()) {
          <div class="mt-4 md:w-96"><label class="label" for="gn">Voucher name (optional)</label><input id="gn" class="field" [(ngModel)]="voucherName" placeholder="e.g. Annual fee 2026"></div>
        }
      </div>

      <div>
        <span class="label !ml-0">For whom</span>
        <div class="flex flex-wrap gap-2 mb-4">
          @for (o of scopes; track o.key) {
            <button type="button" (click)="scopeKind.set(o.key)" class="px-4 py-2 rounded-xl text-xs font-black transition-all"
                    [class]="scopeKind() === o.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ o.label }}</button>
          }
        </div>
        @if (scopeKind() === 'class' || scopeKind() === 'section') {
          <div class="grid grid-cols-2 gap-4 max-w-md">
            <select class="field" aria-label="Class" [ngModel]="classId()" (ngModelChange)="setClass($event)">
              @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
            </select>
            @if (scopeKind() === 'section') {
              <select class="field" aria-label="Section" [ngModel]="sectionId()" (ngModelChange)="sectionId.set($event)">
                @for (s of sections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }
              </select>
            }
          </div>
        }
        @if (scopeKind() === 'student') {
          <div class="max-w-md relative">
            @if (student(); as st) {
              <div class="flex items-center justify-between gap-3 p-4 rounded-2xl bg-indigo-600/10">
                <span class="text-sm font-black">{{ st.name }} <span class="text-slate-400 font-bold">· {{ st.class_name }}-{{ st.section_name }} · Roll {{ st.roll_no ?? '-' }}</span></span>
                <button type="button" class="text-xs font-black text-rose-500" (click)="student.set(null)">Change</button>
              </div>
            } @else {
              <input class="field" type="search" placeholder="Search name, roll no, admission no or phone" aria-label="Search student" [ngModel]="q()" (ngModelChange)="onSearch($event)">
              @if (hits().length) {
                <ul class="absolute z-20 mt-2 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-enterprise-lg overflow-hidden">
                  @for (h of hits(); track h.id) {
                    <li><button type="button" class="w-full text-left px-5 py-3 text-sm font-bold hover:bg-indigo-600/10" (click)="pick(h)">{{ h.name }} <span class="text-slate-400">· {{ h.class_name }}-{{ h.section_name }} · Roll {{ h.roll_no ?? '-' }}</span></button></li>
                  }
                </ul>
              }
            }
          </div>
        }
      </div>

      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
      <div class="flex flex-wrap items-center gap-4">
        <button type="button" class="btn-primary" (click)="generate()" [disabled]="busy()"><lucide-icon [img]="sparkIcon" [size]="18" /> {{ busy() ? 'Working…' : 'Generate vouchers' }}</button>
        <span class="text-sm font-bold text-slate-400">{{ label() }}</span>
      </div>
    </section>

    @if (result(); as r) {
      <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <h3 class="text-2xl font-black tracking-tight">{{ r.created.length }} voucher{{ r.created.length === 1 ? '' : 's' }} created</h3>
        @if (r.skipped.length) {
          <div class="p-5 rounded-[1.8rem] bg-amber-500/10">
            <p class="text-sm font-black text-amber-700 dark:text-amber-300">{{ r.skipped.length }} skipped</p>
            <ul class="mt-2 space-y-1 text-sm font-bold text-amber-800 dark:text-amber-200">
              @for (s of r.skipped.slice(0, 6); track s.studentId) { <li>{{ s.name }}: {{ s.reason }}</li> }
              @if (r.skipped.length > 6) { <li>and {{ r.skipped.length - 6 }} more</li> }
            </ul>
          </div>
        }
        <div class="flex flex-wrap gap-3">
          @if (r.created.length) { <button type="button" class="btn-primary" (click)="printAll(r.created)"><lucide-icon [img]="printIcon" [size]="16" /> Print all {{ r.created.length }} vouchers</button> }
          <a routerLink="/fee/vouchers" [queryParams]="{ period: periodKey() }" class="btn-ghost">Open the voucher list</a>
        </div>
      </section>
    }
  </div>
  `
})
export class FeeGenerate {
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  private store = inject(FeePrintService);
  sparkIcon = Sparkles; printIcon = Printer;
  scopes = [{ key: 'all', label: 'Whole college' }, { key: 'class', label: 'One class' }, { key: 'section', label: 'One section' }, { key: 'student', label: 'One student' }] as const;

  heads = signal<Head[]>([]);
  classes = signal<ClassInfo[]>([]);
  month = signal(today().slice(0, 7));
  issue = today(); due = today();
  lateFine: number | string = 100;
  includeMonthly = signal(true);
  picked = signal<Set<number>>(new Set());
  voucherName = '';
  scopeKind = signal<'all' | 'class' | 'section' | 'student'>('all');
  classId = signal<number | null>(null);
  sectionId = signal<number | null>(null);
  student = signal<StudentHit | null>(null);
  q = signal(''); hits = signal<StudentHit[]>([]);
  busy = signal(false); error = signal('');
  result = signal<{ created: number[]; skipped: { studentId: number; name: string; reason: string }[] } | null>(null);
  private dueDay = 10;
  private timer: any;

  extraHeads = computed(() => this.heads().filter(h => h.frequency !== 'monthly'));
  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  periodKey = computed(() => this.includeMonthly() ? this.month() : `${this.month()}-extra-${slug(this.voucherName) || [...this.picked()].sort().join('_') || 'x'}`);
  label = computed(() => {
    const m = monthLabel(this.month());
    if (this.includeMonthly()) return this.picked().size ? `${m} + extra fees` : m;
    return this.voucherName.trim() || `Additional fees - ${m}`;
  });

  constructor() {
    this.api.get<Head[]>('/fee/heads').subscribe(h => this.heads.set(h));
    this.api.get<FeeSettings>('/fee/settings').subscribe(s => { this.lateFine = s.late_fine; this.dueDay = s.due_day; this.setMonth(this.month()); });
    this.api.get<ClassInfo[]>('/classes').subscribe(c => { this.classes.set(c); if (c.length) this.setClass(c[0].id); });
    const sid = inject(ActivatedRoute).snapshot.queryParamMap.get('studentId');
    if (sid) this.api.get<{ student: any }>(`/fee/student/${sid}`).subscribe(a => {
      this.student.set({ id: a.student.id, name: a.student.name, father_name: a.student.father_name, reg_no: a.student.reg_no, roll_no: a.student.roll_no, phone: a.student.phone, class_name: a.student.class_name, section_name: a.student.section_name, balance: 0 });
      this.scopeKind.set('student');
    });
  }

  setMonth(v: string) {
    if (!v) return;
    this.month.set(v);
    this.issue = v === today().slice(0, 7) ? today() : `${v}-01`;
    const d = `${v}-${String(this.dueDay).padStart(2, '0')}`;
    this.due = d < this.issue ? addDays(this.issue, 10) : d;
  }
  toggleHead(id: number) { const s = new Set(this.picked()); s.has(id) ? s.delete(id) : s.add(id); this.picked.set(s); }
  setClass(id: number) { this.classId.set(id); this.sectionId.set(this.classes().find(c => c.id === id)?.sections[0]?.id ?? null); }

  onSearch(v: string) {
    this.q.set(v); clearTimeout(this.timer);
    if (!v.trim()) { this.hits.set([]); return; }
    this.timer = setTimeout(() => this.api.get<StudentHit[]>('/fee/students/search', { q: v }).subscribe(h => this.hits.set(h)), 250);
  }
  pick(h: StudentHit) { this.student.set(h); this.hits.set([]); this.q.set(''); }

  private body() {
    const k = this.scopeKind();
    return {
      period: this.periodKey(), label: this.label(), issue_date: this.issue, due_date: this.due, late_fine: this.lateFine,
      include_monthly: this.includeMonthly(), include_head_ids: [...this.picked()],
      scope: { classId: k === 'class' || k === 'section' ? this.classId() : undefined, sectionId: k === 'section' ? this.sectionId() : undefined, studentId: k === 'student' ? this.student()?.id : undefined }
    };
  }

  generate() {
    this.error.set(''); this.result.set(null);
    if (this.scopeKind() === 'student' && !this.student()) { this.error.set('Search and choose a student first.'); return; }
    if (!this.includeMonthly() && !this.picked().size) { this.error.set('Choose at least one fee to put on the voucher.'); return; }
    this.busy.set(true);
    this.api.post<{ students: number; willCreate: number; alreadyHave: number; noAmounts: number; total: number }>('/fee/vouchers/preview', this.body()).subscribe({
      next: p => {
        if (!p.willCreate) { this.busy.set(false); this.error.set(p.alreadyHave ? `All ${p.alreadyHave} students already have a voucher for ${this.label()}.` : 'No fee amounts are set for these students. Fill the Fee structure first.'); return; }
        const note = p.alreadyHave ? ` (${p.alreadyHave} already have one and will be skipped)` : '';
        if (!confirm(`Create ${p.willCreate} voucher(s) for ${this.label()}, worth Rs ${money(p.total)} before arrears${note}?`)) { this.busy.set(false); return; }
        this.api.post<{ created: number[]; skipped: any[] }>('/fee/vouchers/generate', this.body()).subscribe({
          next: r => { this.busy.set(false); this.result.set(r); this.toast.show(`${r.created.length} vouchers created.`); },
          error: e => { this.busy.set(false); this.error.set(errorText(e)); }
        });
      },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  printAll(ids: number[]) { this.store.set(ids); this.router.navigateByUrl('/fee/print'); }
}
