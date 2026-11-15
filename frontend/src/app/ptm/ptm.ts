import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';

interface Meeting { id: number; title: string; date: string; start_time: string; slot_minutes: number; venue: string | null; exam_name: string | null; total: number; attended: number; no_show: number }
interface ExamLite { id: number; name: string; session: string; status: string; classes: string[] }
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

@Component({
  selector: 'app-ptm',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <div class="flex flex-wrap items-end gap-4">
      <div class="flex-1 min-w-64"><h2 class="text-3xl font-black tracking-tighter">Parent Teacher Meeting</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">Every parent gets a time. The teacher sees the child's result, progress and attendance on one page, and the class summary for the whole section.</p></div>
      @if (office()) { <button type="button" class="btn-primary" (click)="show.set(!show())">{{ show() ? 'Close' : 'New meeting' }}</button> }
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (show()) {
      <form (ngSubmit)="create()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
        <h3 class="col-span-2 md:col-span-4 font-black">Plan a meeting</h3>
        <div class="col-span-2"><label class="label" for="m-title">Title</label><input id="m-title" name="title" class="field" required maxlength="100" placeholder="Term 1 results meeting" [(ngModel)]="f.title"></div>
        <div><label class="label" for="m-date">Date</label><input id="m-date" name="date" type="date" class="field" required [(ngModel)]="f.date"></div>
        <div><label class="label" for="m-venue">Venue (optional)</label><input id="m-venue" name="venue" class="field" [(ngModel)]="f.venue"></div>
        <div><label class="label" for="m-start">First parent at</label><input id="m-start" name="start" type="time" class="field" required [(ngModel)]="f.start_time"></div>
        <div><label class="label" for="m-slot">Minutes per parent</label><input id="m-slot" name="slot" type="number" min="5" max="60" class="field" [(ngModel)]="f.slot_minutes"></div>
        <div><label class="label" for="m-end">Must finish by (optional)</label><input id="m-end" name="end" type="time" class="field" [(ngModel)]="f.end_time"></div>
        <div><label class="label" for="m-order">Order of parents</label><select id="m-order" name="order" class="field" [(ngModel)]="f.order"><option value="roll">By roll number</option><option value="priority">Failing or dropping students first</option></select></div>
        <div class="col-span-2"><label class="label" for="m-exam">Result to discuss</label><select id="m-exam" name="exam" class="field" [(ngModel)]="f.exam_id"><option [ngValue]="null">No exam, attendance only</option>@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }}, {{ e.status }})</option> }</select></div>
        <div><label class="label" for="m-af">Attendance from</label><input id="m-af" name="af" type="month" class="field" [(ngModel)]="f.att_from"></div>
        <div><label class="label" for="m-at">Attendance to</label><input id="m-at" name="at" type="month" class="field" [(ngModel)]="f.att_to"></div>
        <fieldset class="col-span-2 md:col-span-4"><legend class="label">Classes (each class teacher meets their own parents at the same time)</legend>
          <div class="flex flex-wrap gap-2">
            @for (s of allSections(); track s.id) { <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-bold"><input type="checkbox" [checked]="f.section_ids.includes(s.id)" (change)="toggle(s.id)"> {{ s.label }}</label> }
          </div></fieldset>
        <div class="col-span-2 md:col-span-4"><button class="btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Creating...' : 'Create meeting and schedule' }}</button></div>
      </form>
    }

    <div class="space-y-3">
      @for (m of meetings(); track m.id) {
        <a [routerLink]="['/ptm', m.id]" class="block bg-white dark:bg-slate-900/40 p-5 rounded-[1.75rem] border border-slate-200 dark:border-slate-800 shadow-enterprise hover:border-indigo-500">
          <div class="flex flex-wrap items-center gap-3"><h4 class="text-lg font-black flex-1 min-w-48">{{ m.title }}</h4><span class="text-xs font-black text-slate-400">{{ nice(m.date) }} · from {{ m.start_time }}{{ m.venue ? ' · ' + m.venue : '' }}</span></div>
          <p class="text-sm font-bold text-slate-500 mt-1">{{ m.exam_name ?? 'Attendance only' }} · {{ m.total }} parents · {{ m.attended }} met · {{ m.no_show }} did not come · {{ m.total - m.attended - m.no_show }} waiting</p>
        </a>
      } @empty { <p class="p-10 text-center text-sm font-bold text-slate-400">No meetings yet.</p> }
    </div>
  </div>
  `
})
export class Ptm {
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  nice = nice; error = signal(''); show = signal(false); busy = signal(false);
  office = computed(() => ['director', 'principal', 'admin'].includes(this.auth.user()?.role ?? ''));
  meetings = signal<Meeting[]>([]); exams = signal<ExamLite[]>([]); allSections = signal<{ id: number; label: string }[]>([]);
  f: { title: string; date: string; venue: string; start_time: string; slot_minutes: number; end_time: string; order: string; exam_id: number | null; att_from: string; att_to: string; section_ids: number[] } =
    { title: '', date: '', venue: '', start_time: '09:00', slot_minutes: 10, end_time: '', order: 'roll', exam_id: null, att_from: '', att_to: '', section_ids: [] };
  constructor() {
    this.load();
    if (this.office()) {
      this.api.get<ExamLite[]>('/exam/exams').subscribe({ next: r => this.exams.set(r), error: e => this.error.set(errorText(e)) });
      this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => this.allSections.set(c.flatMap(k => k.sections.map(s => ({ id: s.id, label: `${k.name}-${s.name}` })))), error: e => this.error.set(errorText(e)) });
    }
  }
  load() { this.api.get<Meeting[]>('/ptm').subscribe({ next: r => this.meetings.set(r), error: e => this.error.set(errorText(e)) }); }
  toggle(id: number) { this.f.section_ids = this.f.section_ids.includes(id) ? this.f.section_ids.filter(x => x !== id) : [...this.f.section_ids, id]; }
  create() {
    this.busy.set(true);
    this.api.post<{ id: number }>('/ptm', { ...this.f, end_time: this.f.end_time || null, att_from: this.f.att_from || null, att_to: this.f.att_to || null, venue: this.f.venue || null }).subscribe({
      next: () => { this.busy.set(false); this.toast.show('Meeting scheduled.'); this.show.set(false); this.load(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
}
