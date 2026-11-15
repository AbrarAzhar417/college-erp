import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { monthLabel, money, today } from './hr';

interface Row { id: number; emp_no: string; name: string; designation: string | null; basic_salary: number; house_allow: number; medical_allow: number; conveyance_allow: number; other_allow: number; fixed_deduction: number; edit?: boolean }
interface Loan { id: number; staff_id: number; name: string; kind: string; total: number; installment: number; start_month: string; note: string | null; active: number; recovered: number; remaining: number }
const FIELDS = ['basic_salary', 'house_allow', 'medical_allow', 'conveyance_allow', 'other_allow', 'fixed_deduction'] as const;

@Component({
  selector: 'app-hr-salary',
  imports: [FormsModule],
  template: `
  <div class="space-y-8">
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <section class="space-y-4">
      <h3 class="text-xl font-black tracking-tight">Salary structure</h3>
      <p class="text-sm font-bold text-slate-400">Rs per month for each person. Gross = basic + allowances. The fixed deduction (like a provident fund) is cut every month.</p>
      <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-4 py-4">Staff</th><th class="px-3 py-4">Basic</th><th class="px-3 py-4">House</th><th class="px-3 py-4">Medical</th><th class="px-3 py-4">Conveyance</th><th class="px-3 py-4">Other</th><th class="px-3 py-4">Fixed deduction</th><th class="px-4 py-4 text-right">Gross</th><th class="px-4 py-4"></th></tr></thead>
          <tbody>@for (r of rows(); track r.id) {
            <tr class="border-b border-slate-50 dark:border-slate-800/60">
              <td class="px-4 py-2 font-black">{{ r.name }}<span class="block text-[11px] font-bold text-slate-400">{{ r.emp_no }} · {{ r.designation || '-' }}</span></td>
              @for (f of fields; track f) { <td class="px-3 py-2">@if (r.edit) { <input type="number" min="0" class="field !py-2 w-28" [attr.aria-label]="f + ' ' + r.name" [(ngModel)]="r[f]" [name]="f + r.id"> } @else { {{ m(r[f]) }} }</td> }
              <td class="px-4 py-2 text-right font-black">{{ m(gross(r)) }}</td>
              <td class="px-4 py-2 text-right whitespace-nowrap">@if (r.edit) { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="save(r)">Save</button> } @else { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="r.edit = true">Edit</button> }</td></tr> }</tbody>
        </table>
        @if (!rows().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No staff yet.</p> }
      </div>
    </section>

    <section class="space-y-4">
      <h3 class="text-xl font-black tracking-tight">Advance and loan (cut in instalments)</h3>
      <form (ngSubmit)="addLoan()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
        <div class="col-span-2"><label class="label" for="ls">Staff member</label><select id="ls" name="ls" class="field" required [(ngModel)]="lf.staff_id"><option [ngValue]="null" disabled>Choose…</option>@for (s of rows(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
        <div><label class="label" for="lk">Kind</label><select id="lk" name="lk" class="field" [(ngModel)]="lf.kind"><option value="advance">Advance</option><option value="loan">Loan</option></select></div>
        <div><label class="label" for="lt">Total (Rs)</label><input id="lt" name="lt" type="number" min="1" class="field" required [(ngModel)]="lf.total"></div>
        <div><label class="label" for="li">Cut per month</label><input id="li" name="li" type="number" min="1" class="field" required [(ngModel)]="lf.installment"></div>
        <div><label class="label" for="lm">Start from</label><input id="lm" name="lm" type="month" class="field" required [(ngModel)]="lf.start_month"></div>
        <div class="col-span-2 md:col-span-5"><label class="label" for="ln">Note</label><input id="ln" name="ln" class="field" [(ngModel)]="lf.note"></div>
        <button class="btn-primary" type="submit">Add</button>
      </form>
      <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Staff</th><th class="px-5 py-4">Kind</th><th class="px-5 py-4 text-right">Total</th><th class="px-5 py-4 text-right">Per month</th><th class="px-5 py-4">From</th><th class="px-5 py-4 text-right">Recovered</th><th class="px-5 py-4 text-right">Remaining</th><th class="px-5 py-4"></th></tr></thead>
          <tbody>@for (l of loans(); track l.id) {
            <tr class="border-b border-slate-50 dark:border-slate-800/60" [class.opacity-50]="!l.active || l.remaining <= 0"><td class="px-5 py-3 font-black">{{ l.name }}<span class="block text-[11px] font-bold text-slate-400">{{ l.note }}</span></td><td class="px-5 py-3 capitalize font-bold">{{ l.kind }}</td>
              <td class="px-5 py-3 text-right">{{ m(l.total) }}</td><td class="px-5 py-3 text-right">{{ m(l.installment) }}</td><td class="px-5 py-3">{{ ml(l.start_month) }}</td><td class="px-5 py-3 text-right">{{ m(l.recovered) }}</td><td class="px-5 py-3 text-right font-black">{{ m(l.remaining) }}</td>
              <td class="px-5 py-3 text-right">@if (l.active && l.remaining > 0) { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="close(l)">Stop cutting</button> }</td></tr> }</tbody>
        </table>
        @if (!loans().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No advances or loans.</p> }
      </div>
      <p class="text-xs font-bold text-slate-400">"Recovered" counts only approved and paid salaries. The instalment goes into the salary sheet when you make or recalculate it.</p>
    </section>
  </div>
  `
})
export class HrSalary {
  private api = inject(Api);
  private toast = inject(ToastService);
  m = money; ml = monthLabel; fields = FIELDS;
  rows = signal<Row[]>([]); loans = signal<Loan[]>([]); error = signal('');
  lf: { staff_id: number | null; kind: string; total: number | null; installment: number | null; start_month: string; note: string } = { staff_id: null, kind: 'advance', total: null, installment: null, start_month: today().slice(0, 7), note: '' };
  constructor() { this.load(); }
  gross = (r: Row) => r.basic_salary + r.house_allow + r.medical_allow + r.conveyance_allow + r.other_allow;
  load() {
    this.api.get<Row[]>('/hr/structure').subscribe({ next: r => this.rows.set(r), error: e => this.error.set(errorText(e)) });
    this.api.get<Loan[]>('/hr/loans').subscribe({ next: l => this.loans.set(l), error: e => this.error.set(errorText(e)) });
  }
  save(r: Row) { this.api.put(`/hr/structure/${r.id}`, r).subscribe({ next: () => { r.edit = false; this.toast.show('Saved. Recalculate the draft salary sheet to use it.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  addLoan() { this.error.set(''); this.api.post('/hr/loans', this.lf).subscribe({ next: () => { this.toast.show('Added.'); this.lf.total = null; this.lf.installment = null; this.lf.note = ''; this.load(); }, error: e => this.error.set(errorText(e)) }); }
  close(l: Loan) { if (!confirm('Stop cutting this from the salary?')) return; this.api.put(`/hr/loans/${l.id}/close`, {}).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
