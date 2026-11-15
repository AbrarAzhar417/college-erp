import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { HrConfig, SLIP_STATUS, Slip, csv, monthLabel, money, slipBadge, today, fmtDate } from './hr';

interface Adj { id: number; staff_id: number; name: string; kind: string; amount: number; note: string | null }
interface Payroll { month: string; rows: Slip[]; config: HrConfig; adjustments: Adj[]; totals: { count: number; gross: number; cut: number; additions: number; other: number; net: number; draft: number; approved: number; paid: number; unmarked: number } }
interface Pick { id: number; name: string }
const KINDS = [{ key: 'bonus', label: 'Bonus (adds)' }, { key: 'overtime', label: 'Overtime (adds)' }, { key: 'arrears', label: 'Arrears (adds)' }, { key: 'advance', label: 'Advance (cuts)' }, { key: 'deduction', label: 'Other deduction (cuts)' }];

@Component({
  selector: 'app-hr-payroll',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-wrap items-end gap-4">
      <div><label class="label" for="pm">Month</label><input id="pm" type="month" class="field" [ngModel]="month()" (ngModelChange)="month.set($event); load()"></div>
      <button type="button" class="btn-primary" (click)="generate()" [disabled]="busy()">{{ (p()?.totals?.count ?? 0) ? 'Recalculate drafts' : 'Make salary sheet' }}</button>
      @if (leader) { <button type="button" class="btn-ghost" (click)="bulk('approve')" [disabled]="!(p()?.totals?.draft)">Approve all drafts</button> }
      <button type="button" class="btn-ghost" (click)="bulk('pay')" [disabled]="!(p()?.totals?.approved)">Mark approved as paid</button>
      @if (p()?.totals?.count) { <a class="btn-ghost" routerLink="/hr/print/sheet" [queryParams]="{ month: month() }">Print salary sheet</a><a class="btn-ghost" routerLink="/hr/print/slips" [queryParams]="{ month: month() }">Print all payslips</a><button type="button" class="btn-ghost" (click)="bankFile()">Bank file (CSV)</button> }
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (p(); as x) {
      <p class="text-sm font-bold text-slate-400">{{ ml(x.month) }}. A day's salary = {{ x.config.day_divisor === '30' ? 'salary ÷ 30' : 'salary ÷ school days of the month' }}. Absent days, half days (half), unpaid leave and days before joining are cut{{ x.config.late_per_day ? '; ' + x.config.late_per_day + ' lates = 1 day cut' : '; late is not cut' }}. Draft → Approved → Paid; approved and paid sheets are locked.</p>
      @if (x.totals.unmarked) { <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ x.totals.unmarked }} staff days have no attendance mark. They are not cut. Mark them first, then recalculate.</p> }
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2rem] border border-slate-200 dark:border-slate-800"><p class="label !ml-0">Gross</p><p class="text-2xl font-black">Rs {{ m(x.totals.gross) }}</p></div>
        <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2rem] border border-slate-200 dark:border-slate-800"><p class="label !ml-0">Absent etc. cut</p><p class="text-2xl font-black text-rose-600">Rs {{ m(x.totals.cut) }}</p></div>
        <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2rem] border border-slate-200 dark:border-slate-800"><p class="label !ml-0">Added</p><p class="text-2xl font-black text-emerald-600">Rs {{ m(x.totals.additions) }}</p></div>
        <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2rem] border border-slate-200 dark:border-slate-800"><p class="label !ml-0">Advance, loan, other</p><p class="text-2xl font-black text-rose-600">Rs {{ m(x.totals.other) }}</p></div>
        <div class="bg-indigo-600 text-white p-5 rounded-[2rem]"><p class="text-[10px] font-black uppercase tracking-widest opacity-80">To pay</p><p class="text-2xl font-black">Rs {{ m(x.totals.net) }}</p><p class="text-[11px] font-bold opacity-80">{{ x.totals.draft }} draft · {{ x.totals.approved }} approved · {{ x.totals.paid }} paid</p></div>
      </div>

      <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-4 py-4">Staff</th><th class="px-4 py-4 text-right">Gross</th><th class="px-4 py-4 text-right">Cut days</th><th class="px-4 py-4 text-right">Cut</th><th class="px-4 py-4 text-right">Added</th><th class="px-4 py-4 text-right">Advance / loan / other</th><th class="px-4 py-4 text-right">Net</th><th class="px-4 py-4">Status</th><th class="px-4 py-4"></th></tr></thead>
          <tbody>@for (r of x.rows; track r.id) {
            <tr class="border-b border-slate-50 dark:border-slate-800/60">
              <td class="px-4 py-3 font-black">{{ r.name }}<span class="block text-[11px] font-bold text-slate-400">{{ r.emp_no }} · {{ r.designation || '-' }}{{ r.unmarked ? ' · ' + r.unmarked + ' days not marked' : '' }}</span></td>
              <td class="px-4 py-3 text-right whitespace-nowrap">{{ m(r.gross) }}</td>
              <td class="px-4 py-3 text-right text-xs font-bold whitespace-nowrap">{{ cutDays(r) }}<span class="block text-slate-400">{{ cutWhy(r) }}</span></td>
              <td class="px-4 py-3 text-right text-rose-600 whitespace-nowrap">{{ r.cut_amount ? '-' + m(r.cut_amount) : '-' }}</td>
              <td class="px-4 py-3 text-right text-emerald-600 whitespace-nowrap">{{ r.bonus + r.overtime + r.arrears ? '+' + m(r.bonus + r.overtime + r.arrears) : '-' }}</td>
              <td class="px-4 py-3 text-right text-rose-600 whitespace-nowrap">{{ other(r) ? '-' + m(other(r)) : '-' }}</td>
              <td class="px-4 py-3 text-right font-black whitespace-nowrap">{{ m(r.net) }}</td>
              <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="sb(r.status)">{{ ss[r.status] }}{{ r.paid_date ? ' ' + d(r.paid_date) : '' }}</span></td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                @if (leader && r.status === 'draft') { <button type="button" class="px-2.5 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="one('approve', r)">Approve</button> }
                @if (leader && r.status === 'approved') { <button type="button" class="px-2.5 py-1.5 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-500/10" (click)="one('reopen', r)">Reopen</button> }
                @if (r.status === 'approved') { <button type="button" class="px-2.5 py-1.5 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="one('pay', r)">Paid</button> }
                <a class="px-2.5 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" routerLink="/hr/print/slips" [queryParams]="{ month: x.month, staffId: r.staff_id }">Payslip</a></td></tr> }</tbody>
        </table>
        @if (!x.rows.length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No salary sheet for this month yet. Press "Make salary sheet". Set each person's salary first under "Salary &amp; loans".</p> }
      </div>

      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-lg font-black tracking-tight">Bonus, overtime, arrears, advance and other deductions for {{ ml(x.month) }}</h3>
        <form (ngSubmit)="addAdj()" class="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
          <div class="col-span-2"><label class="label" for="as">Staff member</label><select id="as" name="as" class="field" required [(ngModel)]="adj.staff_id"><option [ngValue]="null" disabled>Choose…</option>@for (s of picks(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
          <div><label class="label" for="ak">What</label><select id="ak" name="ak" class="field" [(ngModel)]="adj.kind">@for (k of kinds; track k.key) { <option [value]="k.key">{{ k.label }}</option> }</select></div>
          <div><label class="label" for="aa">Amount (Rs)</label><input id="aa" name="aa" type="number" min="1" class="field" required [(ngModel)]="adj.amount"></div>
          <div><label class="label" for="an">Note</label><input id="an" name="an" class="field" [(ngModel)]="adj.note"></div>
          <button class="btn-primary col-span-2 md:col-span-5" type="submit">Add entry (then press Recalculate drafts)</button>
        </form>
        @for (a of x.adjustments; track a.id) { <p class="flex items-center justify-between text-sm font-bold py-1.5 border-b border-slate-100 dark:border-slate-800"><span>{{ a.name }} · {{ kindLabel(a.kind) }}{{ a.note ? ' · ' + a.note : '' }}</span><span>Rs {{ m(a.amount) }} <button type="button" class="ml-3 text-xs font-black text-rose-500" (click)="removeAdj(a)">Delete</button></span></p> }
        <p class="text-xs font-bold text-slate-400">For a loan paid back in instalments, use "Salary &amp; loans": it cuts the instalment by itself every month.</p>
      </section>
    }
  </div>
  `
})
export class HrPayroll {
  private api = inject(Api);
  private toast = inject(ToastService);
  leader = inject(AuthService).isLeadership();
  m = money; ml = monthLabel; ss = SLIP_STATUS; sb = slipBadge; d = fmtDate; kinds = KINDS;
  month = signal(today().slice(0, 7)); p = signal<Payroll | null>(null); picks = signal<Pick[]>([]); error = signal(''); busy = signal(false);
  adj: { staff_id: number | null; kind: string; amount: number | null; note: string } = { staff_id: null, kind: 'bonus', amount: null, note: '' };
  constructor() {
    this.api.get<{ id: number; name: string }[]>('/hr/structure').subscribe({ next: s => this.picks.set(s.map(x => ({ id: x.id, name: x.name }))) });
    this.load();
  }
  /** Approved and paid salaries with the account of each person, ready to give to the bank. */
  bankFile() {
    this.api.get<{ month: string; rows: { emp_no: string; name: string; cnic: string | null; bank_name: string | null; account_no: string | null; net: number; status: string }[] }>('/hr/payroll/bank', { month: this.month() }).subscribe({
      next: r => {
        if (!r.rows.length) { this.toast.show('Approve the salary sheet first. The bank file has only approved or paid salaries.', 'error'); return; }
        const missing = r.rows.filter(x => !x.account_no).length;
        csv(`bank-file-${r.month}.csv`, [['Emp no', 'Name', 'CNIC', 'Bank', 'Account no / IBAN', 'Net salary'], ...r.rows.map(x => [x.emp_no, x.name, x.cnic, x.bank_name, x.account_no, x.net])]);
        this.toast.show(missing ? `Bank file made. ${missing} staff have no account number yet.` : 'Bank file made.', missing ? 'error' : 'ok');
      }, error: e => this.toast.show(errorText(e), 'error')
    });
  }
  other = (r: Slip) => r.fixed_deduction + r.advance + r.loan + r.other_deduction;
  cutDays = (r: Slip) => { const n = r.absent_days + r.unpaid_days + r.notjoined_days + r.late_cut_days; return n ? String(n) : '-'; };
  cutWhy = (r: Slip) => [r.absent_days ? r.absent_days + ' absent' : '', r.unpaid_days ? r.unpaid_days + ' unpaid leave' : '', r.late_cut_days ? r.late_count + ' late' : '', r.notjoined_days ? r.notjoined_days + ' not working' : ''].filter(Boolean).join(', ');
  kindLabel(k: string) { return KINDS.find(x => x.key === k)?.label ?? k; }
  load() { this.error.set(''); this.api.get<Payroll>('/hr/payroll', { month: this.month() }).subscribe({ next: p => this.p.set(p), error: e => this.error.set(errorText(e)) }); }
  generate() {
    this.busy.set(true);
    this.api.post<{ created: number; updated: number; skippedLocked: number }>('/hr/payroll/generate', { month: this.month() }).subscribe({
      next: r => { this.busy.set(false); this.toast.show(`${r.created} new, ${r.updated} recalculated${r.skippedLocked ? `, ${r.skippedLocked} locked (approved or paid) left as they are` : ''}.`); this.load(); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  bulk(what: 'approve' | 'pay') {
    if (!confirm(what === 'approve' ? 'Approve every draft salary of this month? They will be locked.' : 'Mark every approved salary of this month as paid today?')) return;
    this.api.post(`/hr/payroll/${what}`, { month: this.month(), date: today() }).subscribe({ next: () => { this.toast.show('Done.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  one(what: 'approve' | 'reopen' | 'pay', r: Slip) {
    this.api.post(`/hr/payroll/${what}`, { month: this.month(), ids: [r.id], date: today() }).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') });
  }
  addAdj() {
    this.error.set('');
    this.api.post('/hr/adjustments', { ...this.adj, month: this.month() }).subscribe({ next: () => { this.toast.show('Added. Press "Recalculate drafts" to apply it.'); this.adj.amount = null; this.adj.note = ''; this.load(); }, error: e => this.error.set(errorText(e)) });
  }
  removeAdj(a: Adj) { this.api.delete(`/hr/adjustments/${a.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
