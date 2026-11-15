import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { DAY_NAMES, Period, TTSettings, TtData } from './tt';

@Component({
  selector: 'app-tt-config',
  imports: [FormsModule],
  template: `
  <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-8 max-w-4xl">
    <div>
      <span class="label !ml-0">School days</span>
      <div class="flex flex-wrap gap-2">
        @for (d of dayList; track d) {
          <button type="button" (click)="toggleDay(d)" class="px-5 py-3 rounded-2xl text-sm font-black transition-all"
                  [class]="f.days.includes(d) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ name(d) }}</button>
        }
      </div>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-5">
      <div><label class="label" for="pc">Periods per day</label><input id="pc" name="pc" type="number" min="1" max="12" class="field" [(ngModel)]="f.periodCount"></div>
      <div><label class="label" for="st">First bell</label><input id="st" name="st" type="time" class="field" [(ngModel)]="f.startTime"></div>
      <div><label class="label" for="pm">Period length (minutes)</label><input id="pm" name="pm" type="number" min="15" max="120" class="field" [(ngModel)]="f.periodMinutes"></div>
      <div><label class="label" for="ba">Break after period (0 = none)</label><input id="ba" name="ba" type="number" min="0" class="field" [(ngModel)]="f.breakAfter"></div>
      <div><label class="label" for="bm">Break length (minutes)</label><input id="bm" name="bm" type="number" min="0" max="90" class="field" [(ngModel)]="f.breakMinutes"></div>
      <div><label class="label" for="tl">Weekly load target per teacher</label><input id="tl" name="tl" type="number" min="1" max="60" class="field" [(ngModel)]="f.targetLoad"></div>
    </div>
    <div>
      <span class="label !ml-0">Period times</span>
      <div class="flex flex-wrap gap-2">
        @for (p of preview(); track $index; let i = $index) {
          @if (f.breakAfter > 0 && i === f.breakAfter) { <span class="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-black">Break {{ f.breakMinutes }} min</span> }
          <span class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-black">{{ i + 1 }}: {{ p.start }} to {{ p.end }}</span>
        }
      </div>
    </div>
    <label class="flex items-start gap-3 text-sm font-bold"><input type="checkbox" name="ctf" class="mt-1" [(ngModel)]="f.classTeacherFirst"> <span>The class teacher takes the <strong>first period</strong> of every day in his or her own class (the generator places it; set the class teacher in Attendance → Class teachers).</span></label>
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    <button class="btn-primary" type="submit">Save settings for the {{ tt.wing() }} wing</button>
  </form>

  <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 space-y-4 max-w-4xl mt-8">
    <h3 class="text-xl font-black">Which classes are in which wing?</h3>
    <p class="text-sm font-bold text-slate-400">Classes 11 and 12 start in the college wing, the others in the school wing. A teacher who teaches in both wings is never booked at overlapping times.</p>
    <div class="flex flex-wrap gap-3">
      @for (c of wingRows(); track c.id) {
        <label class="flex items-center gap-2 text-sm font-bold bg-slate-500/10 rounded-xl px-3 py-2">{{ c.name }}
          <select class="field !py-1 !w-auto" [attr.aria-label]="c.name + ' wing'" [ngModel]="c.wing" (ngModelChange)="setWingOf(c.id, $event)" [ngModelOptions]="{ standalone: true }"><option value="school">School</option><option value="college">College</option></select></label>
      }
    </div>
  </section>
  `
})
export class TtConfig {
  private api = inject(Api);
  private toast = inject(ToastService);
  tt = inject(TtData);
  wingRows = signal<{ id: number; name: string; wing: string }[]>([]);
  dayList = [1, 2, 3, 4, 5, 6, 7];
  name = (d: number) => DAY_NAMES[d];
  error = signal('');
  f: TTSettings = { days: [1, 2, 3, 4, 5, 6], periodCount: 7, startTime: '08:00', periodMinutes: 40, breakAfter: 4, breakMinutes: 20 };

  constructor() {
    this.api.get<{ settings: TTSettings }>('/timetable/config', { wing: this.tt.wing() }).subscribe(r => this.f = { ...r.settings });
    this.loadWingRows();
  }
  loadWingRows() { this.api.get<{ classes: { id: number; name: string; wing: string }[] }>('/timetable/wings').subscribe(r => this.wingRows.set(r.classes)); }
  setWingOf(id: number, wing: string, force = false) {
    this.api.put('/timetable/wings', { classes: { [id]: wing }, force }).subscribe({
      next: () => { this.toast.show('Saved.'); this.loadWingRows(); this.tt.loadWings(); },
      error: e => { if (e?.status === 409 && e.error?.needsConfirm) { if (confirm(e.error.message)) this.setWingOf(id, wing, true); else this.loadWingRows(); } else { this.toast.show(errorText(e), 'error'); this.loadWingRows(); } }
    });
  }
  toggleDay(d: number) { this.f.days = this.f.days.includes(d) ? this.f.days.filter(x => x !== d) : [...this.f.days, d].sort(); }

  preview(): Period[] {
    const [h, m] = (this.f.startTime || '08:00').split(':').map(Number);
    let t = h * 60 + m; const fmt = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    const out: Period[] = [];
    for (let p = 0; p < Math.max(0, Math.min(12, Number(this.f.periodCount) || 0)); p++) {
      if (this.f.breakAfter > 0 && p === Number(this.f.breakAfter)) t += Number(this.f.breakMinutes) || 0;
      out.push({ start: fmt(t), end: fmt(t + Number(this.f.periodMinutes)) }); t += Number(this.f.periodMinutes);
    }
    return out;
  }

  save(force = false) {
    this.error.set('');
    this.api.put('/timetable/config', { ...this.f, wing: this.tt.wing(), force }).subscribe({
      next: () => { this.toast.show('Settings saved.'); this.tt.loadConfig(); },
      error: e => {
        if (e?.status === 409 && e.error?.needsConfirm) { if (confirm(e.error.message)) this.save(true); }
        else this.error.set(errorText(e));
      }
    });
  }
}
