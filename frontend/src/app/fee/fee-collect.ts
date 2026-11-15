import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { StudentHit, fmtDate, money, today } from './fee';

interface Acct {
  student: { id: number; name: string; father_name: string; reg_no: string; roll_no: number | null; phone: string | null; class_name: string; section_name: string };
  totals: { charged: number; paid: number; waived: number; balance: number };
  vouchers: { id: number; voucher_no: string; period_label: string; due_date: string; late_fine: number; status: string; balance: number }[];
}

@Component({
  selector: 'app-fee-collect',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="max-w-4xl space-y-8">
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
      <h3 class="text-xl font-black tracking-tight">Find the student</h3>
      <p class="text-sm font-bold text-slate-400 mt-1 mb-5">Type a name, roll number, admission number, phone, or scan the voucher barcode.</p>
      <div class="relative">
        <input #box class="field" type="search" autofocus placeholder="Name, roll no, admission no, phone or voucher no" aria-label="Find student" [ngModel]="q()" (ngModelChange)="onSearch($event)">
        @if (hits().length) {
          <ul class="absolute z-20 mt-2 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-enterprise-lg overflow-hidden">
            @for (h of hits(); track h.id) {
              <li><button type="button" class="w-full text-left px-5 py-3 hover:bg-indigo-600/10 flex items-center justify-between gap-3" (click)="open(h.id)">
                <span class="text-sm font-black">{{ h.name }} <span class="text-slate-400 font-bold">· {{ h.class_name }}-{{ h.section_name }} · Roll {{ h.roll_no ?? '-' }}</span></span>
                <span class="text-xs font-black whitespace-nowrap" [class]="h.balance > 0 ? 'text-rose-500' : 'text-emerald-500'">{{ h.balance > 0 ? 'Due Rs ' + m(h.balance) : 'Clear' }}</span>
              </button></li>
            }
          </ul>
        }
      </div>
    </section>

    @if (done(); as r) {
      <section class="bg-emerald-500/10 p-8 md:p-10 rounded-[3rem] space-y-4">
        <h3 class="text-2xl font-black tracking-tight text-emerald-700 dark:text-emerald-300">Payment received</h3>
        <p class="text-sm font-bold">Receipt {{ r.receipt_no }} · Balance now: <b>{{ r.balance > 0 ? 'Rs ' + m(r.balance) : r.balance < 0 ? 'Advance Rs ' + m(-r.balance) : 'Nil (cleared)' }}</b></p>
        <div class="flex flex-wrap gap-3">
          <a [routerLink]="['/fee/receipt', r.id]" class="btn-primary">Print receipt</a>
          <button type="button" class="btn-ghost" (click)="reset()">Collect another</button>
        </div>
      </section>
    }

    @if (acct(); as a) {
      @if (!done()) {
        <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-8">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <h3 class="text-2xl font-black tracking-tight"><a [routerLink]="['/fee/student', a.student.id]" class="hover:text-indigo-500">{{ a.student.name }}</a></h3>
              <p class="text-sm font-bold text-slate-400 mt-1">S/O {{ a.student.father_name }} · {{ a.student.class_name }}-{{ a.student.section_name }} · Roll {{ a.student.roll_no ?? '-' }} · Admission {{ a.student.reg_no }}{{ a.student.phone ? ' · ' + a.student.phone : '' }}</p>
            </div>
            <div class="text-right">
              <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Balance</p>
              <p class="text-3xl font-black" [class]="a.totals.balance > 0 ? 'text-rose-500' : 'text-emerald-500'">{{ a.totals.balance < 0 ? 'Advance ' : '' }}Rs {{ m(abs(a.totals.balance)) }}</p>
            </div>
          </div>

          @if (open2().length) {
            <div>
              <span class="label !ml-0">Unpaid vouchers (payments clear the oldest first)</span>
              <div class="space-y-2">
                @for (v of open2(); track v.id) {
                  <label class="flex items-center justify-between gap-3 p-4 rounded-2xl cursor-pointer" [class]="voucherId() === v.id ? 'bg-indigo-600/10' : 'bg-slate-50 dark:bg-slate-950/50'">
                    <span class="flex items-center gap-3 text-sm font-bold"><input type="radio" name="vsel" class="accent-indigo-600" [checked]="voucherId() === v.id" (change)="voucherId.set(v.id)"> {{ v.voucher_no }} · {{ v.period_label }}
                      <span class="text-slate-400">due {{ d(v.due_date) }}</span>@if (v.due_date < paidOn()) { <span class="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 text-[10px] font-black">LATE</span> }</span>
                    <span class="text-sm font-black whitespace-nowrap">Rs {{ m(v.balance) }}</span>
                  </label>
                }
              </div>
            </div>
          }

          <form (ngSubmit)="receive()" class="space-y-6">
            @if (fine() > 0) {
              <label class="flex items-center gap-3 text-sm font-bold p-4 rounded-2xl bg-amber-500/10">
                <input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="addFine()" (ngModelChange)="toggleFine($event)" name="fine"> Add late fine of Rs {{ m(fine()) }} (paid after the due date)
              </label>
            }
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div><label class="label" for="am">Amount received (Rs)</label><input id="am" name="am" type="number" min="1" class="field" required [(ngModel)]="amount"></div>
              <div><label class="label" for="po">Date</label><input id="po" name="po" type="date" class="field" required [ngModel]="paidOn()" (ngModelChange)="paidOn.set($event)"></div>
              <div><label class="label" for="mo">Paid by</label>
                <select id="mo" name="mo" class="field" [(ngModel)]="mode"><option value="cash">Cash at college</option><option value="bank">Bank deposit</option><option value="online">Online transfer</option><option value="cheque">Cheque</option></select></div>
              <div><label class="label" for="rf">Bank slip / reference no. (optional)</label><input id="rf" name="rf" class="field" [(ngModel)]="reference"></div>
            </div>
            @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
            <div class="flex flex-wrap items-center gap-4">
              <button type="submit" class="btn-primary" [disabled]="busy()">Receive payment</button>
              @if (a.totals.balance > 0) { <button type="button" class="btn-ghost" (click)="amount = a.totals.balance + (addFine() ? fine() : 0)">Fill full balance</button> }
            </div>
          </form>
        </section>
      }
    }
  </div>
  `
})
export class FeeCollect {
  private api = inject(Api);
  private toast = inject(ToastService);
  m = money; d = fmtDate; abs = Math.abs;

  q = signal(''); hits = signal<StudentHit[]>([]);
  acct = signal<Acct | null>(null);
  voucherId = signal<number | null>(null);
  addFine = signal(false);
  done = signal<{ id: number; receipt_no: string; balance: number } | null>(null);
  busy = signal(false); error = signal('');
  paidOn = signal(today());
  amount: number | null = null; mode = 'cash'; reference = '';
  private timer: any;

  open2 = computed(() => (this.acct()?.vouchers ?? []).filter(v => v.status === 'open' && v.balance > 0).sort((a, b) => a.id - b.id));
  /** Fine of the newest overdue voucher, if the payment date is after its due date. */
  fine = computed(() => {
    const late = this.open2().filter(v => v.due_date < this.paidOn() && v.late_fine > 0);
    return late.length ? late[late.length - 1].late_fine : 0;
  });

  constructor() {
    const sid = inject(ActivatedRoute).snapshot.queryParamMap.get('studentId');
    if (sid) this.open(Number(sid));
  }

  onSearch(v: string) {
    this.q.set(v); clearTimeout(this.timer);
    if (!v.trim()) { this.hits.set([]); return; }
    this.timer = setTimeout(() => this.api.get<StudentHit[]>('/fee/students/search', { q: v }).subscribe(h => {
      // a scanned voucher number finds exactly one student: open it straight away
      if (h.length === 1 && /^\d{4}-\d{5}$/.test(v.trim())) this.open(h[0].id); else this.hits.set(h);
    }), 250);
  }

  open(id: number) {
    this.hits.set([]); this.q.set(''); this.done.set(null); this.error.set('');
    this.api.get<Acct>(`/fee/student/${id}`).subscribe({
      next: a => {
        this.acct.set(a);
        const first = this.open2()[0];
        this.voucherId.set(first?.id ?? null);
        this.addFine.set(this.fine() > 0);
        this.amount = Math.max(0, a.totals.balance) + (this.addFine() ? this.fine() : 0) || null;
      },
      error: e => this.error.set(errorText(e))
    });
  }
  toggleFine(v: boolean) { this.addFine.set(v); const a = this.acct(); if (a) this.amount = Math.max(0, a.totals.balance) + (v ? this.fine() : 0) || null; }
  reset() { this.acct.set(null); this.done.set(null); this.amount = null; this.reference = ''; }

  receive() {
    const a = this.acct(); if (!a) return;
    this.error.set(''); this.busy.set(true);
    this.api.post<{ id: number; receipt_no: string; balance: number }>('/fee/payments', {
      student_id: a.student.id, amount: this.amount, paid_on: this.paidOn(), mode: this.mode, reference: this.reference,
      voucher_id: this.voucherId(), add_fine: this.addFine() ? this.fine() : 0
    }).subscribe({
      next: r => { this.busy.set(false); this.done.set(r); this.toast.show('Payment received.'); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
}
