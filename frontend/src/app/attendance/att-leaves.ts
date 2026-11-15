import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { fmtDate, today } from './att';

interface Leave { id: number; student_id: number; name: string; father_name: string; roll_no: number | null; class_name: string; section_name: string; from_date: string; to_date: string; kind: string; reason: string | null; status: 'pending' | 'approved' | 'rejected' }
interface Hit { id: number; name: string; father_name: string; roll_no: number | null; class_name: string; section_name: string }

@Component({
  selector: 'app-att-leaves',
  imports: [FormsModule],
  template: `
  <div class="space-y-8">
    <form (ngSubmit)="add()" class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5 max-w-4xl">
      <div><h3 class="text-xl font-black tracking-tight">Record a leave</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Approved leave days are marked L in the register on their own, and they do not count as absent.</p></div>
      <div class="relative max-w-md">
        @if (student(); as st) {
          <div class="flex items-center justify-between gap-3 p-4 rounded-2xl bg-indigo-600/10"><span class="text-sm font-black">{{ st.name }} <span class="text-slate-400 font-bold">· {{ st.class_name }}-{{ st.section_name }}</span></span><button type="button" class="text-xs font-black text-rose-500" (click)="student.set(null)">Change</button></div>
        } @else {
          <label class="label" for="ls">Student</label>
          <input id="ls" class="field" type="search" placeholder="Name, roll no or admission no" [ngModel]="q()" (ngModelChange)="onSearch($event)" name="ls">
          @if (hits().length) {
            <ul class="absolute z-20 mt-2 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-enterprise-lg overflow-hidden">
              @for (h of hits(); track h.id) { <li><button type="button" class="w-full text-left px-5 py-3 text-sm font-bold hover:bg-indigo-600/10" (click)="pick(h)">{{ h.name }} <span class="text-slate-400">· {{ h.class_name }}-{{ h.section_name }} · Roll {{ h.roll_no ?? '-' }}</span></button></li> }
            </ul>
          }
        }
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-5">
        <div><label class="label" for="lf">From</label><input id="lf" name="lf" type="date" class="field" required [(ngModel)]="f.from_date"></div>
        <div><label class="label" for="lt">To</label><input id="lt" name="lt" type="date" class="field" required [(ngModel)]="f.to_date"></div>
        <div><label class="label" for="lk">Kind</label><select id="lk" name="lk" class="field" [(ngModel)]="f.kind"><option value="sick">Sick</option><option value="casual">Casual</option><option value="family">Family</option><option value="other">Other</option></select></div>
        <div><label class="label" for="lr">Reason</label><input id="lr" name="lr" class="field" [(ngModel)]="f.reason"></div>
      </div>
      <label class="flex items-center gap-3 text-sm font-bold"><input type="checkbox" class="w-5 h-5 accent-indigo-600" name="lp" [(ngModel)]="pending"> Keep it pending (approve later)</label>
      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
      <button class="btn-primary" type="submit">Save leave</button>
    </form>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        @for (s of filters; track s.key) { <button type="button" (click)="setFilter(s.key)" class="px-4 py-2.5 rounded-xl text-xs font-black transition-all" [class]="filter() === s.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ s.label }}</button> }
      </div>
      <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-6 py-4">Student</th><th class="px-6 py-4">Dates</th><th class="px-6 py-4">Reason</th><th class="px-6 py-4">Status</th><th class="px-6 py-4 text-right">Actions</th></tr></thead>
          <tbody>
            @for (l of leaves(); track l.id) {
              <tr class="border-b border-slate-50 dark:border-slate-800/60">
                <td class="px-6 py-3 whitespace-nowrap"><span class="font-black">{{ l.name }}</span><p class="text-[11px] font-bold text-slate-400">{{ l.class_name }}-{{ l.section_name }} · Roll {{ l.roll_no ?? '-' }}</p></td>
                <td class="px-6 py-3 whitespace-nowrap font-bold">{{ d(l.from_date) }}{{ l.to_date !== l.from_date ? ' to ' + d(l.to_date) : '' }}</td>
                <td class="px-6 py-3 text-slate-500"><span class="capitalize font-bold">{{ l.kind }}</span>{{ l.reason ? ': ' + l.reason : '' }}</td>
                <td class="px-6 py-3"><span class="px-3 py-1.5 rounded-lg text-[11px] font-black capitalize" [class]="l.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' : l.status === 'pending' ? 'bg-amber-500/10 text-amber-600' : 'bg-rose-500/10 text-rose-600'">{{ l.status }}</span></td>
                <td class="px-6 py-3 text-right whitespace-nowrap">
                  @if (l.status !== 'approved') { <button type="button" class="px-3 py-2 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="decide(l, 'approved')">Approve</button> }
                  @if (l.status === 'pending') { <button type="button" class="px-3 py-2 rounded-xl text-xs font-black text-amber-600 hover:bg-amber-500/10" (click)="decide(l, 'rejected')">Reject</button> }
                  <button type="button" class="px-3 py-2 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="remove(l)">Delete</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!leaves().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No leaves here.</p> }
      </div>
    </section>
  </div>
  `
})
export class AttLeaves {
  private api = inject(Api);
  private toast = inject(ToastService);
  d = fmtDate;
  filters = [{ key: '', label: 'All' }, { key: 'pending', label: 'Pending' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }];
  filter = signal('');
  leaves = signal<Leave[]>([]);
  student = signal<Hit | null>(null); q = signal(''); hits = signal<Hit[]>([]);
  f = { from_date: today(), to_date: today(), kind: 'sick', reason: '' };
  pending = false; error = signal('');
  private timer: any;

  constructor() { this.load(); }
  load() { this.api.get<Leave[]>('/attendance/leaves', { status: this.filter() }).subscribe(l => this.leaves.set(l)); }
  setFilter(k: string) { this.filter.set(k); this.load(); }
  onSearch(v: string) { this.q.set(v); clearTimeout(this.timer); if (!v.trim()) { this.hits.set([]); return; } this.timer = setTimeout(() => this.api.get<Hit[]>('/attendance/students/search', { q: v }).subscribe(h => this.hits.set(h)), 250); }
  pick(h: Hit) { this.student.set(h); this.hits.set([]); this.q.set(''); }

  add() {
    this.error.set('');
    if (!this.student()) { this.error.set('Search and choose a student first.'); return; }
    this.api.post<{ marked: number }>('/attendance/leaves', { ...this.f, student_id: this.student()!.id, status: this.pending ? 'pending' : 'approved' }).subscribe({
      next: r => { this.toast.show(this.pending ? 'Leave saved as pending.' : `Leave saved. ${r.marked} register day(s) marked L.`); this.student.set(null); this.f.reason = ''; this.load(); },
      error: e => this.error.set(errorText(e))
    });
  }
  decide(l: Leave, status: string) { this.api.put<{ marked: number }>(`/attendance/leaves/${l.id}/status`, { status }).subscribe({ next: r => { this.toast.show(status === 'approved' ? `Approved. ${r.marked} register day(s) marked L.` : 'Rejected.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  remove(l: Leave) { if (!confirm(`Delete this leave of ${l.name}? Its L marks are removed from the register.`)) return; this.api.delete(`/attendance/leaves/${l.id}`).subscribe({ next: () => { this.toast.show('Leave deleted.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
