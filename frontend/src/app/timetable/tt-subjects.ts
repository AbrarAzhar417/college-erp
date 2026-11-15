import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { Subject } from './tt';

@Component({
  selector: 'app-tt-subjects',
  imports: [FormsModule],
  template: `
  <div class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-8 max-w-4xl">
    <form (ngSubmit)="add()" class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
      <div class="md:col-span-2"><label class="label" for="sn">New subject</label><input id="sn" name="sn" class="field" required [(ngModel)]="newName" placeholder="e.g. Chemistry"></div>
      <label class="flex items-center gap-3 text-sm font-bold pb-4"><input type="checkbox" name="sh" [(ngModel)]="newHeavy" class="w-5 h-5 accent-indigo-600"> Demanding (prefer morning)</label>
      <button class="btn-primary" type="submit">Add subject</button>
    </form>
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }

    <div class="space-y-3">
      @for (s of list(); track s.id) {
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
          <input class="field md:col-span-4" [(ngModel)]="s.name" [attr.aria-label]="'Name of ' + s.name">
          <input class="field md:col-span-2" [(ngModel)]="s.code" placeholder="Code" aria-label="Code">
          <label class="md:col-span-3 flex items-center gap-3 text-xs font-bold">
            <input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="!!s.heavy" (ngModelChange)="s.heavy = $event ? 1 : 0"> Demanding
          </label>
          <label class="md:col-span-3 flex items-center gap-3 text-xs font-bold" title="No more than two science lessons in a row in one class">
            <input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="!!s.science" (ngModelChange)="s.science = $event ? 1 : 0"> Science (max 2 in a row)
          </label>
          <div class="md:col-span-6 flex gap-2 justify-end">
            <button type="button" class="btn-ghost !py-3" (click)="save(s)">Save</button>
            <button type="button" class="btn-ghost !py-3 !text-rose-500" (click)="remove(s)">Delete</button>
          </div>
          <p class="md:col-span-12 text-[11px] font-bold text-slate-400">Used in {{ s.sections }} sections · {{ s.teachers }} teachers can teach it</p>
        </div>
      }
    </div>
  </div>
  `
})
export class TtSubjects {
  private api = inject(Api);
  private toast = inject(ToastService);
  list = signal<Subject[]>([]);
  error = signal('');
  newName = ''; newHeavy = false;

  constructor() { this.load(); }
  load() { this.api.get<Subject[]>('/timetable/subjects').subscribe(l => this.list.set(l)); }

  add() {
    this.error.set('');
    this.api.post('/timetable/subjects', { name: this.newName, heavy: this.newHeavy }).subscribe({
      next: () => { this.newName = ''; this.newHeavy = false; this.load(); this.toast.show('Subject added.'); },
      error: e => this.error.set(errorText(e))
    });
  }
  save(s: Subject) {
    this.api.put(`/timetable/subjects/${s.id}`, { name: s.name, code: s.code, heavy: s.heavy, science: s.science }).subscribe({
      next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error')
    });
  }
  remove(s: Subject) {
    if (!confirm(`Delete ${s.name}?`)) return;
    this.api.delete(`/timetable/subjects/${s.id}`).subscribe({
      next: () => { this.load(); this.toast.show('Deleted.'); }, error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
