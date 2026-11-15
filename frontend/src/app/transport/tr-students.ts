import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { MODE_LABEL, Rider, money } from './tr';

interface Lk { id: number; name: string; bus: string | null; capacity: number | null; used: number; stops: { id: number; name: string }[] }

@Component({
  selector: 'app-tr-students',
  imports: [FormsModule],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
      <select class="field" aria-label="Route" [ngModel]="routeId()" (ngModelChange)="set('routeId', $event)"><option [ngValue]="null">All routes</option>@for (r of lookup(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }</select>
      <select class="field" aria-label="Class" [ngModel]="classId()" (ngModelChange)="set('classId', $event)"><option [ngValue]="null">All classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
      <input class="field col-span-2" type="search" placeholder="Search by name, roll no or admission no" aria-label="Search" [ngModel]="q()" (ngModelChange)="onSearch($event)">
    </div>
    <p class="text-sm font-bold text-slate-400">{{ rows().length }} students use the bus. Monthly fee Rs {{ m(total()) }}.</p>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Student</th><th class="px-5 py-4">Class</th><th class="px-5 py-4">Bus / route</th><th class="px-5 py-4">Stop</th><th class="px-5 py-4">Pick / drop</th><th class="px-5 py-4 text-right">Fee</th>@if (manage) { <th class="px-5 py-4"></th> }</tr></thead>
        <tbody>@for (s of rows(); track s.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60">
            <td class="px-5 py-3"><span class="font-black">{{ s.name }}</span><span class="block text-[11px] font-bold text-slate-400">S/O {{ s.father_name }} · {{ s.father_phone || s.phone || '' }}</span></td>
            <td class="px-5 py-3 whitespace-nowrap font-bold">{{ s.class_name }}-{{ s.section_name }}</td>
            @if (editId() === s.id) {
              <td class="px-5 py-3"><select class="field !py-2 !text-xs" [(ngModel)]="e.route" (ngModelChange)="e.stop = null" aria-label="Route"><option [ngValue]="null">Take off the bus</option>@for (r of lookup(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }</select></td>
              <td class="px-5 py-3"><select class="field !py-2 !text-xs" [(ngModel)]="e.stop" [disabled]="!e.route" aria-label="Stop"><option [ngValue]="null">No stop yet</option>@for (p of stopsOf(e.route); track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }</select></td>
              <td class="px-5 py-3"><select class="field !py-2 !text-xs" [(ngModel)]="e.mode" [disabled]="!e.route" aria-label="Mode"><option value="both">Pick and drop</option><option value="pickup">Pick up only</option><option value="drop">Drop only</option></select></td>
              <td class="px-5 py-3"></td><td class="px-5 py-3 text-right whitespace-nowrap"><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="saveRow(s)">Save</button><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-slate-500" (click)="editId.set(null)">Cancel</button></td>
            } @else {
              <td class="px-5 py-3 font-black whitespace-nowrap">{{ s.route }}<span class="block text-[11px] font-bold text-slate-400">{{ s.bus }}</span></td><td class="px-5 py-3 whitespace-nowrap">{{ s.stop || '-' }}</td><td class="px-5 py-3 whitespace-nowrap text-xs font-bold">{{ ml[s.tr_mode ?? 'both'] }}</td>
              <td class="px-5 py-3 text-right font-bold whitespace-nowrap">Rs {{ m(s.fee) }}</td>@if (manage) { <td class="px-5 py-3 text-right"><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="start(s)">Change</button></td> }
            }
          </tr> }</tbody>
      </table>
      @if (!rows().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No students found. A student gets a bus in the admission form, or from a route's page.</p> }
    </div>
  </div>
  `
})
export class TrStudents {
  private api = inject(Api);
  private toast = inject(ToastService);
  manage = inject(AuthService).canWriteStudents();
  m = money; ml = MODE_LABEL;
  lookup = signal<Lk[]>([]); classes = signal<ClassInfo[]>([]); rows = signal<Rider[]>([]); error = signal('');
  routeId = signal<number | null>(null); classId = signal<number | null>(null); q = signal('');
  editId = signal<number | null>(null); e = { route: null as number | null, stop: null as number | null, mode: 'both' };
  private timer: any;
  total = () => this.rows().reduce((a, r) => a + r.fee, 0);
  stopsOf = (rid: number | null) => this.lookup().find(r => r.id === rid)?.stops ?? [];
  constructor() { this.api.get<Lk[]>('/transport/lookup').subscribe(l => this.lookup.set(l)); this.api.get<ClassInfo[]>('/classes').subscribe(c => this.classes.set(c)); this.load(); }
  set(k: 'routeId' | 'classId', v: any) { (this[k] as any).set(v); this.load(); }
  onSearch(v: string) { this.q.set(v); clearTimeout(this.timer); this.timer = setTimeout(() => this.load(), 300); }
  load() { this.api.get<Rider[]>('/transport/students', { routeId: this.routeId() ?? undefined, classId: this.classId() ?? undefined, q: this.q() }).subscribe({ next: r => this.rows.set(r), error: e => this.error.set(errorText(e)) }); }
  start(s: Rider) { this.e = { route: s.tr_route_id, stop: s.tr_stop_id, mode: s.tr_mode ?? 'both' }; this.editId.set(s.id); }
  saveRow(s: Rider) {
    this.api.post<{ fee: number; warning: string | null }>('/transport/assign', { student_id: s.id, route_id: this.e.route, stop_id: this.e.stop, mode: this.e.mode }).subscribe({
      next: r => { this.toast.show(r.warning ?? (this.e.route ? `Saved. Fee Rs ${money(r.fee)} a month.` : 'Taken off the bus.'), r.warning ? 'error' : 'ok'); this.editId.set(null); this.load(); }, error: x => this.toast.show(errorText(x), 'error') });
  }
}
