import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { Head, money } from './fee';

export const CATEGORIES: { key: 'A' | 'B' | 'C'; label: string }[] = [
  { key: 'A', label: 'A - Father working in KRL' }, { key: 'B', label: 'B - Father retired from KRL' }, { key: 'C', label: 'C - Father in private job' }
];
export interface CatRule { id: number; category: 'A' | 'B' | 'C'; head_id: number | null; head_name: string | null; kind: 'fixed' | 'percent'; value: number; note: string | null; students: number }
export interface CatPreview { order?: number; mode?: string; used?: string; category: string | null; rows: { head_id: number; name: string; frequency: string; amount: number; discount: number }[]; lines: { text: string; amount: number }[]; monthly: number; once: number; total: number }
interface Form { id: number | null; category: 'A' | 'B' | 'C'; head_id: number | null; kind: 'fixed' | 'percent'; value: number | null; note: string }
const blank = (c: 'A' | 'B' | 'C' = 'A'): Form => ({ id: null, category: c, head_id: null, kind: 'percent', value: null, note: '' });

@Component({
  selector: 'app-fee-categories',
  imports: [FormsModule],
  template: `
  <div class="space-y-8">
    <div>
      <h3 class="text-xl font-black">Category-wise fees (A / B / C)</h3>
      <p class="text-sm font-bold text-slate-400 mt-1">Set the discount of each category once. It is applied automatically when a student is admitted or his category is changed, and appears on every voucher.</p>
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (canEdit()) {
      <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
        <div><label class="label" for="c-cat">Category</label><select id="c-cat" name="cat" class="field" [(ngModel)]="form.category">@for (c of cats; track c.key) { <option [value]="c.key">{{ c.label }}</option> }</select></div>
        <div class="md:col-span-2"><label class="label" for="c-head">Applies to</label><select id="c-head" name="head" class="field" [(ngModel)]="form.head_id"><option [ngValue]="null">All discountable heads (tuition)</option>@for (h of heads(); track h.id) { <option [ngValue]="h.id">{{ h.name }}</option> }</select></div>
        <div><label class="label" for="c-kind">Type</label><select id="c-kind" name="kind" class="field" [(ngModel)]="form.kind"><option value="percent">Percent off</option><option value="fixed">Fixed Rs off</option></select></div>
        <div><label class="label" for="c-val">{{ form.kind === 'percent' ? 'Percent' : 'Rs amount' }}</label><input id="c-val" name="val" type="number" min="1" class="field" required [(ngModel)]="form.value"></div>
        <div><label class="label" for="c-note">Note</label><input id="c-note" name="note" class="field" placeholder="optional" [(ngModel)]="form.note"></div>
        <div class="md:col-span-6 flex flex-wrap gap-3 justify-end">
          @if (form.id) { <button type="button" class="btn-ghost" (click)="form = blank()">Cancel edit</button> }
          <button type="submit" class="btn-primary">{{ form.id ? 'Save rule' : 'Add rule' }}</button>
        </div>
      </form>
    } @else {
      <p class="p-4 rounded-2xl bg-slate-500/5 text-sm font-bold text-slate-500">Only the director, principal or accountant can change these rules.</p>
    }

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      @for (c of cats; track c.key) {
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <h4 class="font-black">{{ c.label }}</h4>
          <p class="text-xs font-bold text-slate-400 mb-4">{{ studentsOf(c.key) }} students</p>
          @for (r of rulesOf(c.key); track r.id) {
            <div class="flex items-center gap-2 py-2 border-t border-slate-100 dark:border-slate-800 text-sm">
              <div class="flex-1"><b>{{ r.kind === 'percent' ? r.value + '%' : 'Rs ' + r.value }} off</b> <span class="text-slate-400 font-bold">on {{ r.head_name || 'tuition (all discountable)' }}</span>@if (r.note) { <span class="block text-xs text-slate-400">{{ r.note }}</span> }</div>
              @if (canEdit()) {
                <button type="button" class="text-xs font-black text-indigo-600" (click)="edit(r)">Edit</button>
                <button type="button" class="text-xs font-black text-rose-500" (click)="remove(r)">Delete</button>
              }
            </div>
          } @empty { <p class="text-sm font-bold text-slate-400">No discount - full class fee.</p> }
        </section>
      }
    </div>

    @if (canEdit()) {
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn-ghost" [disabled]="busy()" (click)="applyAll()">Apply to all existing students</button>
        <span class="text-xs font-bold text-slate-400">New admissions get their category fees automatically. Use this after changing a rule to update students already admitted.</span>
      </div>
    }

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div><h4 class="font-black">Sibling discount (by child order)</h4>
        <p class="text-xs font-bold text-slate-400 mt-1">The oldest child pays full fee. A rule for "3" also covers the 4th child and later, unless a higher number is set. Children are linked on the student profile.</p></div>
      @for (r of sib().rules; track $index) {
        <div class="grid grid-cols-4 gap-3 items-end">
          <div><label class="label" [for]="'so'+$index">Child number</label><input [id]="'so'+$index" [name]="'so'+$index" type="number" min="2" max="20" class="field" [disabled]="!canEdit()" [(ngModel)]="r.child_order"></div>
          <div><label class="label" [for]="'sk'+$index">Type</label><select [id]="'sk'+$index" [name]="'sk'+$index" class="field" [disabled]="!canEdit()" [(ngModel)]="r.kind"><option value="percent">Percent off</option><option value="fixed">Fixed Rs off</option></select></div>
          <div><label class="label" [for]="'sv'+$index">{{ r.kind === 'percent' ? 'Percent' : 'Rs amount' }}</label><input [id]="'sv'+$index" [name]="'sv'+$index" type="number" min="1" class="field" [disabled]="!canEdit()" [(ngModel)]="r.value"></div>
          @if (canEdit()) { <button type="button" class="text-xs font-black text-rose-500 pb-3" (click)="dropSib($index)">Remove</button> }
        </div>
      } @empty { <p class="text-sm font-bold text-slate-400">No sibling discount set.</p> }
      <div>
        <label class="label" for="smode">When a child also has a category discount</label>
        <select id="smode" name="smode" class="field md:!w-96" [disabled]="!canEdit()" [(ngModel)]="sib().mode">
          <option value="highest">Highest only (the bigger discount, not both)</option>
          <option value="stack">Stack (category first, then sibling on what is left)</option>
        </select>
      </div>
      @if (canEdit()) {
        <div class="flex flex-wrap gap-3">
          <button type="button" class="btn-ghost" (click)="addSib()">Add child number</button>
          <button type="button" class="btn-primary" (click)="saveSib()">Save sibling discount</button>
        </div>
        <p class="text-xs font-bold text-slate-400">After saving, press "Apply to all existing students" above to update current students.</p>
      }
    </section>


    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div><h4 class="font-black">Fixed fee per category (class x head)</h4>
        <p class="text-xs font-bold text-slate-400 mt-1">Two ways to give a category a different fee. <b>Discount rules</b> (above) take a percent or an amount off the class fee. A <b>fixed fee</b> (here) replaces the class fee of that head for that category; the category discount is then not applied to that head. Leave a box empty to use the class fee and the discount rules. Type 0 to make a head free.</p></div>
      <div class="flex gap-2">@for (c of cats; track c.key) { <button type="button" class="px-4 py-2 rounded-xl text-sm font-black" [class]="gridCat() === c.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'" (click)="gridCat.set(c.key)">Category {{ c.key }}</button> }</div>
      <div class="overflow-x-auto"><table class="text-sm text-left">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2 pr-4">Class</th>@for (h of heads(); track h.id) { <th class="py-2 pr-3">{{ h.name }}</th> }</tr></thead>
        <tbody>@for (c of classes(); track c.id) {
          <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 pr-4 font-black whitespace-nowrap">{{ c.name }}</td>
            @for (h of heads(); track h.id) { <td class="py-1.5 pr-3"><input type="number" min="0" class="field !w-28 !py-1.5" [attr.aria-label]="c.name + ' ' + h.name" [disabled]="!canEdit()" [placeholder]="'class fee'" [ngModel]="cell(c.id, h.id)" (ngModelChange)="setCell(c.id, h.id, $event)" [name]="'g'+c.id+'-'+h.id"></td> }
          </tr> }</tbody></table></div>
      @if (canEdit()) { <button type="button" class="btn-primary" (click)="saveGrid()">Save fixed fees</button> <p class="text-xs font-bold text-slate-400">After saving, press "Apply to all existing students" so current students get the right concessions. New vouchers use the fixed fee at once.</p> }
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <h4 class="font-black">Fee by category</h4>
        <select class="field !w-auto" aria-label="Class" [ngModel]="classId()" (ngModelChange)="pick($event)">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
      </div>
      <table class="w-full text-sm text-left"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2">Category</th><th class="py-2 text-right">Monthly fee</th><th class="py-2 text-right">One-time / yearly</th><th class="py-2 text-right">First payment</th></tr></thead>
        <tbody>
          <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 font-black">No category</td><td class="py-2 text-right font-bold">{{ m(prev()['']?.monthly) }}</td><td class="py-2 text-right font-bold">{{ m(prev()['']?.once) }}</td><td class="py-2 text-right font-black">{{ m(prev()['']?.total) }}</td></tr>
          @for (c of cats; track c.key) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 font-black">{{ c.key }}</td><td class="py-2 text-right font-bold">{{ m(prev()[c.key]?.monthly) }}</td><td class="py-2 text-right font-bold">{{ m(prev()[c.key]?.once) }}</td><td class="py-2 text-right font-black">{{ m(prev()[c.key]?.total) }}</td></tr> }
        </tbody></table>
      <p class="text-xs font-bold text-slate-400 mt-3">Class fee amounts come from the Fee structure tab. Transport is added separately.</p>
    </section>
  </div>
  `
})
export class FeeCategories {
  private api = inject(Api);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  cats = CATEGORIES; blank = blank; m = (n: number | undefined) => (n === undefined ? '-' : money(n));
  rules = signal<CatRule[]>([]); heads = signal<Head[]>([]); classes = signal<ClassInfo[]>([]);
  classId = signal<number | null>(null);
  prev = signal<Record<string, CatPreview>>({});
  form: Form = blank();
  sib = signal<{ mode: 'highest' | 'stack'; rules: { child_order: number; kind: 'percent' | 'fixed'; value: number }[] }>({ mode: 'highest', rules: [] });
  gridCat = signal<'A' | 'B' | 'C'>('A'); fixed = signal<Record<string, number | null>>({});
  error = signal(''); busy = signal(false);
  canEdit = computed(() => this.auth.canFee() && this.auth.user()?.role !== 'admin');
  rulesOf = (c: string) => this.rules().filter(r => r.category === c);
  studentsOf = (c: string) => this.rules().find(r => r.category === c)?.students ?? 0;

  constructor() {
    this.loadRules(); this.loadSib(); this.loadGrid();
    this.api.get<Head[]>('/fee/heads').subscribe({ next: h => this.heads.set(h.filter(x => !x.optional)), error: e => this.error.set(errorText(e)) });
    this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => { this.classes.set(c); if (c.length) this.pick(c[0].id); }, error: e => this.error.set(errorText(e)) });
  }
  loadRules() { this.api.get<CatRule[]>('/fee/category-rules').subscribe({ next: r => { this.rules.set(r); this.refresh(); }, error: e => this.error.set(errorText(e)) }); }
  loadSib() { this.api.get<{ mode: 'highest' | 'stack'; rules: { child_order: number; kind: 'percent' | 'fixed'; value: number }[] }>('/fee/sibling-rules').subscribe({ next: r => this.sib.set(r), error: e => this.error.set(errorText(e)) }); }
  addSib() { const s = this.sib(); const n = Math.max(1, ...s.rules.map(r => r.child_order)) + 1; this.sib.set({ ...s, rules: [...s.rules, { child_order: n, kind: 'percent', value: 10 }] }); }
  dropSib(i: number) { const s = this.sib(); this.sib.set({ ...s, rules: s.rules.filter((_, k) => k !== i) }); }
  saveSib() { this.error.set(''); this.api.put('/fee/sibling-rules', this.sib()).subscribe({ next: () => { this.toast.show('Saved. Use "Apply to all existing students" to update current students.'); this.loadSib(); this.refresh(); }, error: e => this.error.set(errorText(e)) }); }
  private key = (c: number, h: number) => `${c}-${this.gridCat()}-${h}`;
  cell(c: number, h: number) { return this.fixed()[this.key(c, h)] ?? null; }
  setCell(c: number, h: number, v: number | string | null) { const n = v === null || v === '' ? null : Number(v); this.fixed.set({ ...this.fixed(), [this.key(c, h)]: n !== null && Number.isFinite(n) && n >= 0 ? Math.round(n) : null }); }
  loadGrid() { this.api.get<{ class_id: number; category: string; head_id: number; amount: number }[]>('/fee/category-fees').subscribe({ next: r => this.fixed.set(Object.fromEntries(r.map(x => [`${x.class_id}-${x.category}-${x.head_id}`, x.amount]))), error: e => this.error.set(errorText(e)) }); }
  saveGrid() {
    this.error.set('');
    const fees = Object.entries(this.fixed()).filter(([, v]) => v !== null).map(([k, v]) => { const [class_id, category, head_id] = k.split('-'); return { class_id: Number(class_id), category, head_id: Number(head_id), amount: v }; });
    this.api.put('/fee/category-fees', { fees }).subscribe({ next: () => { this.toast.show('Fixed fees saved.'); this.loadGrid(); this.refresh(); }, error: e => this.error.set(errorText(e)) });
  }
  pick(id: number | null) { this.classId.set(id); this.refresh(); }
  refresh() {
    const id = this.classId(); if (!id) return;
    forkJoin(['', 'A', 'B', 'C'].map(c => this.api.get<CatPreview>('/fee/category-preview', { classId: id, category: c || undefined }))).subscribe({
      next: r => this.prev.set({ '': r[0], A: r[1], B: r[2], C: r[3] }), error: e => this.error.set(errorText(e))
    });
  }
  edit(r: CatRule) { this.form = { id: r.id, category: r.category, head_id: r.head_id, kind: r.kind, value: r.value, note: r.note ?? '' }; }
  save() {
    this.error.set('');
    const f = this.form, req = f.id ? this.api.put(`/fee/category-rules/${f.id}`, f) : this.api.post('/fee/category-rules', f);
    req.subscribe({ next: () => { this.toast.show('Rule saved. Use "Apply to all existing students" to update current students.'); this.form = blank(f.category); this.loadRules(); }, error: e => this.error.set(errorText(e)) });
  }
  remove(r: CatRule) {
    if (!confirm('Delete this rule?')) return;
    this.api.delete(`/fee/category-rules/${r.id}`).subscribe({ next: () => this.loadRules(), error: e => this.error.set(errorText(e)) });
  }
  applyAll() {
    if (!confirm('Re-apply the category rules to every active student? Concessions you added by hand are kept.')) return;
    this.busy.set(true);
    this.api.post<{ students: number }>('/fee/category-rules/apply', {}).subscribe({ next: r => { this.busy.set(false); this.toast.show(`Applied to ${r.students} students.`); }, error: e => { this.busy.set(false); this.error.set(errorText(e)); } });
  }
}
