import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';

interface Report {
  counts: { category: string; students: number }[];
  by_class: { grade: number; class_name: string; category: string; students: number }[];
  discount: { category: string; vouchers: number; gross: number; discount: number; net: number }[];
  income: { category: string; receipts: number; received: number }[];
}
interface Settings { reg_format: string; campus_code: string; first_voucher: boolean; declaration_urdu: boolean; next_example?: string }
const rs = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-PK');

@Component({
  selector: 'app-category-report',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-8 max-w-6xl">
    <div>
      <a routerLink="/students" class="text-xs font-black text-slate-400 hover:text-indigo-500">&larr; Students</a>
      <h2 class="text-2xl font-black tracking-tight mt-1">Categories, reports and admission settings</h2>
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (auth.canWriteStudents()) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <div><h3 class="text-lg font-black">Change category for a whole class</h3><p class="text-xs font-bold text-slate-400 mt-1">Every change is written to each student's category history and the fees are updated at once.</p></div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
          <div><label class="label" for="bc-class">Class</label><select id="bc-class" name="bc-class" class="field" [(ngModel)]="bulk.class_id" (ngModelChange)="bulk.section_id = null"><option [ngValue]="null">Choose</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
          <div><label class="label" for="bc-sec">Section</label><select id="bc-sec" name="bc-sec" class="field" [(ngModel)]="bulk.section_id"><option [ngValue]="null">All sections</option>@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
          <div><label class="label" for="bc-cat">New category</label><select id="bc-cat" name="bc-cat" class="field" [(ngModel)]="bulk.category"><option value="A">A - father in KRL</option><option value="B">B - KRL retired</option><option value="C">C - private job</option><option value="">None</option></select></div>
          <div class="col-span-2 md:col-span-1"><label class="label" for="bc-why">Reason (optional)</label><input id="bc-why" name="bc-why" class="field" [(ngModel)]="bulk.reason"></div>
          <label class="flex items-center gap-2 text-sm font-bold pb-3"><input type="checkbox" name="bc-un" [(ngModel)]="bulk.only_unset"> Only students with no category</label>
        </div>
        <button type="button" class="btn-primary" [disabled]="!bulk.class_id" (click)="runBulk()">Change category</button>
      </section>
    }

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div class="flex flex-wrap items-end gap-4">
        <h3 class="text-lg font-black mr-auto">Category report</h3>
        <div><label class="label" for="r-from">From</label><input id="r-from" name="from" type="date" class="field" [(ngModel)]="from"></div>
        <div><label class="label" for="r-to">To</label><input id="r-to" name="to" type="date" class="field" [(ngModel)]="to"></div>
        <button type="button" class="btn-primary" (click)="load()">Show</button>
        <button type="button" class="btn-ghost" (click)="csv('report')">Report CSV</button>
        <select class="field !w-auto" aria-label="Students of category" [(ngModel)]="expCat" name="expcat"><option value="">All students</option><option value="A">Category A</option><option value="B">Category B</option><option value="C">Category C</option><option value="-">No category</option></select>
        <button type="button" class="btn-ghost" (click)="csv('students')">Students CSV</button>
      </div>
      <p class="text-xs font-bold text-slate-400">Dates limit "discount given" (by voucher date) and "fee received" (by payment date). Student counts are always today's. CSV files open in Excel.</p>
      @if (rep(); as r) {
        <div class="overflow-x-auto"><table class="w-full text-sm text-left">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2">Category</th><th class="py-2 text-right">Students</th><th class="py-2 text-right">Vouchers</th><th class="py-2 text-right">Billed (before discount)</th><th class="py-2 text-right">Discount given</th><th class="py-2 text-right">Net billed</th><th class="py-2 text-right">Fee received</th></tr></thead>
          <tbody>@for (row of rows(); track row.category) {
            <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-2 font-black">{{ row.category === '-' ? 'No category' : row.category }}</td><td class="py-2 text-right font-bold">{{ row.students }}</td><td class="py-2 text-right font-bold">{{ row.vouchers }}</td>
              <td class="py-2 text-right font-bold">{{ rs(row.gross) }}</td><td class="py-2 text-right font-bold text-amber-600">{{ rs(row.discount) }}</td><td class="py-2 text-right font-bold">{{ rs(row.net) }}</td><td class="py-2 text-right font-black text-emerald-600">{{ rs(row.received) }}</td></tr> }
          </tbody></table></div>
        <details><summary class="cursor-pointer text-sm font-black text-indigo-600">Students by class and category</summary>
          <table class="w-full text-sm text-left mt-2"><tbody>@for (b of r.by_class; track $index) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-1.5 font-bold">{{ b.class_name }}</td><td class="py-1.5">{{ b.category === '-' ? 'No category' : b.category }}</td><td class="py-1.5 text-right font-black">{{ b.students }}</td></tr> }</tbody></table></details>
      }
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div><h3 class="text-lg font-black">Admission settings</h3><p class="text-xs font-bold text-slate-400 mt-1">Tokens: {{ '{YYYY}' }} year, {{ '{YY}' }} short year, {{ '{CLASS}' }} class number (07), {{ '{CAMPUS}' }} campus code, {{ '{SEQ}' }} / {{ '{SEQ3}' }} / {{ '{SEQ4}' }} running number. Example: {{ '{CAMPUS}-{YY}-{CLASS}-{SEQ3}' }} gives MAIN-26-07-014.</p></div>
      <div class="grid md:grid-cols-3 gap-4">
        <div><label class="label" for="a-fmt">Admission number format</label><input id="a-fmt" name="fmt" class="field" [disabled]="!canSettings()" [(ngModel)]="set.reg_format"></div>
        <div><label class="label" for="a-campus">Campus code</label><input id="a-campus" name="campus" class="field" [disabled]="!canSettings()" [(ngModel)]="set.campus_code"></div>
        <div class="flex flex-col justify-end gap-2 pb-1 text-sm font-bold">
          <label class="flex items-center gap-2"><input type="checkbox" name="fv" [disabled]="!canSettings()" [(ngModel)]="set.first_voucher"> Make the first voucher (admission fee + first month) when a student is saved</label>
          <label class="flex items-center gap-2"><input type="checkbox" name="ur" [disabled]="!canSettings()" [(ngModel)]="set.declaration_urdu"> Add an Urdu declaration to the printed form</label>
        </div>
      </div>
      @if (canSettings()) { <button type="button" class="btn-primary" (click)="saveSettings()">Save settings</button> } @else { <p class="text-xs font-bold text-slate-400">Only the director or principal can change these.</p> }
      @if (set.next_example) { <p class="text-sm font-bold text-emerald-600">Next number would look like: {{ set.next_example }}</p> }
    </section>
  </div>
  `
})
export class CategoryReport {
  private api = inject(Api); private toast = inject(ToastService);
  auth = inject(AuthService); rs = rs;
  classes = signal<ClassInfo[]>([]); rep = signal<Report | null>(null); error = signal('');
  bulk = { class_id: null as number | null, section_id: null as number | null, category: 'A', reason: '', only_unset: true };
  from = ''; to = ''; expCat = '';
  set: Settings = { reg_format: '{YYYY}-{SEQ4}', campus_code: '', first_voucher: false, declaration_urdu: false };
  sections = computed(() => this.classes().find(c => c.id === this.bulk.class_id)?.sections ?? []);
  canSettings = () => this.auth.isLeadership();
  rows = computed(() => {
    const r = this.rep(); if (!r) return [];
    const m = new Map<string, { category: string; students: number; vouchers: number; gross: number; discount: number; net: number; received: number }>();
    const get = (c: string) => { let x = m.get(c); if (!x) { x = { category: c, students: 0, vouchers: 0, gross: 0, discount: 0, net: 0, received: 0 }; m.set(c, x); } return x; };
    r.counts.forEach(x => get(x.category).students = x.students);
    r.discount.forEach(x => Object.assign(get(x.category), { vouchers: x.vouchers, gross: x.gross, discount: x.discount, net: x.net }));
    r.income.forEach(x => get(x.category).received = x.received);
    return [...m.values()].sort((a, b) => a.category.localeCompare(b.category));
  });
  constructor() {
    this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => this.classes.set(c), error: e => this.error.set(errorText(e)) });
    this.api.get<Settings>('/students/admission-settings').subscribe({ next: s => this.set = s, error: () => { /* optional */ } });
    this.load();
  }
  load() { this.error.set(''); this.api.get<Report>('/students/reports/category', { from: this.from || undefined, to: this.to || undefined }).subscribe({ next: r => this.rep.set(r), error: e => this.error.set(errorText(e)) }); }
  runBulk() {
    const where = this.bulk.section_id ? 'this section' : 'this whole class';
    if (!confirm(`Set category ${this.bulk.category || 'none'} for ${where}${this.bulk.only_unset ? ' (only students without a category)' : ''}?`)) return;
    this.api.post<{ matched: number; changed: number }>('/students/bulk-category', this.bulk).subscribe({
      next: r => { this.toast.show(`${r.changed} of ${r.matched} students changed.`); this.load(); }, error: e => this.error.set(errorText(e))
    });
  }
  saveSettings() {
    this.error.set('');
    this.api.put<Settings>('/students/admission-settings', this.set).subscribe({ next: s => { this.set = s; this.toast.show('Saved.'); }, error: e => this.error.set(errorText(e)) });
  }
  csv(kind: 'report' | 'students') {
    const req = kind === 'report'
      ? this.api.get<{ csv: string }>('/students/reports/category', { from: this.from || undefined, to: this.to || undefined, csv: 1 })
      : this.api.get<{ csv: string }>('/students/export', { category: this.expCat || undefined });
    req.subscribe({
      next: r => { const url = URL.createObjectURL(new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = kind === 'report' ? 'category-report.csv' : 'students.csv'; a.click(); URL.revokeObjectURL(url); },
      error: e => this.error.set(errorText(e))
    });
  }
}
