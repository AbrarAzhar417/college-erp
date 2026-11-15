import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { DAY_NAMES, TtData } from './tt';

interface Diff { a: { label: string; at: string | null; lessons: number }; b: { label: string; at: string | null; lessons: number }; summary: { changed: number; added: number; removed: number; sections: number }; sections: { label: string; changes: { day: number; period: number; from: string | null; to: string | null }[] }[]; teachers: { name: string; from: number; to: number }[] }
interface Version { id: number; at: string; kind: 'auto' | 'edit' | 'manual'; label: string | null; slots: number; by: string | null }
const KIND: Record<string, string> = { auto: 'Automatic', edit: 'Before a hand edit', manual: 'Saved by you' };

@Component({
  selector: 'app-tt-versions',
  imports: [FormsModule],
  template: `
  <div class="space-y-6 max-w-4xl">
    <p class="text-sm font-bold text-slate-500">Every publish, clear and hand edit keeps a copy of the timetable as it was. You can also save a named copy (for example "Term 2 plan"), go back to any copy, or undo the last hand edit.</p>
    <div class="flex flex-wrap gap-3 items-center">
      <input class="field max-w-xs" aria-label="Name for this copy" placeholder="Name for this copy" maxlength="80" [(ngModel)]="label">
      <button type="button" class="btn-primary" (click)="save()">Save a copy now</button>
      <button type="button" class="btn-ghost" (click)="undo()">Undo last hand edit</button>
    </div>
    @if (confirmId() !== null) {
      <div class="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm font-bold" role="alert">
        {{ warning() }}
        <div class="mt-3 flex gap-3"><button type="button" class="btn-primary" (click)="restore(confirmId()!, true)">Restore anyway</button><button type="button" class="btn-ghost" (click)="confirmId.set(null)">Cancel</button></div>
      </div>
    }
    <div class="rounded-[2rem] border border-slate-200 dark:border-slate-800 p-5 bg-white dark:bg-slate-900/40 space-y-4">
      <h3 class="font-black">Compare two copies</h3>
      <div class="flex flex-wrap gap-3 items-end">
        <div><label class="label" for="cmp-a">Older</label><select id="cmp-a" class="field" [ngModel]="cmpA()" (ngModelChange)="cmpA.set($event)"><option value="">Choose</option>@for (v of list(); track v.id) { <option [value]="'' + v.id">{{ v.at }} · {{ v.label || kind(v.kind) }}</option> }</select></div>
        <div><label class="label" for="cmp-b">Newer</label><select id="cmp-b" class="field" [ngModel]="cmpB()" (ngModelChange)="cmpB.set($event)"><option value="">Choose</option><option value="current">Timetable now</option>@for (v of list(); track v.id) { <option [value]="'' + v.id">{{ v.at }} · {{ v.label || kind(v.kind) }}</option> }</select></div>
        <button type="button" class="btn-primary" [disabled]="!cmpA() || !cmpB() || cmpA() === cmpB()" (click)="compare()">Show changes</button>
      </div>
      @if (diff(); as d) {
        <p class="text-sm font-black">{{ d.summary.changed }} changed, {{ d.summary.added }} added, {{ d.summary.removed }} removed, in {{ d.summary.sections }} class(es). <span class="text-slate-400 font-bold">({{ d.a.label }}: {{ d.a.lessons }} lessons → {{ d.b.label }}: {{ d.b.lessons }} lessons)</span></p>
        @if (!d.sections.length) { <p class="text-sm font-bold text-emerald-600">These two are the same.</p> }
        @for (s of d.sections; track s.label) {
          <div><p class="font-black text-sm mb-1">{{ s.label }}</p>
            <ul class="text-xs font-bold space-y-0.5">@for (c of s.changes; track $index) { <li><span class="text-slate-400">{{ dayName(c.day) }}, period {{ c.period + 1 }}:</span> <span class="text-rose-600">{{ c.from || 'empty' }}</span> → <span class="text-emerald-600">{{ c.to || 'empty' }}</span></li> }</ul></div>
        }
        @if (d.teachers.length) { <div><p class="font-black text-sm mb-1">Teacher load changes</p><p class="text-xs font-bold text-slate-500">@for (t of d.teachers; track t.name) { <span class="mr-3">{{ t.name }} {{ t.from }}→{{ t.to }}</span> }</p></div> }
      }
    </div>
    <div class="bg-white dark:bg-slate-900/40 rounded-[2rem] border border-slate-200 dark:border-slate-800 overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
          <th class="px-6 py-4">When</th><th class="px-3 py-4">Type</th><th class="px-3 py-4">Name</th><th class="px-3 py-4">Lessons</th><th class="px-6 py-4 text-right">Actions</th></tr></thead>
        <tbody>
          @for (v of list(); track v.id) {
            <tr class="border-b border-slate-50 dark:border-slate-800/60">
              <td class="px-6 py-3 font-bold whitespace-nowrap">{{ v.at }}<p class="text-[11px] text-slate-400">{{ v.by || '' }}</p></td>
              <td class="px-3 py-3 font-bold">{{ kind(v.kind) }}</td><td class="px-3 py-3 font-black">{{ v.label || '—' }}</td><td class="px-3 py-3 font-bold">{{ v.slots }}</td>
              <td class="px-6 py-3 text-right whitespace-nowrap">
                <button type="button" class="btn-ghost" (click)="restore(v.id, false)">Restore</button>
                @if (v.kind === 'manual') { <button type="button" class="btn-ghost text-rose-600" (click)="remove(v.id)">Delete</button> }
              </td>
            </tr>
          } @empty { <tr><td colspan="5" class="px-6 py-8 text-center font-bold text-slate-400">No copies yet.</td></tr> }
        </tbody>
      </table>
    </div>
  </div>
  `
})
export class TtVersions {
  private api = inject(Api);
  private toast = inject(ToastService);
  private tt = inject(TtData);
  list = signal<Version[]>([]);
  label = '';
  confirmId = signal<number | null>(null);
  warning = signal('');
  kind = (k: string) => KIND[k] ?? k;
  dayName = (d: number) => DAY_NAMES[d];
  cmpA = signal(''); cmpB = signal('current'); diff = signal<Diff | null>(null);
  compare() { this.api.get<Diff>('/timetable/versions/compare', { wing: this.tt.wing(), a: this.cmpA(), b: this.cmpB() }).subscribe({ next: r => this.diff.set(r), error: e => this.toast.show(errorText(e), 'error') }); }

  constructor() { this.load(); }
  load() { this.api.get<Version[]>('/timetable/versions', { wing: this.tt.wing() }).subscribe({ next: r => this.list.set(r), error: e => this.toast.show(errorText(e), 'error') }); }
  save() {
    this.api.post('/timetable/versions', { wing: this.tt.wing(), label: this.label }).subscribe({
      next: () => { this.label = ''; this.toast.show('Copy saved.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  restore(id: number, force: boolean) {
    this.api.post<{ slots: number }>(`/timetable/versions/${id}/restore`, { force }).subscribe({
      next: r => { this.confirmId.set(null); this.toast.show(`Restored (${r.slots} lessons).`); this.load(); },
      error: e => { if (e?.status === 409 && e.error?.needsConfirm) { this.confirmId.set(id); this.warning.set(e.error.message); } else this.toast.show(errorText(e), 'error'); }
    });
  }
  undo() { this.api.post('/timetable/undo', { wing: this.tt.wing() }).subscribe({ next: () => { this.toast.show('Last hand edit undone.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  remove(id: number) { if (!confirm('Delete this saved copy?')) return; this.api.delete(`/timetable/versions/${id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
