import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ExamCfg } from './exam';

@Component({
  selector: 'app-exam-settings',
  imports: [FormsModule],
  template: `
  @if (cfg(); as c) {
  <form (ngSubmit)="save()" class="max-w-4xl space-y-8">
    @if (!auth.isLeadership()) { <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm font-bold">Only the director or principal can change these settings.</p> }
    <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <h3 class="text-xl font-black tracking-tight">Session and rules</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div><label class="label" for="s1">Current session</label><input id="s1" name="s1" class="field" [(ngModel)]="c.session"></div>
        <div><label class="label" for="s2">Session start date (attendance is counted from here)</label><input id="s2" name="s2" type="date" class="field" [(ngModel)]="c.session_start"></div>
        <div><label class="label" for="s3">Call parents when percentage falls by (points)</label><input id="s3" name="s3" type="number" min="1" max="50" class="field" [(ngModel)]="c.drop_pct"></div>
        <div><label class="label" for="s4">Minimum attendance for board admission (%)</label><input id="s4" name="s4" type="number" min="0" max="100" class="field" [(ngModel)]="c.board_min_att"></div>
      </div>
    </section>
    <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <div><h3 class="text-xl font-black tracking-tight">Student categories and meeting places</h3><p class="text-sm font-bold text-slate-400 mt-1">Parent meetings are called at the place of the student's category. Change the wording here if needed.</p></div>
      @for (k of cats; track k) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label class="label" [for]="'cl' + k">Category {{ k }}</label><input [id]="'cl' + k" [name]="'cl' + k" class="field" [(ngModel)]="c.categories[k].label"></div>
          <div><label class="label" [for]="'cv' + k">Meeting place for {{ k }}</label><input [id]="'cv' + k" [name]="'cv' + k" class="field" [(ngModel)]="c.categories[k].venue"></div></div>
      }
    </section>
    <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <div><h3 class="text-xl font-black tracking-tight">Grades</h3><p class="text-sm font-bold text-slate-400 mt-1">A student gets the grade of the highest row whose minimum percentage is reached.</p></div>
      @for (g of c.grade_scale; track $index; let i = $index) {
        <div class="flex items-center gap-3"><span class="text-sm font-bold text-slate-500 w-16">From</span><input type="number" min="0" max="100" class="field !w-28 !py-2.5" [(ngModel)]="g.min" [name]="'gm' + i" aria-label="Minimum percentage"><span class="text-sm font-bold text-slate-500">% grade</span><input class="field !w-28 !py-2.5" [(ngModel)]="g.grade" [name]="'gg' + i" aria-label="Grade"><button type="button" class="text-xs font-black text-rose-500" (click)="removeGrade(i)">Remove</button></div>
      }
      <button type="button" class="btn-ghost" (click)="c.grade_scale.push({ min: 0, grade: '' })">Add a grade</button>
    </section>
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    <button class="btn-primary" type="submit" [disabled]="!auth.isLeadership()">Save settings</button>
  </form>
  }
  `
})
export class ExamSettings {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  cats = ['A', 'B', 'C'] as const;
  cfg = signal<ExamCfg | null>(null); error = signal('');
  constructor() { this.api.get<ExamCfg>('/exam/config').subscribe(c => this.cfg.set(c)); }
  removeGrade(i: number) { this.cfg()!.grade_scale.splice(i, 1); }
  save() {
    this.error.set('');
    this.api.put<ExamCfg>('/exam/config', this.cfg()).subscribe({ next: () => this.toast.show('Settings saved.'), error: e => this.error.set(errorText(e)) });
  }
}
