import { StudentAvatar } from '../pages/student-avatar';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { SettingsService } from '../core/settings';
import { ToastService } from '../core/toast';
import { FeePrintService, fmtDate, money, today } from './fee';

interface Acct {
  student: { id: number; name: string; father_name: string; gender: string; phone: string | null; address: string | null; reg_no: string; roll_no: number | null; father_cnic: string | null; admission_date: string; class_name: string; section_name: string };
  ledger: { id: number; date: string; kind: string; amount: number; note: string | null; balance: number; voucher_no: string | null; receipt_no: string | null; payment_id: number | null }[];
  totals: { charged: number; paid: number; waived: number; balance: number };
  vouchers: { id: number; voucher_no: string; period_label: string; due_date: string; net: number; arrears: number; payable: number; paid: number; balance: number; status: string }[];
  plan: { heads: { id: number; name: string; frequency: string; optional: boolean; classAmount: number; assigned: boolean; amount: number | null }[]; concessions: { id?: number; head_id: number | null; kind: 'fixed' | 'percent'; value: number; reason: string | null }[] };
}
const KIND_LABEL: Record<string, string> = { opening: 'Previous balance', charge: 'Fee voucher', payment: 'Payment', fine: 'Fine', waiver: 'Waiver', adjustment: 'Adjustment' };

@Component({
  selector: 'app-fee-student',
  imports: [FormsModule, RouterLink, StudentAvatar],
  template: `
  @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (a(); as a) {
  <div class="space-y-8">
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
        <app-student-avatar [id]="a.student.id" [name]="a.student.name" [has]="true" [gender]="a.student.gender" size="lg" />
        <div class="flex-1">
          <h3 class="text-3xl font-black tracking-tighter">{{ a.student.name }}</h3>
          <dl class="mt-4 grid grid-cols-2 md:grid-cols-3 gap-x-10 gap-y-3 text-sm">
            <div><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Father</dt><dd class="font-bold">{{ a.student.father_name }}</dd></div>
            <div><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Class</dt><dd class="font-bold">{{ a.student.class_name }}-{{ a.student.section_name }}</dd></div>
            <div><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Roll no.</dt><dd class="font-bold">{{ a.student.roll_no ?? '-' }}</dd></div>
            <div><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Admission no.</dt><dd class="font-bold">{{ a.student.reg_no }}</dd></div>
            <div><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Contact</dt><dd class="font-bold">{{ a.student.phone || '-' }}</dd></div>
            <div><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Admitted</dt><dd class="font-bold">{{ d(a.student.admission_date) }}</dd></div>
            @if (a.student.father_cnic) { <div><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Father CNIC</dt><dd class="font-bold">{{ a.student.father_cnic }}</dd></div> }
            @if (a.student.address) { <div class="col-span-2"><dt class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Address</dt><dd class="font-bold">{{ a.student.address }}</dd></div> }
          </dl>
        </div>
        <div class="no-print flex flex-wrap lg:flex-col gap-3">
          <a [routerLink]="['/fee/collect']" [queryParams]="{ studentId: a.student.id }" class="btn-primary">Receive payment</a>
          <a [routerLink]="['/fee/generate']" [queryParams]="{ studentId: a.student.id }" class="btn-ghost">Generate voucher</a>
          <button type="button" class="btn-ghost" (click)="showAdjust.set(!showAdjust())">Add entry</button>
          <button type="button" class="btn-ghost" (click)="print()">Print statement</button>
        </div>
      </div>
    </section>

    <section class="no-print grid grid-cols-2 xl:grid-cols-4 gap-5 md:gap-8">
      @for (k of kpis(); track k.label) {
        <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <p class="text-2xl md:text-3xl font-black tracking-tighter" [class]="k.cls">{{ k.value }}</p>
          <p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p>
        </div>
      }
    </section>

    @if (showAdjust()) {
      <form (ngSubmit)="adjust()" class="no-print bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <h3 class="text-xl font-black tracking-tight">Add an entry to this account</h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-5">
          <div><label class="label" for="at">Type</label>
            <select id="at" name="at" class="field" [(ngModel)]="adj.type">
              <option value="opening">Previous balance (from old records)</option><option value="fine">Fine</option><option value="other_charge">Other charge</option>
              <option value="waiver">Waiver (reduces dues)</option><option value="other_credit">Other credit</option></select></div>
          <div><label class="label" for="aa">Amount (Rs)</label><input id="aa" name="aa" type="number" min="1" class="field" required [(ngModel)]="adj.amount"></div>
          <div><label class="label" for="ad">Date</label><input id="ad" name="ad" type="date" class="field" [(ngModel)]="adj.date"></div>
          <div><label class="label" for="an">Note</label><input id="an" name="an" class="field" [(ngModel)]="adj.note"></div>
        </div>
        <button class="btn-primary" type="submit">Save entry</button>
      </form>
    }

    <section class="no-print bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <h3 class="text-xl font-black tracking-tight">Vouchers</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
            <th class="py-3 pr-4">Voucher</th><th class="py-3 pr-4">Period</th><th class="py-3 pr-4">Due</th><th class="py-3 pr-4 text-right">Charge</th><th class="py-3 pr-4 text-right">Still due</th><th class="py-3"></th></tr></thead>
          <tbody>
            @for (v of a.vouchers; track v.id) {
              <tr class="border-b border-slate-50 dark:border-slate-800/60" [class.opacity-40]="v.status === 'cancelled'">
                <td class="py-3 pr-4 font-bold text-slate-500 whitespace-nowrap">{{ v.voucher_no }}</td>
                <td class="py-3 pr-4 whitespace-nowrap">{{ v.period_label }}{{ v.status === 'cancelled' ? ' (cancelled)' : '' }}</td>
                <td class="py-3 pr-4 whitespace-nowrap">{{ d(v.due_date) }}</td>
                <td class="py-3 pr-4 text-right font-black whitespace-nowrap">Rs {{ m(v.net) }}</td>
                <td class="py-3 pr-4 text-right font-black whitespace-nowrap" [class]="v.balance > 0 ? 'text-rose-500' : 'text-emerald-500'">{{ v.balance > 0 ? 'Rs ' + m(v.balance) : 'Paid' }}</td>
                <td class="py-3 text-right"><button type="button" class="px-3 py-2 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="printVoucher(v.id)">Print</button></td>
              </tr>
            }
          </tbody>
        </table>
        @if (!a.vouchers.length) { <p class="text-sm font-bold text-slate-400 py-4">No vouchers yet.</p> }
      </div>
    </section>

    <section class="print-area bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <div>
        <h3 class="text-xl font-black tracking-tight">Fee statement</h3>
        <p class="text-xs font-bold text-slate-400 mt-1">{{ settings.instituteName() }} · {{ a.student.name }} ({{ a.student.class_name }}-{{ a.student.section_name }}, Roll {{ a.student.roll_no ?? '-' }}, Admission {{ a.student.reg_no }}) · Printed {{ d(todayIso) }}</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
            <th class="py-3 pr-4">Date</th><th class="py-3 pr-4">Details</th><th class="py-3 pr-4">Ref.</th><th class="py-3 pr-4 text-right">Charged</th><th class="py-3 pr-4 text-right">Paid / credit</th><th class="py-3 text-right">Balance</th><th class="py-3 no-print"></th></tr></thead>
          <tbody>
            @for (r of a.ledger; track r.id) {
              <tr class="border-b border-slate-50 dark:border-slate-800/60">
                <td class="py-3 pr-4 whitespace-nowrap">{{ d(r.date) }}</td>
                <td class="py-3 pr-4"><span class="font-black">{{ kind(r.kind) }}</span><span class="block text-[11px] font-bold text-slate-400">{{ r.note }}</span></td>
                <td class="py-3 pr-4 text-slate-500 whitespace-nowrap">{{ r.voucher_no || r.receipt_no || '' }}</td>
                <td class="py-3 pr-4 text-right whitespace-nowrap">{{ r.amount > 0 ? m(r.amount) : '' }}</td>
                <td class="py-3 pr-4 text-right whitespace-nowrap text-emerald-600">{{ r.amount < 0 ? m(-r.amount) : '' }}</td>
                <td class="py-3 text-right font-black whitespace-nowrap">{{ r.balance < 0 ? '(' + m(-r.balance) + ')' : m(r.balance) }}</td>
                <td class="py-3 text-right no-print">
                  @if (r.kind === 'payment' && r.payment_id) {
                    <a [routerLink]="['/fee/receipt', r.payment_id]" class="px-2 py-1 text-xs font-black text-indigo-600">Receipt</a>
                    @if (auth.user()?.role !== 'admin') { <button type="button" class="px-2 py-1 text-xs font-black text-rose-500" (click)="cancelPayment(r.payment_id)">Cancel</button> }
                  }
                </td>
              </tr>
            }
          </tbody>
          <tfoot><tr class="font-black"><td colspan="3" class="pt-4">Total</td><td class="pt-4 text-right">{{ m(a.totals.charged) }}</td><td class="pt-4 text-right text-emerald-600">{{ m(a.totals.paid + a.totals.waived) }}</td>
            <td class="pt-4 text-right" [class]="a.totals.balance > 0 ? 'text-rose-500' : 'text-emerald-600'">{{ a.totals.balance < 0 ? '(' + m(-a.totals.balance) + ')' : m(a.totals.balance) }}</td><td class="no-print"></td></tr></tfoot>
        </table>
      </div>
      @if (!a.ledger.length) { <p class="text-sm font-bold text-slate-400">Nothing has been charged or paid yet.</p> }
    </section>

    <section class="no-print bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div>
        <h3 class="text-xl font-black tracking-tight">Fee plan</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Extra fees (like transport) and concessions for this student. They apply to every voucher from now on.</p>
      </div>
      <div class="space-y-3">
        @for (h of plan().heads; track h.id) {
          <div class="grid grid-cols-12 gap-3 items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <label class="col-span-12 md:col-span-6 flex items-center gap-3 text-sm font-bold">
              @if (h.optional) { <input type="checkbox" class="w-5 h-5 accent-indigo-600" [(ngModel)]="h.assigned" [name]="'h' + h.id"> }
              {{ h.name }} <span class="text-slate-400 font-bold">{{ h.optional ? '(extra)' : '' }}</span>
            </label>
            <div class="col-span-12 md:col-span-6 flex items-center gap-3">
              <span class="text-xs font-bold text-slate-400 whitespace-nowrap">Class amount Rs {{ m(h.classAmount) }}. This student pays Rs</span>
              <input type="number" min="0" class="field !py-2.5 !w-32" [(ngModel)]="h.amount" [name]="'a' + h.id" [placeholder]="h.classAmount ? '' + h.classAmount : 'amount'" [disabled]="h.optional && !h.assigned">
            </div>
          </div>
        }
      </div>
      <div class="space-y-3">
        <span class="label !ml-0">Concessions</span>
        @for (c of plan().concessions; track $index; let i = $index) {
          <div class="grid grid-cols-12 gap-3 items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <select class="field col-span-6 md:col-span-3 !py-2.5" [(ngModel)]="c.head_id" [name]="'ch' + i" aria-label="Applies to"><option [ngValue]="null">Main fees</option>@for (h of plan().heads; track h.id) { <option [ngValue]="h.id">{{ h.name }}</option> }</select>
            <select class="field col-span-3 md:col-span-2 !py-2.5" [(ngModel)]="c.kind" [name]="'ck' + i" aria-label="Type"><option value="percent">Percent</option><option value="fixed">Rs fixed</option></select>
            <input type="number" min="1" class="field col-span-3 md:col-span-2 !py-2.5" [(ngModel)]="c.value" [name]="'cv' + i" aria-label="Value">
            <input class="field col-span-9 md:col-span-4 !py-2.5" placeholder="Reason (e.g. sibling discount)" [(ngModel)]="c.reason" [name]="'cr' + i" aria-label="Reason">
            <button type="button" class="col-span-3 md:col-span-1 text-xs font-black text-rose-500" (click)="removeConcession(i)">Remove</button>
          </div>
        }
        <button type="button" class="btn-ghost" (click)="addConcession()">Add concession</button>
      </div>
      <button type="button" class="btn-primary" (click)="savePlan()">Save fee plan</button>
    </section>
  </div>
  }
  `
})
export class FeeStudent {
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  private store = inject(FeePrintService);
  auth = inject(AuthService);
  settings = inject(SettingsService);
  m = money; d = fmtDate; todayIso = today();
  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => Number(p.get('id')))));

  a = signal<Acct | null>(null);
  plan = signal<Acct['plan']>({ heads: [], concessions: [] });
  error = signal('');
  showAdjust = signal(false);
  adj = { type: 'opening', amount: null as number | null, date: today(), note: '' };

  kpis = computed(() => {
    const t = this.a()?.totals; if (!t) return [];
    return [
      { label: 'Total charged', value: 'Rs ' + money(t.charged), cls: '' },
      { label: 'Total paid', value: 'Rs ' + money(t.paid), cls: 'text-emerald-600' },
      { label: 'Waived', value: 'Rs ' + money(t.waived), cls: '' },
      { label: t.balance < 0 ? 'Advance paid' : 'Balance remaining', value: 'Rs ' + money(Math.abs(t.balance)), cls: t.balance > 0 ? 'text-rose-500' : 'text-emerald-600' }
    ];
  });

  constructor() { this.load(); }
  kind(k: string) { return KIND_LABEL[k] ?? k; }

  load() {
    this.api.get<Acct>(`/fee/student/${this.id()}`).subscribe({
      next: a => { this.a.set(a); this.plan.set(structuredClone(a.plan)); this.error.set(''); },
      error: e => this.error.set(errorText(e))
    });
  }
  print() { window.print(); }
  printVoucher(id: number) { this.store.set([id]); this.router.navigateByUrl('/fee/print'); }

  adjust() {
    this.api.post(`/fee/student/${this.id()}/adjust`, this.adj).subscribe({
      next: () => { this.toast.show('Entry saved.'); this.adj = { type: 'opening', amount: null, date: today(), note: '' }; this.showAdjust.set(false); this.load(); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
  cancelPayment(paymentId: number) {
    if (!confirm('Cancel this payment? It is removed from the account and the dues come back.')) return;
    this.api.post(`/fee/payments/${paymentId}/cancel`, {}).subscribe({ next: () => { this.toast.show('Payment cancelled.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }

  addConcession() { const p = this.plan(); this.plan.set({ ...p, concessions: [...p.concessions, { head_id: p.heads[0]?.id ?? null, kind: 'percent', value: 10, reason: '' }] }); }
  removeConcession(i: number) { const p = this.plan(); this.plan.set({ ...p, concessions: p.concessions.filter((_, x) => x !== i) }); }
  savePlan() {
    const p = this.plan();
    const heads = p.heads.filter(h => (h.optional ? h.assigned : !!h.amount)).map(h => ({ head_id: h.id, amount: h.amount || null }));
    this.api.put(`/fee/student/${this.id()}/plan`, { heads, concessions: p.concessions }).subscribe({
      next: () => { this.toast.show('Fee plan saved.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
