import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ClassInfo } from '../core/models';

@Component({
  selector: 'app-classes',
  imports: [RouterLink],
  template: `
  <div class="space-y-8 pb-16 max-w-7xl mx-auto">
    <div>
      <h2 class="text-3xl font-black tracking-tighter">Classes & sections</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Choose a section to see its students.</p>
    </div>

    @if (error()) {
      <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-sm">{{ error() }}</p>
    }

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-8">
      @for (c of classes(); track c.id) {
        <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <div class="flex items-start justify-between gap-4 mb-6">
            <div>
              <h3 class="text-2xl font-black tracking-tight">{{ c.name }}</h3>
              <p class="text-xs font-bold text-slate-400 mt-1">{{ c.total }} students</p>
            </div>
            <span class="px-4 py-2 rounded-xl text-xs font-black"
                  [class]="c.stage === 'HSSC' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400'">{{ c.stage }}</span>
          </div>
          <div class="grid grid-cols-5 gap-2">
            @for (s of c.sections; track s.id) {
              <a [routerLink]="['/students']" [queryParams]="{ classId: c.id, sectionId: s.id }"
                 class="flex flex-col items-center py-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50 hover:bg-indigo-600 hover:text-white group transition-all"
                 [attr.aria-label]="c.name + ' section ' + s.name + ', ' + s.students + ' students'">
                <span class="text-lg font-black">{{ s.name }}</span>
                <span class="text-[11px] font-bold text-slate-400 group-hover:text-indigo-100">{{ s.students }}</span>
              </a>
            }
          </div>
        </section>
      }
    </div>
  </div>
  `
})
export class Classes {
  classes = signal<ClassInfo[]>([]);
  error = signal('');
  constructor() {
    inject(Api).get<ClassInfo[]>('/classes').subscribe({
      next: c => this.classes.set(c),
      error: e => this.error.set(errorText(e))
    });
  }
}
