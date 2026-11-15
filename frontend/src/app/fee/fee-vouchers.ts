import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Printer, Search } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { AuthService } from '../core/auth';
import { ClassInfo } from '../core/models';
import { FeePrintService, VoucherRow, fmtDate, money } from './fee';

interface Page { items: VoucherRow[]; total: number; page: number; limit: number; totals: { net: number; balance: number }; allIds: number[] }

@Component({
  selector: 'app-fee-vouchers',
  imports: [FormsModule, RouterLink, LucideAngularModule],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-6 gap-4">
      <div class="relative col-span-2">
        <lucide-icon [img]="searchIcon" [size]="18" class="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input class="field !pl-12" type="search" placeholder="Voucher no, name, roll no" aria-label="Search vouchers" [ngModel]="q()" (ngModelChange)="onSearch($event)">
      </div>
      <input type="month" class="field" aria-label="Fee month" [ngModel]="period()" (ngModelChange)="set('period', $event)">
      <select class="field" aria-label="Class" [ngModel]="classId()" (ngModelChange)="setClass($event)">
        <option [ngValue]="null">All classes</option>
        @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
      </select>
      <select class="field" aria-label="Section" [ngModel]="sectionId()" (ngModelChange)="set('sectionId', $event)" [disabled]="!classId()">
        <option [ngValue]="null">All sections</option>
        @for (s of sections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }
      </select>
      <select class="field" aria-label="Status" [ngModel]="status()" (ngModelChange)="set('status', $event)">
        <option value="">Any status</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="cancelled">Cancelled</option>
      </select>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-4">
      <p class="text-sm font-bold text-slate-400">{{ data()?.total ?? 0 }} vouchers · Billed Rs {{ m(data()?.totals?.net ?? 0) }} · Still unpaid Rs {{ m(data()?.totals?.balance ?? 0) }}</p>
      <button type="button" class="btn-primary" [disabled]="!data()?.allIds?.length" (click)="printMany(data()!.allIds)"><lucide-icon [img]="printIcon" [size]="16" /> Print these {{ data()?.total ?? 0 }}</button>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
            <th class="px-5 py-5">Voucher</th><th class="px-5 py-5">Student</th><th class="px-5 py-5">Class</th><th class="px-5 py-5">Period</th>
            <th class="px-5 py-5 text-right">Payable</th><th class="px-5 py-5 text-right">Still due</th><th class="px-5 py-5">Status</th><th class="px-5 py-5 text-right">Actions</th></tr></thead>
          <tbody>
            @for (v of data()?.items ?? []; track v.id) {
              <tr class="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                <td class="px-5 py-4 font-bold text-slate-500 whitespace-nowrap">{{ v.voucher_no }}</td>
                <td class="px-5 py-4 whitespace-nowrap"><a [routerLink]="['/fee/student', v.student_id]" class="font-black hover:text-indigo-500">{{ v.name }}</a><p class="text-[11px] font-bold text-slate-400">{{ v.father_name }} · Roll {{ v.roll_no ?? '-' }}</p></td>
                <td class="px-5 py-4 font-black whitespace-nowrap">{{ v.class_name }}-{{ v.section_name }}</td>
                <td class="px-5 py-4 whitespace-nowrap">{{ v.period_label }}<p class="text-[11px] font-bold text-slate-400">Due {{ d(v.due_date) }}</p></td>
                <td class="px-5 py-4 text-right font-black whitespace-nowrap">Rs {{ m(v.payable) }}</td>
                <td class="px-5 py-4 text-right font-black whitespace-nowrap">Rs {{ m(v.balance) }}</td>
                <td class="px-5 py-4 whitespace-nowrap">
                  <span class="px-3 py-1.5 rounded-lg text-[11px] font-black" [class]="badge(v)">{{ stateText(v) }}</span>
                </td>
                <td class="px-5 py-4 text-right whitespace-nowrap">
                  <button type="button" class="px-3 py-2 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="printMany([v.id])">Print</button>
                  @if (v.state !== 'paid' && v.state !== 'cancelled') { <a [routerLink]="['/fee/collect']" [queryParams]="{ studentId: v.student_id }" class="px-3 py-2 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10">Collect</a> }
                  @if (auth.user()?.role !== 'admin' && v.state !== 'cancelled') { <button type="button" class="px-3 py-2 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="cancel(v)">Cancel</button> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (data() && !data()!.items.length) { <p class="p-10 text-center text-sm font-bold text-slate-400">No vouchers match these filters.</p> }
      <div class="flex items-center justify-between gap-4 p-5 border-t border-slate-100 dark:border-slate-800">
        <button type="button" class="btn-ghost" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span class="text-xs font-bold text-slate-400">Page {{ page() }} of {{ pages() }}</span>
        <button type="button" class="btn-ghost" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next</button>
      </div>
    </div>
  </div>
  `
})
export class FeeVouchers {
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  private store = inject(FeePrintService);
  auth = inject(AuthService);
  m = money; d = fmtDate; printIcon = Printer; searchIcon = Search;

  classes = signal<ClassInfo[]>([]);
  period = signal(''); classId = signal<number | null>(null); sectionId = signal<number | null>(null); status = signal(''); q = signal('');
  page = signal(1);
  data = signal<Page | null>(null);
  error = signal('');
  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  pages = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / (this.data()?.limit ?? 25))));
  private timer: any;

  constructor() {
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    if (qp.get('period')) this.period.set(qp.get('period')!);
    this.api.get<ClassInfo[]>('/classes').subscribe(c => this.classes.set(c));
    this.load();
  }

  load() {
    this.api.get<Page>('/fee/vouchers', { period: this.period(), classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined, status: this.status(), q: this.q(), page: this.page() })
      .subscribe({ next: d => { this.data.set(d); this.error.set(''); }, error: e => this.error.set(errorText(e)) });
  }
  set(k: 'period' | 'sectionId' | 'status', v: any) { (this[k] as any).set(v); this.page.set(1); this.load(); }
  setClass(id: number | null) { this.classId.set(id); this.sectionId.set(null); this.page.set(1); this.load(); }
  onSearch(v: string) { this.q.set(v); clearTimeout(this.timer); this.timer = setTimeout(() => { this.page.set(1); this.load(); }, 300); }
  go(p: number) { this.page.set(p); this.load(); }

  printMany(ids: number[]) { this.store.set(ids); this.router.navigateByUrl('/fee/print'); }

  stateText(v: VoucherRow) { return v.state === 'paid' ? 'Paid' : v.state === 'cancelled' ? 'Cancelled' : v.overdue ? 'Overdue' : v.state === 'partial' ? 'Part paid' : 'Unpaid'; }
  badge(v: VoucherRow) {
    if (v.state === 'paid') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    if (v.state === 'cancelled') return 'bg-slate-500/10 text-slate-500';
    if (v.overdue) return 'bg-rose-500/10 text-rose-600 dark:text-rose-400';
    return v.state === 'partial' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
  }

  cancel(v: VoucherRow) {
    if (!confirm(`Cancel voucher ${v.voucher_no} for ${v.name}? Its charge is removed from the student's account.`)) return;
    this.api.post(`/fee/vouchers/${v.id}/cancel`, {}).subscribe({ next: () => { this.toast.show('Voucher cancelled.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
}
