import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { HrConfig, LeaveType } from './hr';

interface Item { id: number; name: string }
interface Settings { departments: Item[]; designations: Item[]; leaveTypes: (LeaveType & { active: number })[]; config: HrConfig }

@Component({
  selector: 'app-hr-settings',
  imports: [FormsModule],
  template: `
  <div class="space-y-8">
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (s(); as x) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-lg font-black tracking-tight">Salary and attendance rules</h3>
        @if (!leader) { <p class="text-sm font-bold text-slate-400">Only the principal or director can change these.</p> }
        <form (ngSubmit)="saveConfig()" class="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div><label class="label" for="cd">A day of salary is</label><select id="cd" name="cd" class="field" [disabled]="!leader" [(ngModel)]="cfg.day_divisor"><option value="30">Salary ÷ 30</option><option value="working">Salary ÷ school days of the month</option></select></div>
          <div><label class="label" for="cl">Lates that cut 1 day (0 = never)</label><input id="cl" name="cl" type="number" min="0" max="31" class="field" [disabled]="!leader" [(ngModel)]="cfg.late_per_day"></div>
          <div><label class="label" for="ca">Late if time in is after</label><input id="ca" name="ca" type="time" class="field" [disabled]="!leader" [(ngModel)]="cfg.late_after"></div>
          <div><label class="label" for="cn">Warn before contract ends (days)</label><input id="cn" name="cn" type="number" min="1" max="180" class="field" [disabled]="!leader" [(ngModel)]="cfg.contract_alert_days"></div>
          @if (leader) { <button class="btn-primary col-span-2 md:col-span-4" type="submit">Save rules</button> }
        </form>
        <p class="text-xs font-bold text-slate-400">Absent days and unpaid leave always cut salary (a half day cuts half a day). With "Lates that cut 1 day" at 3, every 3 lates in a month cut one day.</p>
      </section>

      <div class="grid md:grid-cols-2 gap-6">
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
          <h3 class="text-lg font-black tracking-tight">Departments</h3>
          <div class="flex flex-wrap gap-2">@for (i of x.departments; track i.id) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800">{{ i.name }} <button type="button" class="ml-1 text-rose-500" [attr.aria-label]="'Delete ' + i.name" (click)="del('departments', i)">×</button></span> }</div>
          <form (ngSubmit)="add('departments', dn)" class="flex gap-2"><input name="dn" class="field" placeholder="New department" [(ngModel)]="dn"><button class="btn-primary" type="submit">Add</button></form>
        </section>
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
          <h3 class="text-lg font-black tracking-tight">Designations</h3>
          <div class="flex flex-wrap gap-2">@for (i of x.designations; track i.id) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800">{{ i.name }} <button type="button" class="ml-1 text-rose-500" [attr.aria-label]="'Delete ' + i.name" (click)="del('designations', i)">×</button></span> }</div>
          <form (ngSubmit)="add('designations', gn)" class="flex gap-2"><input name="gn" class="field" placeholder="New designation" [(ngModel)]="gn"><button class="btn-primary" type="submit">Add</button></form>
        </section>
      </div>

      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-lg font-black tracking-tight">Kinds of leave</h3>
        @for (t of x.leaveTypes; track t.id) { @if (t.active) {
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div class="col-span-2"><input class="field" [attr.aria-label]="'Leave name'" [disabled]="!leader" [(ngModel)]="t.name" [name]="'n' + t.id"></div>
            <div><input type="number" min="0" class="field" aria-label="Days per year" [disabled]="!leader" [(ngModel)]="t.yearly_quota" [name]="'q' + t.id"></div>
            <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" [disabled]="!leader" [ngModel]="!!t.paid" (ngModelChange)="t.paid = $event ? 1 : 0" [name]="'p' + t.id"> Paid</label>
            @if (leader) { <div class="flex gap-2"><button type="button" class="btn-ghost" (click)="saveType(t)">Save</button><button type="button" class="btn-ghost !text-rose-500" (click)="delType(t)">Delete</button></div> }
          </div> } }
        <p class="text-xs font-bold text-slate-400">The number is days per year (0 = no limit). Unpaid leave cuts salary.</p>
        @if (leader) { <form (ngSubmit)="addType()" class="grid grid-cols-2 md:grid-cols-5 gap-3 items-end"><div class="col-span-2"><label class="label" for="tn">New leave kind</label><input id="tn" name="tn" class="field" [(ngModel)]="nt.name"></div>
          <div><label class="label" for="tq">Days per year</label><input id="tq" name="tq" type="number" min="0" class="field" [(ngModel)]="nt.yearly_quota"></div>
          <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="tp" [(ngModel)]="nt.paid"> Paid</label><button class="btn-primary" type="submit">Add</button></form> }
      </section>
    }
  </div>
  `
})
export class HrSettings {
  private api = inject(Api);
  private toast = inject(ToastService);
  leader = inject(AuthService).isLeadership();
  s = signal<Settings | null>(null); error = signal(''); cfg: HrConfig = { day_divisor: '30', late_per_day: 0, late_after: '08:00', contract_alert_days: 30 };
  dn = ''; gn = ''; nt = { name: '', yearly_quota: 0, paid: true };
  constructor() { this.load(); }
  load() { this.api.get<Settings>('/hr/settings').subscribe({ next: x => { this.s.set(x); this.cfg = { ...x.config }; }, error: e => this.error.set(errorText(e)) }); }
  private done = (msg: string) => ({ next: () => { this.toast.show(msg); this.load(); }, error: (e: unknown) => this.toast.show(errorText(e), 'error') });
  saveConfig() { this.api.put('/hr/settings/config', this.cfg).subscribe(this.done('Saved.')); }
  add(kind: 'departments' | 'designations', name: string) { if (!name.trim()) return; this.api.post(`/hr/settings/${kind}`, { name }).subscribe(this.done('Added.')); if (kind === 'departments') this.dn = ''; else this.gn = ''; }
  del(kind: 'departments' | 'designations', i: Item) { this.api.delete(`/hr/settings/${kind}/${i.id}`).subscribe(this.done('Removed.')); }
  saveType(t: LeaveType) { this.api.put(`/hr/settings/leave-types/${t.id}`, t).subscribe(this.done('Saved.')); }
  delType(t: LeaveType) { if (confirm(`Delete "${t.name}"? If it was used before it is only hidden.`)) this.api.delete(`/hr/settings/leave-types/${t.id}`).subscribe(this.done('Removed.')); }
  addType() { this.api.post('/hr/settings/leave-types', this.nt).subscribe({ next: () => { this.toast.show('Added.'); this.nt = { name: '', yearly_quota: 0, paid: true }; this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
