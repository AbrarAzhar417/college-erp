import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { HrLookup, LeaveRow, Staff, fmtDate, leaveBadge, today } from './hr';

@Component({
  selector: 'app-hr-leaves',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <form (ngSubmit)="apply()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="ls">Staff member</label><select id="ls" name="ls" class="field" required [(ngModel)]="f.staff_id"><option [ngValue]="null" disabled>Choose…</option>@for (s of staff(); track s.id) { <option [ngValue]="s.id">{{ s.name }} ({{ s.emp_no }})</option> }</select></div>
      <div><label class="label" for="lt">Leave type</label><select id="lt" name="lt" class="field" required [(ngModel)]="f.type_id"><option [ngValue]="null" disabled>Choose…</option>@for (t of look()?.leaveTypes ?? []; track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }</select></div>
      <div><label class="label" for="lf">From</label><input id="lf" name="lf" type="date" class="field" required [(ngModel)]="f.from_date"></div>
      <div><label class="label" for="ll">To</label><input id="ll" name="ll" type="date" class="field" required [(ngModel)]="f.to_date"></div>
      <div><label class="label" for="lr">Reason</label><input id="lr" name="lr" class="field" [(ngModel)]="f.reason"></div>
      <button class="btn-primary col-span-2 md:col-span-6" type="submit">Write leave application</button>
    </form>
    @if (cover(); as c) {
      <div role="alert" class="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-2">
        <p class="font-black text-rose-700 dark:text-rose-400">{{ c.teacher }} will be away, and {{ c.uncovered }} of {{ c.lessons }} lesson(s) have no replacement yet.</p>
        <p class="text-xs font-bold text-slate-500">@for (d of c.dates; track d.date) { <span class="mr-3">{{ d.date }}: {{ d.uncovered }} left</span> }</p>
        <a routerLink="/timetable/subs" class="btn-primary inline-block">Arrange replacements</a>
      </div>
    }
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="flex gap-2">@for (s of filters; track s.key) { <button type="button" (click)="status.set(s.key); load()" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest" [class]="status() === s.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ s.label }}</button> }</div>
    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Staff</th><th class="px-5 py-4">Leave</th><th class="px-5 py-4">Dates</th><th class="px-5 py-4">Days</th><th class="px-5 py-4">Balance</th><th class="px-5 py-4">Status</th><th class="px-5 py-4"></th></tr></thead>
        <tbody>@for (l of list(); track l.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60">
            <td class="px-5 py-3 font-black">{{ l.name }}<span class="block text-[11px] font-bold text-slate-400">{{ l.reason }}</span></td>
            <td class="px-5 py-3 font-bold">{{ l.type }}{{ l.paid ? '' : ' (unpaid)' }}</td><td class="px-5 py-3 whitespace-nowrap">{{ d(l.from_date) }}{{ l.to_date !== l.from_date ? ' to ' + d(l.to_date) : '' }}</td>
            <td class="px-5 py-3 font-black">{{ l.days }}</td><td class="px-5 py-3 text-xs font-bold" [class.text-rose-500]="l.balance_left !== null && l.balance_left !== undefined && l.balance_left < 0">{{ l.balance_left === null || l.balance_left === undefined ? 'no limit' : l.balance_left + ' left' }}</td>
            <td class="px-5 py-3"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black capitalize" [class]="lb(l.status)">{{ l.status }}</span></td>
            <td class="px-5 py-3 text-right whitespace-nowrap">
              @if (leader && l.status !== 'approved') { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="decide(l, 'approved')">Approve</button> }
              @if (leader && l.status !== 'rejected') { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="decide(l, 'rejected')">Reject</button> }
              @if (l.status === 'pending') { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-slate-400 hover:bg-slate-500/10" (click)="cancel(l)">Cancel</button> }</td></tr> }</tbody>
      </table>
      @if (!list().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No leaves here.</p> }
    </div>
    @if (!leader) { <p class="text-xs font-bold text-slate-400">Only the principal or director can approve or reject a leave. An approved leave goes onto the attendance register by itself.</p> }
  </div>
  `
})
export class HrLeaves {
  private api = inject(Api);
  private toast = inject(ToastService);
  leader = inject(AuthService).isLeadership();
  d = fmtDate; lb = leaveBadge;
  filters = [{ key: 'pending', label: 'Waiting' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }, { key: '', label: 'All' }];
  list = signal<LeaveRow[]>([]); staff = signal<Staff[]>([]); look = signal<HrLookup | null>(null); error = signal(''); status = signal('pending');
  f: { staff_id: number | null; type_id: number | null; from_date: string; to_date: string; reason: string } = { staff_id: null, type_id: null, from_date: today(), to_date: today(), reason: '' };
  constructor() {
    this.api.get<Staff[]>('/hr/staff').subscribe({ next: s => this.staff.set(s) });
    this.api.get<HrLookup>('/hr/lookup').subscribe({ next: l => { this.look.set(l); this.f.type_id = l.leaveTypes[0]?.id ?? null; } });
    this.load();
  }
  load() { this.api.get<LeaveRow[]>('/hr/leaves', { status: this.status() }).subscribe({ next: l => this.list.set(l), error: e => this.error.set(errorText(e)) }); }
  apply() {
    this.error.set('');
    this.api.post('/hr/leaves', this.f).subscribe({ next: () => { this.toast.show('Application written.'); this.f.reason = ''; this.status.set('pending'); this.load(); }, error: e => this.error.set(errorText(e)) });
  }
  cover = signal<{ teacher: string; uncovered: number; lessons: number; dates: { date: string; uncovered: number }[] } | null>(null);
  decide(l: LeaveRow, status: string) {
    this.cover.set(null);
    this.api.put<{ ok: boolean; cover: { teacher: string | null; uncovered: number; lessons: number; dates: { date: string; uncovered: number }[] } | null }>(`/hr/leaves/${l.id}/decision`, { status }).subscribe({
      next: r => { this.toast.show(status === 'approved' ? 'Approved. It is on the attendance register.' : 'Rejected.'); if (r.cover?.teacher && r.cover.uncovered > 0) this.cover.set({ teacher: r.cover.teacher, uncovered: r.cover.uncovered, lessons: r.cover.lessons, dates: r.cover.dates }); this.load(); },
      error: e => this.toast.show(errorText(e), 'error') });
  }
  cancel(l: LeaveRow) { if (!confirm('Cancel this application?')) return; this.api.delete(`/hr/leaves/${l.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
