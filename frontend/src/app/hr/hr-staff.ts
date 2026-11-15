import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { EMP_LABEL, STAFF_TYPES, Staff, TYPE_LABEL, fmtDate, initials, money } from './hr';

@Component({
  selector: 'app-hr-staff-list',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="sq">Search</label><input id="sq" class="field" placeholder="Name, number, CNIC or phone" [ngModel]="q()" (ngModelChange)="q.set($event); load()"></div>
      <div><label class="label" for="st">Type</label><select id="st" class="field" [ngModel]="type()" (ngModelChange)="type.set($event); load()"><option value="">All types</option>@for (t of types; track t.key) { <option [value]="t.key">{{ t.label }}</option> }</select></div>
      <div><label class="label" for="ss">Show</label><select id="ss" class="field" [ngModel]="status()" (ngModelChange)="status.set($event); load()"><option value="active">Working now</option><option value="former">Left / resigned</option><option value="all">Everyone</option></select></div>
      <a class="btn-primary text-center" routerLink="/hr/staff/new">Add staff</a>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="btn-ghost" (click)="importOld()">Bring in existing teachers and drivers</button>
      <a class="btn-ghost" routerLink="/hr/print/staff" [queryParams]="{ status: status() }">Print list</a>
      <span class="text-xs font-bold text-slate-400">{{ list().length }} people</span>
    </div>
    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Staff</th><th class="px-5 py-4">Type</th><th class="px-5 py-4">Phone</th><th class="px-5 py-4">Joined</th><th class="px-5 py-4">Employment</th>@if (pay) { <th class="px-5 py-4 text-right">Salary</th> }<th class="px-5 py-4"></th></tr></thead>
        <tbody>@for (s of list(); track s.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60" [class.opacity-60]="s.status !== 'active'">
            <td class="px-5 py-3"><a [routerLink]="['/hr/staff', s.id]" class="flex items-center gap-3">
              @if (s.photo) { <img [src]="s.photo" alt="" class="w-10 h-10 rounded-full object-cover"> } @else { <span class="w-10 h-10 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-black">{{ ini(s.name) }}</span> }
              <span><span class="font-black block">{{ s.name }}</span><span class="text-[11px] font-bold text-slate-400">{{ s.emp_no }} · {{ s.designation || '-' }}</span></span></a></td>
            <td class="px-5 py-3 font-bold">{{ tl[s.staff_type] }}</td><td class="px-5 py-3 whitespace-nowrap">{{ s.phone || '-' }}</td><td class="px-5 py-3 whitespace-nowrap">{{ s.joining_date ? d(s.joining_date) : '-' }}</td>
            <td class="px-5 py-3">{{ el[s.employment] }}@if (s.status !== 'active') { <span class="block text-[11px] font-black text-rose-500 capitalize">{{ s.status }} {{ s.left_date ? d(s.left_date) : '' }}</span> }</td>
            @if (pay) { <td class="px-5 py-3 text-right font-black whitespace-nowrap">{{ gross(s) ? 'Rs ' + m(gross(s)) : '-' }}</td> }
            <td class="px-5 py-3 text-right"><a [routerLink]="['/hr/staff', s.id]" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10">Open</a></td></tr> }</tbody>
      </table>
      @if (!list().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No staff found.</p> }
    </div>
  </div>
  `
})
export class HrStaffList {
  private api = inject(Api);
  private toast = inject(ToastService);
  pay = inject(AuthService).canHrPay();
  types = STAFF_TYPES; tl = TYPE_LABEL; el = EMP_LABEL; d = fmtDate; m = money; ini = initials;
  list = signal<Staff[]>([]); error = signal(''); q = signal(''); type = signal(''); status = signal('active');
  gross = (s: Staff) => (s.basic_salary ?? 0) + (s.house_allow ?? 0) + (s.medical_allow ?? 0) + (s.conveyance_allow ?? 0) + (s.other_allow ?? 0);
  constructor() { this.load(); }
  load() { this.api.get<Staff[]>('/hr/staff', { q: this.q(), type: this.type(), status: this.status() }).subscribe({ next: l => this.list.set(l), error: e => this.error.set(errorText(e)) }); }
  importOld() {
    this.api.post<{ teachers: number; drivers: number }>('/hr/import-existing', {}).subscribe({
      next: r => { this.toast.show(r.teachers + r.drivers ? `Brought in ${r.teachers} teachers and ${r.drivers} drivers or conductors.` : 'Everyone is already in HR.'); this.load(); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
