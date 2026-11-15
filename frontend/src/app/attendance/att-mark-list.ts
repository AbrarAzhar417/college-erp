import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttPicker } from './att-picker';
import { MarkRow, STATUS_LIST, Status } from './att';

@Component({
  selector: 'att-mark-list',
  imports: [FormsModule, AttPicker],
  template: `
  <div class="flex flex-wrap items-center gap-3 mb-5">
    @for (s of list; track s.key) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800"><i class="inline-block w-2 h-2 rounded-full mr-2" [class]="s.dot"></i>{{ s.label }} {{ counts()[s.key] }}</span> }
    @if (counts()['none']) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-500/10 text-rose-600">Not chosen {{ counts()['none'] }}</span> }
    <button type="button" class="btn-ghost !py-2.5 ml-auto" (click)="allPresent()" [disabled]="disabled()">Mark all present</button>
  </div>
  <ul class="space-y-2">
    @for (r of rows(); track r.id) {
      <li class="flex flex-wrap items-center gap-3 p-3 pl-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50" [class.ring-2]="!r.status" [class.ring-rose-400]="!r.status">
        <span class="w-8 text-xs font-black text-slate-400">{{ r.roll_no ?? '-' }}</span>
        <span class="flex-1 min-w-44">
          <span class="block text-sm font-black">{{ r.name }}</span>
          <span class="block text-[11px] font-bold text-slate-400">S/O {{ r.father_name }}@if (r.onLeave) { <span class="ml-2 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300">On leave: {{ r.onLeave }}</span> }</span>
        </span>
        @if (showNote() && (r.status === 'A' || r.status === 'L')) {
          <input class="field !py-2 !w-44 !text-xs" placeholder="Note (optional)" [attr.aria-label]="'Note for ' + r.name" [ngModel]="r.note" (ngModelChange)="setNote(r.id, $event)" [disabled]="disabled()">
        }
        <att-picker [value]="r.status" [disabled]="disabled()" (pick)="set(r.id, $event)" />
      </li>
    }
  </ul>
  `
})
export class AttMarkList {
  rows = model.required<MarkRow[]>();
  disabled = input(false);
  showNote = input(true);
  list = STATUS_LIST;
  counts = computed(() => {
    const c: Record<string, number> = { P: 0, A: 0, L: 0, LT: 0, none: 0 };
    for (const r of this.rows()) c[r.status ?? 'none']++;
    return c;
  });
  set(id: number, status: Status) { this.rows.set(this.rows().map(r => (r.id === id ? { ...r, status } : r))); }
  setNote(id: number, note: string) { this.rows.set(this.rows().map(r => (r.id === id ? { ...r, note } : r))); }
  allPresent() { this.rows.set(this.rows().map(r => ({ ...r, status: r.onLeave ? 'L' : 'P' }) as MarkRow)); }
}
