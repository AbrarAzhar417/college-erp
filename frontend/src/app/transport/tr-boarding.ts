import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { RouteRow, today } from './tr';

interface Row { id: number; name: string; father_name: string; class_name: string; section_name: string; roll_no: number | null; stop: string | null; tr_mode: string; status: 'boarded' | 'absent' | null; absentFromSchool: boolean }

@Component({
  selector: 'app-tr-boarding',
  imports: [FormsModule],
  template: `
  <div class="space-y-6 max-w-4xl">
    <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="br">Bus route</label><select id="br" class="field" [ngModel]="routeId()" (ngModelChange)="setRoute($event)">@for (r of routes(); track r.id) { <option [ngValue]="r.id">{{ r.name }} ({{ r.bus || 'no bus' }})</option> }</select></div>
      <div><label class="label" for="bd">Date</label><input id="bd" type="date" class="field" [max]="todayIso" [ngModel]="date()" (ngModelChange)="date.set($event); load()"></div>
      <div><label class="label" for="bt">Trip</label><select id="bt" class="field" [ngModel]="trip()" (ngModelChange)="trip.set($event); load()"><option value="morning">Morning (to school)</option><option value="afternoon">Afternoon (back home)</option></select></div>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (rows().length) {
      <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <div class="flex flex-wrap items-center gap-3 mb-5">
          <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Boarded {{ count('boarded') }}</span><span class="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-500/10 text-rose-600">Did not come {{ count('absent') }}</span>
          @if (count(null)) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-500/10 text-slate-500">Not marked {{ count(null) }}</span> }
          @if (manage) { <button type="button" class="btn-ghost !py-2.5 ml-auto" (click)="allBoarded()">Everybody boarded</button> }
        </div>
        <ul class="space-y-2">@for (r of rows(); track r.id) {
          <li class="flex flex-wrap items-center gap-3 p-3 pl-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50" [class.ring-2]="!r.status" [class.ring-rose-300]="!r.status">
            <span class="flex-1 min-w-48"><span class="block text-sm font-black">{{ r.name }}</span><span class="block text-[11px] font-bold text-slate-400">{{ r.class_name }}-{{ r.section_name }} · Roll {{ r.roll_no ?? '-' }}{{ r.stop ? ' · ' + r.stop : '' }}@if (r.absentFromSchool) { <span class="ml-2 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300">Absent from school today</span> }</span></span>
            <span class="inline-flex gap-1" role="group">
              <button type="button" [disabled]="!manage" (click)="set(r, 'boarded')" [attr.aria-pressed]="r.status === 'boarded'" class="px-4 h-10 rounded-xl text-xs font-black disabled:opacity-60" [class]="r.status === 'boarded' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">Boarded</button>
              <button type="button" [disabled]="!manage" (click)="set(r, 'absent')" [attr.aria-pressed]="r.status === 'absent'" class="px-4 h-10 rounded-xl text-xs font-black disabled:opacity-60" [class]="r.status === 'absent' ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">Did not come</button></span>
          </li> }</ul>
        @if (manage) { <div class="sticky bottom-4 mt-6 flex justify-end"><button type="button" class="btn-primary shadow-enterprise-lg" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save attendance' }}</button></div> }
      </section>
    } @else if (loaded()) { <p class="text-sm font-bold text-slate-400">No students ride this bus on this trip.</p> }
  </div>
  `
})
export class TrBoarding {
  private api = inject(Api);
  private toast = inject(ToastService);
  manage = inject(AuthService).canWriteStudents();
  todayIso = today();
  routes = signal<RouteRow[]>([]); routeId = signal<number | null>(null); date = signal(today()); trip = signal('morning');
  rows = signal<Row[]>([]); error = signal(''); saving = signal(false); loaded = signal(false);
  count = (s: 'boarded' | 'absent' | null) => this.rows().filter(r => r.status === s).length;
  constructor() {
    const want = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('routeId'));
    this.api.get<RouteRow[]>('/transport/routes').subscribe(r => { this.routes.set(r); this.routeId.set(r.find(x => x.id === want)?.id ?? r[0]?.id ?? null); this.load(); });
  }
  setRoute(id: number) { this.routeId.set(id); this.load(); }
  load() {
    const r = this.routeId(); if (!r) return;
    this.api.get<{ students: Row[] }>('/transport/boarding', { routeId: r, date: this.date(), trip: this.trip() }).subscribe({ next: d => { this.rows.set(d.students); this.loaded.set(true); this.error.set(''); }, error: e => this.error.set(errorText(e)) });
  }
  set(r: Row, status: 'boarded' | 'absent') { this.rows.set(this.rows().map(x => (x.id === r.id ? { ...x, status } : x))); }
  allBoarded() { this.rows.set(this.rows().map(r => ({ ...r, status: r.absentFromSchool ? 'absent' : 'boarded' }) as Row)); }
  save() {
    const bad = this.rows().find(r => !r.status);
    if (bad) { this.toast.show(`Choose a status for ${bad.name}.`, 'error'); return; }
    this.saving.set(true);
    this.api.post<{ saved: number }>('/transport/boarding', { route_id: this.routeId(), date: this.date(), trip: this.trip(), entries: this.rows().map(r => ({ student_id: r.id, status: r.status })) }).subscribe({
      next: r => { this.saving.set(false); this.toast.show(`Saved for ${r.saved} students.`); }, error: e => { this.saving.set(false); this.toast.show(errorText(e), 'error'); } });
  }
}
