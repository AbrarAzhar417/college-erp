import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { CalMonth, SylCfg, fmtDate, weekDates } from './syl';

@Component({
  selector: 'app-syl-calendar',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <p class="text-sm font-bold text-slate-400">Session {{ cfg()?.session }}. Every month has four teaching weeks: days 1 to 7, 8 to 14, 15 to 21 and 22 to the end of the month. Holidays come from Attendance settings and exams from the Examination module.</p>
      <a [routerLink]="['/syllabus/print/calendar']" class="btn-ghost">Print calendar</a>
    </div>
    @if (auth.canWriteStudents()) {
      <form (ngSubmit)="addEvent()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
        <div><label class="label" for="ed">Date</label><input id="ed" name="ed" type="date" class="field" required [(ngModel)]="ev.date"></div>
        <div><label class="label" for="et">To (optional)</label><input id="et" name="et" type="date" class="field" [(ngModel)]="ev.to_date"></div>
        <div class="col-span-2"><label class="label" for="en">Event</label><input id="en" name="en" class="field" required placeholder="e.g. Sports day" [(ngModel)]="ev.title"></div>
        <div><label class="label" for="ek">Kind</label><select id="ek" name="ek" class="field" [(ngModel)]="ev.kind"><option value="event">Event</option><option value="ptm">Parent meeting</option><option value="activity">Activity</option><option value="deadline">Deadline</option></select></div>
        <button class="btn-primary" type="submit">Add</button>
      </form>
    }
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      @for (m of cal(); track m.month) {
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <h3 class="text-lg font-black tracking-tight mb-3">{{ m.label }}</h3>
          <div class="space-y-2">
            @for (w of m.weeks; track w.week) {
              <div class="p-3 rounded-2xl" [class]="isNow(m.month, w.week) ? 'bg-indigo-600/10 ring-2 ring-indigo-500' : 'bg-slate-50 dark:bg-slate-950/50'">
                <div class="flex items-baseline justify-between gap-2"><p class="text-sm font-black">Week {{ w.week }} <span class="text-slate-400 font-bold">{{ wd(w) }}</span></p><p class="text-[11px] font-bold text-slate-400">{{ w.working }} school days</p></div>
                <div class="flex flex-wrap gap-1.5 mt-1.5">
                  @for (h of w.holidays; track h.date) { <span class="px-2 py-1 rounded-lg bg-slate-500/15 text-slate-600 dark:text-slate-300 text-[11px] font-black">{{ d(h.date).slice(0, 6) }} {{ h.name }}</span> }
                  @for (e of w.exams; track e.id) { <span class="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[11px] font-black">{{ e.name }} ({{ d(e.from).slice(0, 6) }}{{ e.to !== e.from ? ' to ' + d(e.to).slice(0, 6) : '' }})</span> }
                  @for (e of w.events; track e.id) { <span class="px-2 py-1 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[11px] font-black">{{ d(e.date).slice(0, 6) }} {{ e.title }}@if (auth.canWriteStudents()) { <button type="button" class="ml-1.5 text-rose-500" (click)="remove(e.id)" [attr.aria-label]="'Delete ' + e.title">x</button> }</span> }
                </div>
              </div>
            }
          </div>
        </section>
      }
    </div>
  </div>
  `
})
export class SylCalendar {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  d = fmtDate; wd = weekDates;
  cfg = signal<SylCfg | null>(null); cal = signal<CalMonth[]>([]); error = signal('');
  ev = { date: '', to_date: '', title: '', kind: 'event' };
  isNow = (m: string, w: number) => this.cfg()?.currentMonth === m && this.cfg()?.currentWeek === w;
  constructor() { this.api.get<SylCfg>('/syllabus/config').subscribe(c => this.cfg.set(c)); this.load(); }
  load() { this.api.get<CalMonth[]>('/syllabus/calendar').subscribe({ next: c => this.cal.set(c), error: e => this.error.set(errorText(e)) }); }
  addEvent() { this.error.set(''); this.api.post('/syllabus/events', this.ev).subscribe({ next: () => { this.ev = { date: '', to_date: '', title: '', kind: 'event' }; this.toast.show('Event added.'); this.load(); }, error: e => this.error.set(errorText(e)) }); }
  remove(id: number) { if (!confirm('Delete this event?')) return; this.api.delete(`/syllabus/events/${id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
