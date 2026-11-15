import { Component, input, output } from '@angular/core';
import { LucideAngularModule, Lock } from 'lucide-angular';
import { Cell, DAY_NAMES, Period } from './tt';

@Component({
  selector: 'tt-grid',
  imports: [LucideAngularModule],
  template: `
  <div class="overflow-x-auto">
    <table class="w-full min-w-[720px] border-separate border-spacing-1.5 text-sm">
      <thead>
        <tr>
          <th class="w-24"></th>
          @for (d of days(); track d) { <th class="py-2 text-[11px] font-black text-slate-400 uppercase tracking-widest">{{ dayName(d) }}</th> }
        </tr>
      </thead>
      <tbody>
        @for (p of periods(); track $index; let pi = $index) {
          @if (breakAfter() > 0 && pi === breakAfter()) {
            <tr><td colspan="99" class="py-1 text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] bg-slate-100 dark:bg-slate-800/60 rounded-xl">Break</td></tr>
          }
          <tr>
            <th class="pr-2 text-left align-middle">
              <p class="text-xs font-black">Period {{ pi + 1 }}</p>
              <p class="text-[10px] font-bold text-slate-400">{{ p.start }}</p>
            </th>
            @for (d of days(); track d) {
              @let c = cells().get(d + '-' + pi);
              <td class="p-0 align-top">
                @if (c) {
                  <button type="button" [disabled]="!editable()" (click)="cellClick.emit({ day: d, period: pi })"
                          class="tt-cell w-full h-full min-h-[3.5rem] rounded-xl px-3 py-2 text-left transition-all relative" [style.--h]="c.hue"
                          [class.opacity-60]="c.cont" [class.ring-4]="selected() === d + '-' + pi" [class.ring-indigo-500]="selected() === d + '-' + pi"
                          [class.cursor-default]="!editable()">
                    <span class="block text-xs font-black leading-tight">{{ c.title }}{{ c.cont ? ' (double)' : '' }}</span>
                    <span class="block text-[11px] font-bold opacity-80 leading-tight mt-0.5">{{ c.sub }}</span>
                    @if (c.locked) { <lucide-icon [img]="lockIcon" [size]="12" class="absolute top-2 right-2 opacity-70" /> }
                  </button>
                } @else {
                  <button type="button" [disabled]="!editable()" (click)="cellClick.emit({ day: d, period: pi })"
                          class="w-full min-h-[3.5rem] rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-300 dark:text-slate-700"
                          [class.ring-4]="selected() === d + '-' + pi" [class.ring-indigo-500]="selected() === d + '-' + pi" [class.cursor-default]="!editable()">Free</button>
                }
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
  </div>
  `
})
export class TtGrid {
  days = input.required<number[]>();
  periods = input.required<Period[]>();
  breakAfter = input(0);
  cells = input.required<Map<string, Cell>>();
  selected = input<string | null>(null);
  editable = input(false);
  cellClick = output<{ day: number; period: number }>();
  lockIcon = Lock;
  dayName = (d: number) => DAY_NAMES[d];
}
