import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ATT_LABEL, Balance, EMP_LABEL, LeaveRow, SLIP_STATUS, Slip, Staff, TYPE_LABEL, attBox, fmtDate, initials, leaveBadge, money, monthLabel, slipBadge, today } from './hr';

interface Mine { staff: Staff | null; balances?: Balance[]; month?: Record<string, number | string>; attendance?: { date: string; status: string; time_in: string | null; time_out: string | null }[]; leaves?: LeaveRow[]; leaveTypes?: { id: number; name: string; paid: number }[]; payslips?: Slip[] }

@Component({
  selector: 'app-hr-mine',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (x(); as v) {
      @if (!v.staff) { <p class="p-8 rounded-[2rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-center font-bold text-slate-400">Your login is not linked to a staff record yet. Please ask the office.</p> }
      @else {
        <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex items-center gap-5">
          @if (v.staff.photo) { <img [src]="v.staff.photo" alt="" class="w-20 h-20 rounded-full object-cover"> } @else { <span class="w-20 h-20 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xl font-black">{{ ini(v.staff.name) }}</span> }
          <div><h3 class="text-2xl font-black tracking-tight">{{ v.staff.name }}</h3><p class="text-sm font-bold text-slate-400">{{ v.staff.emp_no }} · {{ tl[v.staff.staff_type] }} · {{ v.staff.designation }} · {{ el[v.staff.employment] }}</p>
            <p class="text-sm font-bold text-slate-400">Joined {{ v.staff.joining_date ? fd(v.staff.joining_date) : '-' }}{{ v.staff.phone ? ' · ' + v.staff.phone : '' }}</p></div>
        </div>
        <div class="grid lg:grid-cols-2 gap-6">
          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
            <h3 class="text-lg font-black tracking-tight">My attendance this month</h3>
            <div class="flex flex-wrap gap-2">@for (k of keys; track k) { <span class="px-3 py-1.5 rounded-xl text-xs font-black" [class]="box(k)">{{ al[k] }}: {{ v.month?.[k] }}</span> }</div>
            <div class="flex flex-wrap gap-1.5">@for (a of v.attendance ?? []; track a.date) { <span class="px-2 py-1 rounded-lg text-[11px] font-black" [class]="box(a.status)" [title]="a.time_in ?? ''">{{ a.date.slice(8) }} {{ al[a.status] }}</span> } @empty { <p class="text-sm font-bold text-slate-400">Nothing marked yet this month.</p> }</div>
            <h3 class="text-lg font-black tracking-tight pt-2">My leave balance</h3>
            @for (b of v.balances ?? []; track b.type_id) { <p class="flex justify-between text-sm font-bold py-1 border-b border-slate-100 dark:border-slate-800"><span>{{ b.name }}</span><span>{{ b.quota ? b.left + ' of ' + b.quota + ' left' : b.used + ' taken' }}</span></p> }
          </section>
          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
            <h3 class="text-lg font-black tracking-tight">Apply for leave</h3>
            <form (ngSubmit)="apply()" class="grid grid-cols-2 gap-3 items-end">
              <div class="col-span-2"><label class="label" for="lt">Kind of leave</label><select id="lt" name="lt" class="field" [(ngModel)]="f.type_id">@for (t of v.leaveTypes ?? []; track t.id) { <option [ngValue]="t.id">{{ t.name }}{{ t.paid ? '' : ' (unpaid)' }}</option> }</select></div>
              <div><label class="label" for="lf">From</label><input id="lf" name="lf" type="date" class="field" required [(ngModel)]="f.from_date"></div>
              <div><label class="label" for="ll">To</label><input id="ll" name="ll" type="date" class="field" required [(ngModel)]="f.to_date"></div>
              <div class="col-span-2"><label class="label" for="lr">Reason</label><input id="lr" name="lr" class="field" [(ngModel)]="f.reason"></div>
              <button class="btn-primary col-span-2" type="submit">Send to the principal</button>
            </form>
            @for (l of v.leaves ?? []; track l.id) { <p class="text-sm font-bold flex justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800"><span>{{ l.type }} · {{ fd(l.from_date) }}{{ l.to_date !== l.from_date ? ' to ' + fd(l.to_date) : '' }} ({{ l.days }})</span>
              <span class="flex items-center gap-2"><span class="px-2 py-0.5 rounded-lg text-[11px] font-black capitalize" [class]="lb(l.status)">{{ l.status }}</span>@if (l.status === 'pending') { <button type="button" class="text-xs font-black text-rose-500" (click)="cancel(l)">Cancel</button> }</span></p> }
          </section>
        </div>
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
          <h3 class="text-lg font-black tracking-tight">My payslips</h3>
          @for (s of v.payslips ?? []; track s.id) { <div class="flex flex-wrap items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800 text-sm font-bold"><span>{{ ml(s.month) }} · Net Rs {{ m(s.net) }}{{ s.cut_amount ? ' (cut Rs ' + m(s.cut_amount) + ')' : '' }}</span>
            <span class="flex items-center gap-2"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="sb(s.status)">{{ ss[s.status] }}</span><a class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" routerLink="/hr/print/slips" [queryParams]="{ month: s.month, self: 1 }">Print</a></span></div> }
          @if (!(v.payslips ?? []).length) { <p class="text-sm font-bold text-slate-400">No payslip yet. It appears here once the principal approves the month's salary.</p> }
        </section>
      }
    }
  </div>
  `
})
export class HrMine {
  private api = inject(Api);
  private toast = inject(ToastService);
  keys = ['P', 'LT', 'A', 'L', 'HD']; al = ATT_LABEL; tl = TYPE_LABEL; el = EMP_LABEL; ss = SLIP_STATUS;
  fd = fmtDate; m = money; ml = monthLabel; ini = initials; lb = leaveBadge; sb = slipBadge;
  x = signal<Mine | null>(null); error = signal('');
  f: { type_id: number | null; from_date: string; to_date: string; reason: string } = { type_id: null, from_date: today(), to_date: today(), reason: '' };
  constructor() { this.load(); }
  box(k: string) { return attBox(k); }
  load() { this.api.get<Mine>('/hr/me').subscribe({ next: v => { this.x.set(v); if (this.f.type_id === null) this.f.type_id = v.leaveTypes?.[0]?.id ?? null; }, error: e => this.error.set(errorText(e)) }); }
  apply() { this.error.set(''); this.api.post('/hr/me/leaves', this.f).subscribe({ next: () => { this.toast.show('Sent to the principal.'); this.f.reason = ''; this.load(); }, error: e => this.error.set(errorText(e)) }); }
  cancel(l: LeaveRow) { if (!confirm('Cancel this application?')) return; this.api.delete(`/hr/me/leaves/${l.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
