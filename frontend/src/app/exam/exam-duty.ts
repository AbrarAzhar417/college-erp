import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { Teacher } from '../timetable/tt';
import { ToastService } from '../core/toast';
import { ExamItem } from './exam';

interface Row { date: string; section_id: number; label: string; subjects: string; invigilators: { id: number; name: string; locked: boolean; double: boolean }[] }
interface View { rows: Row[]; teachers: { id: number; name: string; duties: number; days: number; dates: string[] }[]; fairness: { teachers: number; lowest: number; highest: number; average: number } }

@Component({
  selector: 'app-exam-duty',
  imports: [FormsModule],
  template: `
  <div class="space-y-6">
    <section class="no-print bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 space-y-4">
      <div><h3 class="text-xl font-black tracking-tight">Invigilation duty roster</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Every room that has a paper on a date gets invigilators, shared out so each teacher has about the same number of duties. A teacher is never put in the room of a paper they set, never on a day they are on leave or absent, and not in two rooms on one day unless there is nobody else. Duties you fix by hand stay when you make the roster again.</p></div>
      <div class="flex flex-wrap gap-3 items-end">
        <div><label class="label" for="ed-exam">Exam</label><select id="ed-exam" class="field" [ngModel]="examId()" (ngModelChange)="examId.set($event); load()"><option [ngValue]="0">Choose exam</option>@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }})</option> }</select></div>
        <div><label class="label" for="ed-per">Invigilators per room</label><select id="ed-per" class="field" [ngModel]="per()" (ngModelChange)="per.set(+$event)"><option [ngValue]="1">1</option><option [ngValue]="2">2</option><option [ngValue]="3">3</option></select></div>
        <button type="button" class="btn-primary" [disabled]="!examId() || busy()" (click)="generate()">Make roster</button>
        <button type="button" class="btn-ghost" [disabled]="!view()?.rows?.length" (click)="print()">Print</button>
      </div>
      @if (note()) { <p class="p-3 rounded-2xl bg-amber-500/10 text-amber-700 font-bold text-sm" role="status">{{ note() }}</p> }
      @if (error()) { <p role="alert" class="p-3 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    </section>

    @if (view(); as v) {
      @if (!v.rows.length) { <p class="text-sm font-bold text-slate-400">This exam has no papers with a date yet. Give each paper a date in the exam's paper list first.</p> }
      @else {
        <p class="text-sm font-black">Duties per teacher: lowest {{ v.fairness.lowest }}, highest {{ v.fairness.highest }}, average {{ v.fairness.average }} ({{ v.fairness.teachers }} teachers).</p>
        @for (d of dates(); track d) {
          <section class="break-inside-avoid-page">
            <h4 class="font-black mb-2">{{ d }}</h4>
            <div class="overflow-x-auto"><table class="w-full text-sm border-collapse">
              <thead><tr class="text-left text-[11px] font-black uppercase tracking-widest text-slate-400"><th class="border border-slate-300 dark:border-slate-700 px-3 py-2">Room (class)</th><th class="border border-slate-300 dark:border-slate-700 px-3 py-2">Papers</th><th class="border border-slate-300 dark:border-slate-700 px-3 py-2">Invigilators</th><th class="border border-slate-300 dark:border-slate-700 px-3 py-2 w-32">Signature</th><th class="border border-slate-300 dark:border-slate-700 px-3 py-2 no-print">Change</th></tr></thead>
              <tbody>@for (r of rowsOf(d); track r.section_id) {
                <tr><td class="border border-slate-300 dark:border-slate-700 px-3 py-2 font-black">{{ r.label }}</td><td class="border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-bold text-slate-500">{{ r.subjects }}</td>
                  <td class="border border-slate-300 dark:border-slate-700 px-3 py-2 font-bold">@for (i of r.invigilators; track i.id) { <span class="inline-block mr-2">{{ i.name }}{{ i.locked ? ' 📌' : '' }}{{ i.double ? ' (2nd room today)' : '' }}</span> } @empty { <span class="text-rose-600">Nobody free</span> }</td>
                  <td class="border border-slate-300 dark:border-slate-700 px-3 py-2"></td>
                  <td class="border border-slate-300 dark:border-slate-700 px-3 py-2 no-print">
                    <select class="field !py-1.5 text-xs" [attr.aria-label]="'Invigilator for ' + r.label" [ngModel]="r.invigilators[0]?.id ?? 0" (ngModelChange)="setOne(r, $event)"><option [ngValue]="0">—</option>@for (t of teachers(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }</select></td></tr> }</tbody></table></div>
          </section>
        }
        <section class="break-inside-avoid-page">
          <h4 class="font-black mb-2">Each teacher's duties</h4>
          <div class="overflow-x-auto"><table class="w-full text-sm border-collapse"><thead><tr class="text-left text-[11px] font-black uppercase tracking-widest text-slate-400"><th class="border border-slate-300 dark:border-slate-700 px-3 py-2">Teacher</th><th class="border border-slate-300 dark:border-slate-700 px-3 py-2">Duties</th><th class="border border-slate-300 dark:border-slate-700 px-3 py-2">Dates</th></tr></thead>
            <tbody>@for (t of v.teachers; track t.id) { <tr><td class="border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-black">{{ t.name }}</td><td class="border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-bold">{{ t.duties }}</td><td class="border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-500">{{ t.dates.join(', ') }}</td></tr> }</tbody></table></div>
        </section>
      }
    }
  </div>
  `
})
export class ExamDuty {
  private api = inject(Api);
  private toast = inject(ToastService);
  exams = signal<ExamItem[]>([]); teachers = signal<Teacher[]>([]);
  examId = signal(0); per = signal(1); view = signal<View | null>(null); busy = signal(false); error = signal(''); note = signal('');
  dates = computed(() => [...new Set((this.view()?.rows ?? []).map(r => r.date))]);
  rowsOf = (d: string) => (this.view()?.rows ?? []).filter(r => r.date === d);

  constructor() {
    this.api.get<ExamItem[]>('/exam/exams').subscribe({ next: r => this.exams.set(r), error: e => this.error.set(errorText(e)) });
    this.api.get<Teacher[]>('/timetable/teachers').subscribe({ next: r => this.teachers.set(r) });
  }
  load() { this.note.set(''); this.error.set(''); this.view.set(null); if (this.examId()) this.api.get<View>('/exam-duty', { exam_id: this.examId() }).subscribe({ next: r => this.view.set(r), error: e => this.error.set(errorText(e)) }); }
  generate() {
    this.busy.set(true); this.error.set('');
    this.api.post<View & { assigned: number; doubled: number; unfilled: { date: string; label: string; missing: number }[] }>('/exam-duty/generate', { exam_id: this.examId(), per_room: this.per() }).subscribe({
      next: r => {
        this.busy.set(false); this.view.set(r);
        const bits = [`${r.assigned} duties given.`];
        if (r.doubled) bits.push(`${r.doubled} teacher(s) have a second room on the same day because nobody else was free.`);
        if (r.unfilled.length) bits.push(`Nobody could be found for: ${r.unfilled.map(u => `${u.label} on ${u.date}`).join(', ')}.`);
        this.note.set(bits.join(' '));
      }, error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  setOne(r: Row, teacherId: number) {
    this.error.set('');
    this.api.put<View>('/exam-duty/set', { exam_id: this.examId(), date: r.date, section_id: r.section_id, teacher_ids: teacherId ? [teacherId] : [] }).subscribe({
      next: v => { this.view.set(v); this.toast.show('Saved. This duty stays fixed.'); }, error: e => { this.error.set(errorText(e)); this.load(); } });
  }
  print() { window.print(); }
}
