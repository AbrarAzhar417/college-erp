import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { RouteRow, Vehicle, money } from './tr';

const blank = (): Partial<RouteRow> => ({ name: '', area: '', vehicle_id: null, morning_time: '', afternoon_time: '', fee_both: 0, fee_one: null, note: '' });

@Component({
  selector: 'app-tr-routes',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    @if (manage) {
      <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <div><h3 class="text-xl font-black tracking-tight">{{ f.id ? 'Edit route' : 'New route' }}</h3><p class="text-sm font-bold text-slate-400 mt-1">A route is one bus line, for example Model Town or Kahuta. Stops are added on the route's own page.</p></div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="col-span-2"><label class="label" for="rn">Route name</label><input id="rn" name="rn" class="field" required placeholder="e.g. Model Town" [(ngModel)]="f.name"></div>
          <div class="col-span-2"><label class="label" for="ra">Area it covers</label><input id="ra" name="ra" class="field" [(ngModel)]="f.area"></div>
          <div><label class="label" for="rv">Bus</label><select id="rv" name="rv" class="field" [(ngModel)]="f.vehicle_id"><option [ngValue]="null">No bus yet</option>@for (v of vehicles(); track v.id) { <option [ngValue]="v.id">{{ v.number }} ({{ v.capacity }} seats){{ v.route && v.route_id !== f.id ? ' - used by ' + v.route : '' }}</option> }</select></div>
          <div><label class="label" for="rm">Morning pick up starts</label><input id="rm" name="rm" type="time" class="field" [(ngModel)]="f.morning_time"></div>
          <div><label class="label" for="rf">Afternoon drop starts</label><input id="rf" name="rf" type="time" class="field" [(ngModel)]="f.afternoon_time"></div>
          <div></div>
          <div><label class="label" for="r1">Monthly fee, pick and drop (Rs)</label><input id="r1" name="r1" type="number" min="0" class="field" [(ngModel)]="f.fee_both"></div>
          <div><label class="label" for="r2">Monthly fee, one way (Rs)</label><input id="r2" name="r2" type="number" min="0" class="field" placeholder="same as above" [(ngModel)]="f.fee_one"></div>
          <div class="col-span-2"><label class="label" for="rt">Note</label><input id="rt" name="rt" class="field" [(ngModel)]="f.note"></div>
        </div>
        @if (f.id) { <p class="text-xs font-bold text-amber-600">If you change a fee, every student on this route pays the new fee from the next voucher.</p> }
        @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
        <div class="flex gap-3"><button class="btn-primary" type="submit">{{ f.id ? 'Save route' : 'Add route' }}</button>@if (f.id) { <button type="button" class="btn-ghost" (click)="f = blank()">Cancel</button> }</div>
      </form>
    }
    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Route</th><th class="px-5 py-4">Bus</th><th class="px-5 py-4 text-right">Students</th><th class="px-5 py-4 text-right">Fee (both / one way)</th><th class="px-5 py-4">Times</th><th class="px-5 py-4"></th></tr></thead>
        <tbody>@for (r of routes(); track r.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60">
            <td class="px-5 py-3"><a [routerLink]="['/transport/route', r.id]" class="font-black hover:text-indigo-500">{{ r.name }}</a><span class="block text-[11px] font-bold text-slate-400">{{ r.area }}</span></td>
            <td class="px-5 py-3 font-bold">{{ r.bus || '-' }}</td><td class="px-5 py-3 text-right font-black" [class]="r.capacity && (r.used ?? 0) > r.capacity ? 'text-rose-500' : ''">{{ r.used }}{{ r.capacity ? ' / ' + r.capacity : '' }}</td>
            <td class="px-5 py-3 text-right whitespace-nowrap">Rs {{ m(r.fee_both) }} / {{ r.fee_one === null ? 'same' : 'Rs ' + m(r.fee_one) }}</td><td class="px-5 py-3 whitespace-nowrap text-xs font-bold text-slate-500">{{ r.morning_time || '-' }} / {{ r.afternoon_time || '-' }}</td>
            <td class="px-5 py-3 text-right whitespace-nowrap"><a [routerLink]="['/transport/route', r.id]" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10">Open</a>@if (manage) { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-500/10" (click)="edit(r)">Edit</button><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="remove(r)">Delete</button> }</td></tr> }</tbody>
      </table>
      @if (!routes().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No routes yet.</p> }
    </div>
  </div>
  `
})
export class TrRoutes {
  private api = inject(Api);
  private toast = inject(ToastService);
  manage = inject(AuthService).canWriteStudents();
  m = money; blank = blank;
  routes = signal<RouteRow[]>([]); vehicles = signal<Vehicle[]>([]); error = signal('');
  f: Partial<RouteRow> = blank();
  constructor() {
    this.load();
    if (this.manage) this.api.get<Vehicle[]>('/transport/vehicles').subscribe(v => this.vehicles.set(v));
    const e = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('edit')); if (e) this.api.get<RouteRow[]>('/transport/routes').subscribe(r => { const x = r.find(y => y.id === e); if (x) this.edit(x); });
  }
  load() { this.api.get<RouteRow[]>('/transport/routes').subscribe({ next: r => this.routes.set(r), error: e => this.error.set(errorText(e)) }); }
  edit(r: RouteRow) { this.f = { ...r }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  save() {
    this.error.set('');
    const req = this.f.id ? this.api.put(`/transport/routes/${this.f.id}`, this.f) : this.api.post('/transport/routes', this.f);
    req.subscribe({ next: () => { this.toast.show(this.f.id ? 'Route saved.' : 'Route added.'); this.f = blank(); this.load(); this.api.get<Vehicle[]>('/transport/vehicles').subscribe(v => this.vehicles.set(v)); }, error: e => this.error.set(errorText(e)) });
  }
  remove(r: RouteRow) { if (!confirm(`Delete the route ${r.name}?`)) return; this.api.delete(`/transport/routes/${r.id}`).subscribe({ next: () => { this.toast.show('Route deleted.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
