import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { fmtDate, today } from './att';

interface SecT { id: number; class_name: string; section_name: string; class_teacher_id: number | null }

@Component({
  selector: 'app-att-settings',
  imports: [FormsModule],
  template: `
  <div class="space-y-8 max-w-4xl">
    <form (ngSubmit)="saveCfg()" class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <h3 class="text-xl font-black tracking-tight">Rules</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div><label class="label" for="lp">Minimum attendance (%)</label><input id="lp" name="lp" type="number" min="1" max="100" class="field" [(ngModel)]="cfg.low_pct"></div>
        <div><label class="label" for="ed">Teachers can change the last (days)</label><input id="ed" name="ed" type="number" min="0" max="60" class="field" [(ngModel)]="cfg.edit_days"></div>
      </div>
      <label class="flex items-center gap-3 text-sm font-bold"><input type="checkbox" class="w-5 h-5 accent-indigo-600" name="lc" [(ngModel)]="cfg.leave_counts"> Count approved leave as present in the percentage</label>
      <p class="text-xs font-bold text-slate-400">The office (director, principal, admin) can change any past day. Students below the minimum are listed in the analysis.</p>
      <button class="btn-primary" type="submit">Save rules</button>
    </form>

    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div><h3 class="text-xl font-black tracking-tight">Holidays</h3><p class="text-sm font-bold text-slate-400 mt-1">Holidays and Sundays are not school days, so nobody is counted absent on them. Weekly off days come from Timetable settings.</p></div>
      <form (ngSubmit)="addHoliday()" class="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
        <div><label class="label" for="hf">From</label><input id="hf" name="hf" type="date" class="field" required [(ngModel)]="h.from"></div>
        <div><label class="label" for="ht">To (optional)</label><input id="ht" name="ht" type="date" class="field" [(ngModel)]="h.to"></div>
        <div class="col-span-2"><label class="label" for="hn">Name</label><input id="hn" name="hn" class="field" required placeholder="e.g. Eid ul Fitr" [(ngModel)]="h.name"></div>
        <button class="btn-primary" type="submit">Add</button>
      </form>
      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
      <div class="flex items-center gap-3"><label class="label !m-0" for="hy">Year</label><input id="hy" type="number" min="2020" max="2100" class="field !w-28 !py-2.5" [ngModel]="year()" (ngModelChange)="setYear($event)" name="hy"></div>
      <ul class="grid grid-cols-1 md:grid-cols-2 gap-2">
        @for (x of holidays(); track x.date) { <li class="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50 text-sm"><span><b>{{ d(x.date) }}</b> · {{ x.name }}</span><button type="button" class="text-xs font-black text-rose-500" (click)="delHoliday(x.date)">Remove</button></li> }
      </ul>
      @if (!holidays().length) { <p class="text-sm font-bold text-slate-400">No holidays added for {{ year() }}.</p> }
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div><h3 class="text-xl font-black tracking-tight">Class teachers</h3><p class="text-sm font-bold text-slate-400 mt-1">The class teacher takes the daily register of the section. Teachers need a login (Timetable, Teachers, Login account) to use it.</p></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        @for (s of secs(); track s.id) {
          <div class="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <span class="w-20 text-sm font-black whitespace-nowrap">{{ s.class_name.replace('Class ', '') }}-{{ s.section_name }}</span>
            <select class="field !py-2 !text-xs" [ngModel]="s.class_teacher_id" (ngModelChange)="setCT(s, $event)" [attr.aria-label]="'Class teacher of ' + s.class_name + ' ' + s.section_name" name="ct{{ s.id }}">
              <option [ngValue]="null">Not set</option>@for (t of teachers(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
            </select>
          </div>
        }
      </div>
    </section>
  </div>
  `
})
export class AttSettings {
  private api = inject(Api);
  private toast = inject(ToastService);
  d = fmtDate;
  cfg = { low_pct: 75, edit_days: 2, leave_counts: false };
  year = signal(Number(today().slice(0, 4)));
  holidays = signal<{ date: string; name: string }[]>([]);
  h = { from: '', to: '', name: '' };
  secs = signal<SecT[]>([]); teachers = signal<{ id: number; name: string }[]>([]);
  error = signal('');

  constructor() {
    this.api.get<typeof this.cfg>('/attendance/config').subscribe(c => this.cfg = { low_pct: c.low_pct, edit_days: c.edit_days, leave_counts: c.leave_counts });
    this.api.get<{ sections: SecT[]; teachers: { id: number; name: string }[] }>('/attendance/class-teachers').subscribe(r => { this.secs.set(r.sections); this.teachers.set(r.teachers); });
    this.loadHolidays();
  }
  saveCfg() { this.api.put('/attendance/config', this.cfg).subscribe({ next: () => this.toast.show('Rules saved.'), error: e => this.toast.show(errorText(e), 'error') }); }
  setYear(v: number) { this.year.set(v); this.loadHolidays(); }
  loadHolidays() { this.api.get<{ date: string; name: string }[]>('/attendance/holidays', { year: this.year() }).subscribe(h => this.holidays.set(h)); }
  addHoliday() {
    this.error.set('');
    this.api.post<{ days: number }>('/attendance/holidays', { from: this.h.from, to: this.h.to || this.h.from, name: this.h.name }).subscribe({
      next: r => { this.toast.show(`${r.days} holiday day(s) added.`); this.h = { from: '', to: '', name: '' }; this.loadHolidays(); }, error: e => this.error.set(errorText(e))
    });
  }
  delHoliday(date: string) { this.api.delete(`/attendance/holidays/${date}`).subscribe({ next: () => this.loadHolidays(), error: e => this.toast.show(errorText(e), 'error') }); }
  setCT(s: SecT, teacherId: number | null) { this.api.put('/attendance/class-teachers', { section_id: s.id, teacher_id: teacherId }).subscribe({ next: () => { s.class_teacher_id = teacherId; this.toast.show('Class teacher saved.'); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
