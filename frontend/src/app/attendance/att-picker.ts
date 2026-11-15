import { Component, input, output } from '@angular/core';
import { STATUS_LIST, Status } from './att';

@Component({
  selector: 'att-picker',
  template: `
  <div class="inline-flex gap-1" role="group">
    @for (s of list; track s.key) {
      <button type="button" [disabled]="disabled()" (click)="pick.emit(s.key)" [attr.aria-pressed]="value() === s.key" [attr.aria-label]="s.label" [title]="s.label"
              class="w-11 h-10 rounded-xl text-xs font-black transition-all disabled:opacity-50"
              [class]="value() === s.key ? s.on : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'">{{ s.short }}</button>
    }
  </div>
  `
})
export class AttPicker {
  value = input<Status | null>(null);
  disabled = input(false);
  pick = output<Status>();
  list = STATUS_LIST;
}
