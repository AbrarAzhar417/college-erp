import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';

interface Duty { key: string; label: string; blurb: string }
interface Staff { id: number; name: string; username: string; duties: string[] }

@Component({
  selector: 'app-duties',
  imports: [FormsModule],
  template: `
  <div class="max-w-4xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Additional Charges</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Give a teacher an extra role. The teacher sees the matching menu from their next login or refresh, and loses it as soon as you take the charge back.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="grid md:grid-cols-3 gap-3">@for (d of duties(); track d.key) { <div class="p-4 rounded-2xl bg-slate-500/5"><div class="font-black">{{ d.label }}</div><div class="text-xs font-bold text-slate-400 mt-1">{{ d.blurb }}</div></div> }</div>
    <div class="space-y-2">
      @for (s of staff(); track s.id) {
        <fieldset class="flex flex-wrap items-center gap-4 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
          <legend class="sr-only">Additional charges of {{ s.name }}</legend>
          <span class="font-black flex-1 min-w-40">{{ s.name }} <span class="text-xs text-slate-400">({{ s.username }})</span></span>
          @for (d of duties(); track d.key) { <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" [checked]="s.duties.includes(d.key)" (change)="toggle(s, d.key)"> {{ d.label }}</label> }
        </fieldset>
      } @empty { <p class="p-10 text-center text-sm font-bold text-slate-400">There are no active teachers with a login yet.</p> }
    </div>

    <section class="space-y-3">
      <h3 class="text-2xl font-black tracking-tight">Teacher logins</h3>
      <p class="text-sm font-bold text-slate-400">A teacher sees "My Home" only when their login is connected to their teacher record. @if (unlinked() > 0) { <span class="text-rose-500">{{ unlinked() }} teacher(s) below have no login connected.</span> }</p>
      @for (t of links(); track t.id) {
        <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span class="font-black flex-1 min-w-40">{{ t.name }}</span>
          @if (t.user_id) { <span class="text-sm font-bold text-emerald-600">Login: {{ t.username }}</span><button type="button" class="btn-ghost" (click)="unlink(t.id)">Disconnect</button> }
          @else {
            <select class="field max-w-56" [attr.aria-label]="'Existing login for ' + t.name" [ngModel]="pick()[t.id] ?? null" (ngModelChange)="setPick(t.id, $event)"><option [ngValue]="null">Choose an existing login…</option>@for (u of free(); track u.id) { <option [ngValue]="u.id">{{ u.name }} ({{ u.username }})</option> }</select>
            <button type="button" class="btn-ghost" [disabled]="!pick()[t.id]" (click)="link(t.id)">Connect</button>
            <span class="text-xs font-bold text-slate-400">or make a new login in Timetable → Teachers</span>
          }
        </div>
      }
    </section>
  </div>
  `
})
export class Duties {
  private api = inject(Api); private toast = inject(ToastService);
  duties = signal<Duty[]>([]); staff = signal<Staff[]>([]); error = signal('');
  links = signal<{ id: number; name: string; user_id: number | null; username: string | null }[]>([]); free = signal<{ id: number; name: string; username: string }[]>([]); unlinked = signal(0); pick = signal<Record<number, number | null>>({});
  setPick(t: number, u: number | null) { this.pick.update(p => ({ ...p, [t]: u })); }
  loadLinks() { this.api.get<{ teachers: any[]; freeLogins: any[]; unlinked: number }>('/timetable/teacher-links').subscribe({ next: r => { this.links.set(r.teachers); this.free.set(r.freeLogins); this.unlinked.set(r.unlinked); this.pick.set({}); }, error: e => this.error.set(errorText(e)) }); }
  link(t: number) { this.api.post(`/timetable/teachers/${t}/link`, { user_id: this.pick()[t] }).subscribe({ next: () => { this.toast.show('Connected.'); this.loadLinks(); this.reloadStaff(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  unlink(t: number) { if (!confirm('Disconnect this login from the teacher?')) return; this.api.post(`/timetable/teachers/${t}/unlink`, {}).subscribe({ next: () => { this.loadLinks(); this.reloadStaff(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  reloadStaff() { this.api.get<{ duties: Duty[]; staff: Staff[] }>('/duties').subscribe(r => this.staff.set(r.staff)); }
  constructor() { this.loadLinks(); this.api.get<{ duties: Duty[]; staff: Staff[] }>('/duties').subscribe({ next: r => { this.duties.set(r.duties); this.staff.set(r.staff); }, error: e => this.error.set(errorText(e)) }); }
  toggle(s: Staff, key: string) {
    const next = s.duties.includes(key) ? s.duties.filter(d => d !== key) : [...s.duties, key];
    this.api.put<{ duties: string[] }>(`/duties/${s.id}`, { duties: next }).subscribe({
      next: r => { this.staff.update(l => l.map(x => (x.id === s.id ? { ...x, duties: r.duties } : x))); this.toast.show(`Saved for ${s.name}.`); },
      error: e => { this.toast.show(errorText(e), 'error'); this.staff.update(l => [...l]); }
    });
  }
}
