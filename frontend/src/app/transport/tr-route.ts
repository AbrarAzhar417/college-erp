import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { MODE_LABEL, MODE_SHORT, RouteDetail, RouteRow, Rider, Stop, docClass, docText, money, seatClass } from './tr';

interface Hit { id: number; name: string; father_name: string; class_name: string; section_name: string; roll_no: number | null; route: string | null }

@Component({
  selector: 'app-tr-route',
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  template: `
  @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

  <ng-template #riders let-list>
    <div class="overflow-x-auto"><table class="w-full text-left text-sm">
      <tbody>@for (s of list; track s.id) {
        <tr class="border-t border-slate-100 dark:border-slate-800">
          <td class="py-2.5 pr-3"><span class="font-black">{{ s.name }}</span><span class="block text-[11px] font-bold text-slate-400">S/O {{ s.father_name }}</span></td>
          <td class="py-2.5 pr-3 whitespace-nowrap font-bold">{{ s.class_name }}-{{ s.section_name }}<span class="block text-[11px] text-slate-400">Roll {{ s.roll_no ?? '-' }}</span></td>
          <td class="py-2.5 pr-3 whitespace-nowrap text-xs font-bold text-slate-500">{{ s.father_phone || s.phone || '-' }}</td>
          <td class="py-2.5 pr-3"><span class="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] font-black whitespace-nowrap">{{ ms(s.tr_mode ?? 'both') }}</span></td>
          <td class="py-2.5 pr-3 text-right whitespace-nowrap font-bold">Rs {{ m(s.fee) }}</td>
          <td class="py-2.5 pr-3 text-right whitespace-nowrap text-xs font-black" [class]="s.dues ? 'text-rose-500' : 'text-emerald-600'">{{ s.dues ? 'Due Rs ' + m(s.dues) : 'Clear' }}</td>
          @if (manage) { <td class="py-2.5 text-right whitespace-nowrap">
            <select class="field !py-1.5 !text-xs !w-36 !inline-block" [ngModel]="s.tr_stop_id" (ngModelChange)="setStop(s, $event)" [attr.aria-label]="'Stop of ' + s.name"><option [ngValue]="null">No stop yet</option>@for (p of d()!.stops; track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }</select>
            <button type="button" class="ml-1 px-2.5 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="remove(s)">Remove</button></td> }
        </tr> }</tbody>
    </table></div>
  </ng-template>

  @if (d(); as x) {
  <div class="space-y-6">
    <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <a routerLink="/transport" class="text-xs font-black text-indigo-600 dark:text-indigo-300">All routes</a>
          <h3 class="text-3xl font-black tracking-tighter mt-1">{{ x.route.name }}</h3>
          <p class="text-sm font-bold text-slate-400 mt-1">{{ x.route.area }}{{ x.route.morning_time ? ' · morning ' + x.route.morning_time : '' }}{{ x.route.afternoon_time ? ' · afternoon ' + x.route.afternoon_time : '' }}</p>
          @if (x.vehicle; as v) {
            <p class="mt-3 text-sm font-bold"><span class="font-black">{{ v.number }}</span> {{ v.reg_no ? '(' + v.reg_no + ')' : '' }} · {{ v.capacity }} seats · Driver <b>{{ v.driver || 'not set' }}</b>{{ v.driver_phone ? ' ' + v.driver_phone : '' }}@if (v.conductor) { · Conductor <b>{{ v.conductor }}</b>{{ v.conductor_phone ? ' ' + v.conductor_phone : '' }} }</p>
            <p class="mt-2 flex flex-wrap gap-1.5"><span class="px-2 py-0.5 rounded-md text-[10px] font-black" [class]="dc(v.fitness_expiry)">Fitness {{ dt(v.fitness_expiry) }}</span><span class="px-2 py-0.5 rounded-md text-[10px] font-black" [class]="dc(v.permit_expiry)">Permit {{ dt(v.permit_expiry) }}</span><span class="px-2 py-0.5 rounded-md text-[10px] font-black" [class]="dc(v.insurance_expiry)">Insurance {{ dt(v.insurance_expiry) }}</span></p>
          } @else { <p class="mt-3 text-sm font-black text-rose-500">This route has no bus. Choose one in the Routes tab.</p> }
        </div>
        <div class="flex flex-wrap gap-2 lg:justify-end">
          <a [routerLink]="['/transport/print/route']" [queryParams]="{ routeId: x.route.id }" class="btn-primary !py-3">Print student list</a>
          <a [routerLink]="['/transport/print/passes']" [queryParams]="{ routeId: x.route.id }" class="btn-ghost !py-3">Print bus passes</a>
          <a [routerLink]="['/transport/boarding']" [queryParams]="{ routeId: x.route.id }" class="btn-ghost !py-3">Take attendance</a>
          @if (manage) { <a [routerLink]="['/transport/routes']" [queryParams]="{ edit: x.route.id }" class="btn-ghost !py-3">Edit route</a> }
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black">{{ x.totals.students }}</p><p class="text-xs font-bold text-slate-400">Students</p></div>
        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black" [class]="x.totals.left < 0 ? 'text-rose-500' : ''">{{ x.totals.capacity ? x.totals.left : '-' }}</p><p class="text-xs font-bold text-slate-400">{{ x.totals.left < 0 ? 'Seats short' : 'Seats left' }}</p></div>
        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black text-emerald-600">Rs {{ m(x.totals.monthly) }}</p><p class="text-xs font-bold text-slate-400">Fee every month</p></div>
        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50"><p class="text-2xl font-black" [class]="x.totals.dues ? 'text-rose-500' : 'text-emerald-600'">Rs {{ m(x.totals.dues) }}</p><p class="text-xs font-bold text-slate-400">Unpaid fee of these students</p></div>
      </div>
      <div class="h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full" [class]="sc(x.totals.students, x.totals.capacity)" [style.width.%]="x.totals.capacity ? min(100, (x.totals.students / x.totals.capacity) * 100) : 0"></div></div>
    </section>

    @for (p of x.stops; track p.id) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
        <div class="flex flex-wrap items-baseline justify-between gap-2 mb-2"><h4 class="text-lg font-black tracking-tight">{{ p.name }} <span class="text-slate-400 font-bold text-sm">· {{ p.students.length }} students</span></h4>
          <p class="text-xs font-bold text-slate-400">Pick up {{ p.pickup_time || '-' }} · Drop {{ p.drop_time || '-' }}{{ p.fee_both !== null ? ' · own fee Rs ' + m(p.fee_both) : '' }}</p></div>
        @if (p.students.length) { <ng-container *ngTemplateOutlet="riders; context: { $implicit: p.students }" /> } @else { <p class="text-sm font-bold text-slate-400">No student at this stop.</p> }
      </section>
    }
    @if (x.noStop.length) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-amber-300 dark:border-amber-900 shadow-enterprise">
        <h4 class="text-lg font-black tracking-tight mb-2">Stop not chosen <span class="text-slate-400 font-bold text-sm">· {{ x.noStop.length }} students</span></h4>
        <ng-container *ngTemplateOutlet="riders; context: { $implicit: x.noStop }" />
      </section>
    }

    @if (manage) {
      <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <h3 class="text-xl font-black tracking-tight">Add a student to this bus</h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end relative">
          <div class="md:col-span-2 relative"><label class="label" for="as">Find the student</label><input id="as" class="field" type="search" placeholder="Name, roll no or admission no" [ngModel]="q()" (ngModelChange)="onSearch($event)">
            @if (hits().length) { <ul class="absolute z-20 mt-2 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-enterprise-lg overflow-hidden">@for (h of hits(); track h.id) {
              <li><button type="button" class="w-full text-left px-5 py-3 text-sm font-bold hover:bg-indigo-600/10" (click)="pick(h)">{{ h.name }} <span class="text-slate-400">· {{ h.class_name }}-{{ h.section_name }} · Roll {{ h.roll_no ?? '-' }}{{ h.route ? ' · on ' + h.route : '' }}</span></button></li> }</ul> }</div>
          <div><label class="label" for="ast">Stop</label><select id="ast" class="field" [ngModel]="addStop()" (ngModelChange)="addStop.set($event)"><option [ngValue]="null">Choose later</option>@for (p of x.stops; track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }</select></div>
          <div><label class="label" for="amd">Pick and drop</label><select id="amd" class="field" [ngModel]="addMode()" (ngModelChange)="addMode.set($event)"><option value="both">Pick and drop</option><option value="pickup">Pick up only</option><option value="drop">Drop only</option></select></div>
        </div>
        @if (picked(); as h) { <div class="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-indigo-600/10"><span class="text-sm font-black">{{ h.name }} · {{ h.class_name }}-{{ h.section_name }}{{ h.route ? ' (moves from ' + h.route + ')' : '' }}</span><button type="button" class="btn-primary !py-2.5" (click)="addStudent()">Add to {{ x.route.name }}</button></div> }

        <div class="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-3"><h4 class="text-lg font-black">Stops of this route</h4>
            @for (p of x.stops; track p.id) { <div class="grid grid-cols-12 gap-2 items-center">
              <input class="field col-span-5 !py-2 !text-xs" [(ngModel)]="p.name" [name]="'sn' + p.id" aria-label="Stop name"><input type="time" class="field col-span-3 !py-2 !text-xs" [(ngModel)]="p.pickup_time" [name]="'sp' + p.id" aria-label="Pick up time"><input type="time" class="field col-span-3 !py-2 !text-xs" [(ngModel)]="p.drop_time" [name]="'sd' + p.id" aria-label="Drop time">
              <button type="button" class="col-span-1 text-xs font-black text-indigo-600" (click)="saveStop(p)" aria-label="Save stop">Save</button>
              <input type="number" min="0" class="field col-span-5 !py-2 !text-xs" [(ngModel)]="p.fee_both" [name]="'sf' + p.id" placeholder="Own fee (optional)" aria-label="Fee for this stop"><input type="number" min="0" class="field col-span-5 !py-2 !text-xs" [(ngModel)]="p.fee_one" [name]="'s1' + p.id" placeholder="Own one-way fee" aria-label="One way fee for this stop">
              <button type="button" class="col-span-2 text-xs font-black text-rose-500" (click)="deleteStop(p)">Delete</button></div> }
            <form (ngSubmit)="addNewStop()" class="grid grid-cols-12 gap-2 items-center pt-2"><input class="field col-span-6 !py-2 !text-xs" required placeholder="New stop name" [(ngModel)]="ns.name" name="nsn" aria-label="New stop name"><input type="time" class="field col-span-3 !py-2 !text-xs" [(ngModel)]="ns.pickup_time" name="nsp" aria-label="Pick up time"><input type="time" class="field col-span-3 !py-2 !text-xs" [(ngModel)]="ns.drop_time" name="nsd" aria-label="Drop time"><button class="btn-ghost col-span-12 !py-2" type="submit">Add stop</button></form>
          </div>
          <div class="space-y-3"><h4 class="text-lg font-black">Bus broke down? Move everybody</h4><p class="text-sm font-bold text-slate-400">All students of this bus go to another route. Their fee changes to that route's fee.</p>
            <select class="field" [ngModel]="moveTo()" (ngModelChange)="moveTo.set($event)" aria-label="Move to route"><option [ngValue]="null">Choose the other route</option>@for (r of others(); track r.id) { <option [ngValue]="r.id">{{ r.name }} ({{ r.bus || 'no bus' }}, {{ r.capacity ? r.capacity - (r.used ?? 0) : '?' }} seats left)</option> }</select>
            <button type="button" class="btn-ghost" (click)="moveAll()" [disabled]="!moveTo() || !x.totals.students">Move all {{ x.totals.students }} students</button></div>
        </div>
      </section>
    }
  </div>
  }
  `
})
export class TrRoute {
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  manage = this.auth.canWriteStudents();
  m = money; ms = (k: string) => MODE_SHORT[k]; sc = seatClass; min = Math.min; dc = docClass; dt = docText; ml = MODE_LABEL;
  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(p => Number(p.get('id')))));
  d = signal<RouteDetail | null>(null); error = signal(''); all = signal<RouteRow[]>([]);
  q = signal(''); hits = signal<Hit[]>([]); picked = signal<Hit | null>(null); addStop = signal<number | null>(null); addMode = signal('both'); moveTo = signal<number | null>(null);
  ns = { name: '', pickup_time: '', drop_time: '' };
  others = computed(() => this.all().filter(r => r.id !== this.id()));
  private timer: any;

  constructor() { this.load(); if (this.manage) this.api.get<RouteRow[]>('/transport/routes').subscribe(r => this.all.set(r)); }
  load() { this.api.get<RouteDetail>(`/transport/routes/${this.id()}`).subscribe({ next: d => { this.d.set(d); this.error.set(''); }, error: e => this.error.set(errorText(e)) }); }

  setStop(s: Rider, stopId: number | null) { this.assign(s.id, stopId, s.tr_mode ?? 'both', 'Stop changed.'); }
  remove(s: Rider) { if (!confirm(`Take ${s.name} off this bus? The transport fee stops from the next voucher.`)) return; this.api.post('/transport/assign', { student_id: s.id, route_id: null }).subscribe({ next: () => { this.toast.show('Student removed from the bus.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  private assign(studentId: number, stopId: number | null, mode: string, msg: string) {
    this.api.post<{ fee: number; warning: string | null }>('/transport/assign', { student_id: studentId, route_id: this.id(), stop_id: stopId, mode }).subscribe({ next: r => { this.toast.show(r.warning ?? `${msg} Fee Rs ${money(r.fee)} a month.`, r.warning ? 'error' : 'ok'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  onSearch(v: string) { this.q.set(v); clearTimeout(this.timer); if (!v.trim()) { this.hits.set([]); return; } this.timer = setTimeout(() => this.api.get<Hit[]>('/transport/students/search', { q: v }).subscribe(h => this.hits.set(h)), 250); }
  pick(h: Hit) { this.picked.set(h); this.hits.set([]); this.q.set(''); }
  addStudent() { const h = this.picked(); if (!h) return; this.assign(h.id, this.addStop(), this.addMode(), 'Student added to the bus.'); this.picked.set(null); }

  addNewStop() { this.api.post(`/transport/routes/${this.id()}/stops`, this.ns).subscribe({ next: () => { this.ns = { name: '', pickup_time: '', drop_time: '' }; this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  saveStop(p: Stop) { this.api.put(`/transport/stops/${p.id}`, p).subscribe({ next: () => { this.toast.show('Stop saved.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  deleteStop(p: Stop) { if (!confirm(`Delete the stop "${p.name}"? Its students stay on the bus without a stop.`)) return; this.api.delete(`/transport/stops/${p.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
  moveAll() {
    const to = this.moveTo(); if (!to || !confirm('Move ALL students of this bus to the other route?')) return;
    this.api.post<{ moved: number }>('/transport/assign/move', { from_route_id: this.id(), to_route_id: to }).subscribe({ next: r => { this.toast.show(`${r.moved} students moved.`); this.router.navigate(['/transport/route', to]); }, error: e => this.toast.show(errorText(e), 'error') });
  }
}
