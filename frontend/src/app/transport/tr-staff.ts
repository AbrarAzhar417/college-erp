import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { Staff, docClass, docText } from './tr';

const blank = (): Partial<Staff> => ({ name: '', role: 'driver', phone: '', cnic: '', address: '' });

@Component({
  selector: 'app-tr-staff',
  imports: [FormsModule],
  template: `
  <div class="space-y-6">
    @if (manage) {
      <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
        <h3 class="text-xl font-black tracking-tight">{{ f.id ? 'Edit' : 'Add a driver or conductor' }}</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="col-span-2"><label class="label" for="sn">Name</label><input id="sn" name="sn" class="field" required [(ngModel)]="f.name"></div>
          <div><label class="label" for="sr">Work</label><select id="sr" name="sr" class="field" [(ngModel)]="f.role"><option value="driver">Driver</option><option value="conductor">Conductor</option></select></div>
          <div><label class="label" for="sp">Phone</label><input id="sp" name="sp" class="field" [(ngModel)]="f.phone"></div>
          <div><label class="label" for="sc">CNIC</label><input id="sc" name="sc" class="field" [(ngModel)]="f.cnic"></div>
          <div><label class="label" for="sa">Address</label><input id="sa" name="sa" class="field" [(ngModel)]="f.address"></div>
        </div>
        @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
        <div class="flex gap-3"><button class="btn-primary" type="submit">{{ f.id ? 'Save' : 'Add' }}</button>@if (f.id) { <button type="button" class="btn-ghost" (click)="f = blank()">Cancel</button> }</div>
      </form>
    }
    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-5 py-4">Name</th><th class="px-5 py-4">Work</th><th class="px-5 py-4">Phone</th><th class="px-5 py-4">Bus</th>@if (manage) { <th class="px-5 py-4"></th> }</tr></thead>
        <tbody>@for (s of list(); track s.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60"><td class="px-5 py-3 font-black">{{ s.name }}<span class="block text-[11px] font-bold text-slate-400">{{ s.cnic }}</span></td><td class="px-5 py-3 capitalize font-bold">{{ s.role }}</td><td class="px-5 py-3 whitespace-nowrap">{{ s.phone || '-' }}</td><td class="px-5 py-3 font-bold">{{ s.vehicles || '-' }}</td>
            @if (manage) { <td class="px-5 py-3 text-right whitespace-nowrap"><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="edit(s)">Edit</button><button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="remove(s)">Remove</button></td> }</tr> }</tbody>
      </table>
      @if (!list().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No drivers or conductors yet.</p> }
    </div>
  </div>
  `
})
export class TrStaff {
  private api = inject(Api);
  private toast = inject(ToastService);
  manage = inject(AuthService).canWriteStudents();
  dc = docClass; dt = docText; blank = blank;
  list = signal<Staff[]>([]); error = signal(''); f: Partial<Staff> = blank();
  constructor() { this.load(); }
  load() { this.api.get<Staff[]>('/transport/staff').subscribe({ next: s => this.list.set(s), error: e => this.error.set(errorText(e)) }); }
  edit(s: Staff) { this.f = { ...s }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  save() {
    this.error.set('');
    const req = this.f.id ? this.api.put(`/transport/staff/${this.f.id}`, this.f) : this.api.post('/transport/staff', this.f);
    req.subscribe({ next: () => { this.toast.show('Saved.'); this.f = blank(); this.load(); }, error: e => this.error.set(errorText(e)) });
  }
  remove(s: Staff) { if (!confirm(`Remove ${s.name}? They are taken off their bus.`)) return; this.api.delete(`/transport/staff/${s.id}`).subscribe({ next: () => { this.toast.show('Removed.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
