import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, Pencil, Trash2, X } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { DAY_SHORT, Subject, Teacher, TtData } from './tt';

@Component({
  selector: 'app-tt-teachers',
  imports: [FormsModule, LucideAngularModule],
  template: `
  <div class="space-y-6">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="relative md:w-96"><input class="field" type="search" placeholder="Search teachers" aria-label="Search teachers" [ngModel]="q()" (ngModelChange)="q.set($event)"></div>
      <button type="button" class="btn-primary self-start" (click)="openNew()"><lucide-icon [img]="plusIcon" [size]="16" [strokeWidth]="3" /> Add teacher</button>
    </div>

    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
          <th class="px-6 py-5">Teacher</th><th class="px-6 py-5">Can teach</th><th class="px-6 py-5">Weekly load</th><th class="px-6 py-5 text-right">Actions</th></tr></thead>
        <tbody>
          @for (t of shown(); track t.id) {
            <tr class="border-b border-slate-50 dark:border-slate-800/60">
              <td class="px-6 py-4 font-black whitespace-nowrap">{{ t.name }}<p class="text-[11px] font-bold text-slate-400">{{ t.phone || '' }}</p></td>
              <td class="px-6 py-4 font-bold text-slate-500 dark:text-slate-400">{{ subjectNames(t) }}</td>
              <td class="px-6 py-4 min-w-48">
                <div class="flex items-center gap-3">
                  <div class="flex-1 h-3 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden"><div class="h-full rounded-full" [class]="t.load > t.max_per_week ? 'bg-rose-500' : 'bg-indigo-600'" [style.width.%]="Math.min(100, (t.load / t.max_per_week) * 100)"></div></div>
                  <span class="text-xs font-black w-14 text-right">{{ t.load }}/{{ t.max_per_week }}</span>
                </div>
              </td>
              <td class="px-6 py-4 text-right whitespace-nowrap">
                <button type="button" class="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10" (click)="openEdit(t)" [attr.aria-label]="'Edit ' + t.name"><lucide-icon [img]="editIcon" [size]="16" /></button>
                <button type="button" class="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10" (click)="remove(t)" [attr.aria-label]="'Delete ' + t.name"><lucide-icon [img]="trashIcon" [size]="16" /></button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  </div>

  @if (open()) {
    <div class="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="t-title">
      <form (ngSubmit)="save()" class="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-[2.5rem] p-8 md:p-10 shadow-enterprise-lg space-y-6">
        <div class="flex items-center justify-between">
          <h3 id="t-title" class="text-2xl font-black tracking-tight">{{ editingId() ? 'Edit teacher' : 'New teacher' }}</h3>
          <button type="button" class="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" (click)="open.set(false)" aria-label="Close"><lucide-icon [img]="closeIcon" [size]="20" /></button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div><label class="label" for="tn">Name</label><input id="tn" name="tn" class="field" required [(ngModel)]="f.name"></div>
          <div><label class="label" for="tp">Phone</label><input id="tp" name="tp" class="field" [(ngModel)]="f.phone"></div>
          <div><label class="label" for="td">Most periods per day</label><input id="td" name="td" type="number" min="1" max="12" class="field" [(ngModel)]="f.max_per_day"></div>
          <div><label class="label" for="tw">Most periods per week</label><input id="tw" name="tw" type="number" min="1" max="70" class="field" [(ngModel)]="f.max_per_week"></div>
        </div>

        <div>
          <span class="label !ml-0">Subjects this teacher can teach</span>
          <div class="flex flex-wrap gap-2">
            @for (s of subjects(); track s.id) {
              <button type="button" (click)="toggleSubject(s.id)" class="px-4 py-2 rounded-xl text-xs font-black transition-all"
                      [class]="f.subjects.includes(s.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ s.name }}</button>
            }
          </div>
        </div>

        @if (tt.settings(); as s) {
          <div>
            <span class="label !ml-0">Not available (tap to block a period)</span>
            <div class="overflow-x-auto">
              <table class="border-separate border-spacing-1">
                <thead><tr><th></th>@for (d of s.days; track d) { <th class="text-[10px] font-black text-slate-400">{{ short(d) }}</th> }</tr></thead>
                <tbody>
                  @for (p of periodRange(); track p) {
                    <tr>
                      <th class="pr-2 text-[10px] font-black text-slate-400 text-left">P{{ p + 1 }}</th>
                      @for (d of s.days; track d) {
                        <td><button type="button" (click)="toggleBlock(d, p)" [attr.aria-label]="short(d) + ' period ' + (p + 1) + (blocked(d, p) ? ' blocked' : ' free')"
                                    class="w-10 h-8 rounded-lg text-[10px] font-black" [class]="blocked(d, p) ? 'bg-rose-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'">{{ blocked(d, p) ? 'No' : '' }}</button></td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        @if (editingId()) {
          <div class="p-5 rounded-[1.8rem] bg-slate-50 dark:bg-slate-950/50 space-y-3">
            <span class="label !ml-0">Login account (so the teacher can take attendance)</span>
            <p class="text-xs font-bold text-slate-400">{{ currentUsername() ? 'Username: ' + currentUsername() + '. Type a new password to reset it.' : 'No login yet. Choose a username and password.' }}</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              @if (!currentUsername()) { <div><label class="label" for="au">Username</label><input id="au" name="au" class="field !py-2.5" [(ngModel)]="acct.username" autocomplete="off"></div> }
              <div><label class="label" for="ap">Password (8+ characters)</label><input id="ap" name="ap" type="password" class="field !py-2.5" [(ngModel)]="acct.password" autocomplete="new-password"></div>
              <button type="button" class="btn-ghost" (click)="saveAccount()">{{ currentUsername() ? 'Reset password' : 'Create login' }}</button>
            </div>
          </div>
        }
        @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
        <div class="flex justify-end gap-3">
          <button type="button" class="btn-ghost" (click)="open.set(false)">Cancel</button>
          <button type="submit" class="btn-primary">{{ editingId() ? 'Save changes' : 'Add teacher' }}</button>
        </div>
      </form>
    </div>
  }
  `
})
export class TtTeachers {
  private api = inject(Api);
  private toast = inject(ToastService);
  tt = inject(TtData);
  Math = Math;
  plusIcon = Plus; editIcon = Pencil; trashIcon = Trash2; closeIcon = X;

  teachers = signal<Teacher[]>([]);
  subjects = signal<Subject[]>([]);
  q = signal('');
  shown = computed(() => this.teachers().filter(t => t.name.toLowerCase().includes(this.q().trim().toLowerCase())));
  open = signal(false);
  editingId = signal<number | null>(null);
  error = signal('');
  acct = { username: '', password: '' };
  currentUsername = signal<string | null>(null);
  f = { name: '', phone: '', max_per_day: 6, max_per_week: 30, subjects: [] as number[], blocks: new Set<string>() };

  constructor() {
    this.load();
    this.api.get<Subject[]>('/timetable/subjects').subscribe(s => this.subjects.set(s));
  }
  load() { this.api.get<Teacher[]>('/timetable/teachers').subscribe(t => this.teachers.set(t)); }

  short = (d: number) => DAY_SHORT[d];
  periodRange = () => Array.from({ length: this.tt.settings()?.periodCount ?? 0 }, (_, i) => i);
  subjectNames(t: Teacher) { const m = new Map(this.subjects().map(s => [s.id, s.name])); return t.subjects.map(id => m.get(id)).filter(Boolean).join(', ') || 'None yet'; }
  blocked = (d: number, p: number) => this.f.blocks.has(`${d}-${p}`);
  toggleBlock(d: number, p: number) { const k = `${d}-${p}`; this.f.blocks.has(k) ? this.f.blocks.delete(k) : this.f.blocks.add(k); this.f = { ...this.f }; }
  toggleSubject(id: number) { this.f.subjects = this.f.subjects.includes(id) ? this.f.subjects.filter(x => x !== id) : [...this.f.subjects, id]; }

  openNew() { this.f = { name: '', phone: '', max_per_day: 6, max_per_week: 30, subjects: [], blocks: new Set() }; this.editingId.set(null); this.error.set(''); this.open.set(true); }
  openEdit(t: Teacher) {
    this.f = { name: t.name, phone: t.phone ?? '', max_per_day: t.max_per_day, max_per_week: t.max_per_week, subjects: [...t.subjects], blocks: new Set(t.unavailable.map(u => `${u.day}-${u.period}`)) };
    this.editingId.set(t.id); this.error.set(''); this.acct = { username: '', password: '' }; this.currentUsername.set(t.username ?? null); this.open.set(true);
  }

  save() {
    const body = {
      name: this.f.name, phone: this.f.phone, max_per_day: this.f.max_per_day, max_per_week: this.f.max_per_week, subjects: this.f.subjects,
      unavailable: [...this.f.blocks].map(k => { const [day, period] = k.split('-').map(Number); return { day, period }; })
    };
    const id = this.editingId();
    const req = id ? this.api.put<{ warning?: string }>(`/timetable/teachers/${id}`, body) : this.api.post<{ warning?: string }>('/timetable/teachers', body);
    req.subscribe({
      next: r => { this.open.set(false); this.load(); this.toast.show(r?.warning ?? (id ? 'Teacher updated.' : 'Teacher added.'), r?.warning ? 'error' : 'ok'); },
      error: e => this.error.set(errorText(e))
    });
  }
  saveAccount() {
    const id = this.editingId(); if (!id) return;
    this.error.set('');
    this.api.post<{ username: string; reset: boolean }>(`/timetable/teachers/${id}/account`, this.acct).subscribe({
      next: r => { this.currentUsername.set(r.username); this.acct = { username: '', password: '' }; this.toast.show(r.reset ? 'Password reset.' : `Login created. Username: ${r.username}`); this.load(); },
      error: e => this.error.set(errorText(e))
    });
  }
  remove(t: Teacher) {
    if (!confirm(`Remove ${t.name}?`)) return;
    this.api.delete(`/timetable/teachers/${t.id}`).subscribe({ next: () => { this.load(); this.toast.show('Teacher removed.'); }, error: e => this.toast.show(errorText(e), 'error') });
  }
}
