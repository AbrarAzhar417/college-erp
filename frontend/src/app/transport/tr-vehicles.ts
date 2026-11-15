import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { Staff, Vehicle, docClass, docText } from './tr';

const blank = (): Partial<Vehicle> => ({ number: '', reg_no: '', kind: 'bus', capacity: 40, make_model: '', year: null, driver_id: null, conductor_id: null, fitness_expiry: '', permit_expiry: '', insurance_expiry: '', tax_expiry: '', next_service: '', notes: '' });

@Component({
  selector: 'app-tr-vehicles',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    @if (manage) {
      <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <div><h3 class="text-xl font-black tracking-tight">{{ f.id ? 'Edit bus' : 'Add a bus' }}</h3><p class="text-sm font-bold text-slate-400 mt-1">Enter the expiry dates of the papers. The overview warns you 30 days before each one runs out.</p></div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><label class="label" for="vn">Name (Bus 1)</label><input id="vn" name="vn" class="field" required [(ngModel)]="f.number"></div>
          <div><label class="label" for="vr">Registration no.</label><input id="vr" name="vr" class="field" [(ngModel)]="f.reg_no"></div>
          <div><label class="label" for="vk">Kind</label><select id="vk" name="vk" class="field" [(ngModel)]="f.kind"><option value="bus">Bus</option><option value="coaster">Coaster</option><option value="van">Van</option></select></div>
          <div><label class="label" for="vc">Seats</label><input id="vc" name="vc" type="number" min="1" max="200" class="field" required [(ngModel)]="f.capacity"></div>
          <div><label class="label" for="vm">Make and model</label><input id="vm" name="vm" class="field" [(ngModel)]="f.make_model"></div>
          <div><label class="label" for="vy">Year</label><input id="vy" name="vy" type="number" class="field" [(ngModel)]="f.year"></div>
          <div><label class="label" for="vd">Driver</label><select id="vd" name="vd" class="field" [(ngModel)]="f.driver_id"><option [ngValue]="null">Not set</option>@for (s of drivers(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
          <div><label class="label" for="vo">Conductor</label><select id="vo" name="vo" class="field" [(ngModel)]="f.conductor_id"><option [ngValue]="null">None</option>@for (s of conductors(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
          <div><label class="label" for="vf">Fitness certificate expires</label><input id="vf" name="vf" type="date" class="field" [(ngModel)]="f.fitness_expiry"></div>
          <div><label class="label" for="vp">Route permit expires</label><input id="vp" name="vp" type="date" class="field" [(ngModel)]="f.permit_expiry"></div>
          <div><label class="label" for="vi">Insurance expires</label><input id="vi" name="vi" type="date" class="field" [(ngModel)]="f.insurance_expiry"></div>
          <div><label class="label" for="vt">Token tax expires</label><input id="vt" name="vt" type="date" class="field" [(ngModel)]="f.tax_expiry"></div>
          <div><label class="label" for="vs">Next service due</label><input id="vs" name="vs" type="date" class="field" [(ngModel)]="f.next_service"></div>
          <div class="col-span-2 md:col-span-3"><label class="label" for="vx">Notes</label><input id="vx" name="vx" class="field" [(ngModel)]="f.notes"></div>
        </div>
        @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
        <div class="flex gap-3"><button class="btn-primary" type="submit">{{ f.id ? 'Save bus' : 'Add bus' }}</button>@if (f.id) { <button type="button" class="btn-ghost" (click)="f = blank()">Cancel</button> }</div>
      </form>
    }
    <div class="flex justify-end"><a [routerLink]="['/transport/print/vehicles']" class="btn-ghost">Print buses and documents</a></div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
      @for (v of list(); track v.id) {
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
          <div class="flex items-start justify-between gap-3"><div><h3 class="text-xl font-black tracking-tight">{{ v.number }} <span class="text-sm font-bold text-slate-400">{{ v.reg_no }}</span></h3>
            <p class="text-xs font-bold text-slate-400 mt-1">{{ v.make_model }}{{ v.year ? ' ' + v.year : '' }} · {{ v.capacity }} seats · {{ v.route ? 'Route: ' + v.route + ' (' + v.used + ' students)' : 'No route' }}</p></div>
            @if (manage) { <span class="whitespace-nowrap"><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="edit(v)">Edit</button><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="remove(v)">Delete</button></span> }</div>
          <p class="text-sm font-bold">Driver: {{ v.driver || 'not set' }} · Conductor: {{ v.conductor || 'none' }}</p>
          <div class="flex flex-wrap gap-1.5">
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="dc(v.fitness_expiry)">Fitness: {{ dt(v.fitness_expiry) }}</span><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="dc(v.permit_expiry)">Permit: {{ dt(v.permit_expiry) }}</span>
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="dc(v.insurance_expiry)">Insurance: {{ dt(v.insurance_expiry) }}</span><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="dc(v.tax_expiry)">Tax: {{ dt(v.tax_expiry) }}</span><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="dc(v.next_service)">Service: {{ dt(v.next_service) }}</span></div>
        </section>
      }
    </div>
    @if (!list().length) { <p class="text-sm font-bold text-slate-400">No buses yet.</p> }
  </div>
  `
})
export class TrVehicles {
  private api = inject(Api);
  private toast = inject(ToastService);
  manage = inject(AuthService).canWriteStudents();
  dc = docClass; dt = docText; blank = blank;
  list = signal<Vehicle[]>([]); staff = signal<Staff[]>([]); error = signal('');
  f: Partial<Vehicle> = blank();
  drivers = () => this.staff().filter(s => s.role === 'driver'); conductors = () => this.staff().filter(s => s.role === 'conductor');
  constructor() { this.load(); this.api.get<Staff[]>('/transport/staff').subscribe(s => this.staff.set(s)); }
  load() { this.api.get<Vehicle[]>('/transport/vehicles').subscribe({ next: v => this.list.set(v), error: e => this.error.set(errorText(e)) }); }
  edit(v: Vehicle) { this.f = { ...v }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  save() {
    this.error.set('');
    const req = this.f.id ? this.api.put(`/transport/vehicles/${this.f.id}`, this.f) : this.api.post('/transport/vehicles', this.f);
    req.subscribe({ next: () => { this.toast.show('Saved.'); this.f = blank(); this.load(); }, error: e => this.error.set(errorText(e)) });
  }
  remove(v: Vehicle) { if (!confirm(`Remove ${v.number}?`)) return; this.api.delete(`/transport/vehicles/${v.id}`).subscribe({ next: () => { this.toast.show('Bus removed.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
