import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { Subject, Teacher, TtData } from './tt';

interface Item { subject_id: number; name: string; periods_per_week: number; block: number }
interface Row { id: number; section_id: number; subject_id: number; subject_name: string; periods_per_week: number; block: number; teacher_id: number | null; teacher_name: string | null }

@Component({
  selector: 'app-tt-curriculum',
  imports: [FormsModule],
  template: `
  <div class="space-y-8">
    <div class="flex flex-col md:flex-row md:items-end gap-4">
      <div class="md:w-64"><label class="label" for="cc">Class</label>
        <select id="cc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)">
          @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
        </select></div>
      <p class="text-sm font-bold text-slate-400 pb-3">Subjects and periods below apply to all sections (A to E) of this class.</p>
    </div>

    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-xl font-black tracking-tight">Weekly periods</h3>
        <p class="text-sm font-black" [class]="total() > capacity() ? 'text-rose-500' : 'text-slate-500'">{{ total() }} of {{ capacity() }} periods used</p>
      </div>
      <div class="space-y-3">
        @for (it of items(); track it.subject_id) {
          <div class="grid grid-cols-12 gap-3 items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <span class="col-span-12 md:col-span-5 font-black">{{ it.name }}</span>
            <div class="col-span-5 md:col-span-3"><label class="label" [for]="'p' + it.subject_id">Periods/week</label>
              <input [id]="'p' + it.subject_id" type="number" min="1" class="field" [(ngModel)]="it.periods_per_week" [name]="'p' + it.subject_id"></div>
            <div class="col-span-5 md:col-span-3"><label class="label" [for]="'b' + it.subject_id">Lesson length</label>
              <select [id]="'b' + it.subject_id" class="field" [(ngModel)]="it.block" [name]="'b' + it.subject_id">
                <option [ngValue]="1">Single periods</option><option [ngValue]="2">Double periods</option><option [ngValue]="3">Triple periods</option>
              </select></div>
            <button type="button" class="col-span-2 md:col-span-1 btn-ghost !px-3 !text-rose-500" (click)="removeItem(it)" [attr.aria-label]="'Remove ' + it.name">X</button>
          </div>
        }
      </div>
      <div class="flex flex-col md:flex-row gap-4 md:items-end">
        <div class="md:w-72"><label class="label" for="addsub">Add a subject</label>
          <select id="addsub" class="field" [ngModel]="null" (ngModelChange)="addItem($event)">
            <option [ngValue]="null" disabled>Choose subject…</option>
            @for (s of unused(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }
          </select></div>
        <button type="button" class="btn-primary" (click)="saveCurriculum()">Save for all sections</button>
      </div>
      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 class="text-xl font-black tracking-tight">Who teaches what</h3>
        <div class="flex flex-wrap gap-3">
          <button type="button" class="btn-primary" (click)="auto(false)">Fill empty with smart assignment</button>
          <button type="button" class="btn-ghost" (click)="auto(true)">Re-assign this class</button>
        </div>
      </div>
      @if (note()) { <p class="text-sm font-bold text-indigo-600 dark:text-indigo-400">{{ note() }}</p> }
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm min-w-[720px]">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest">
            <th class="py-3 pr-4">Subject</th>
            @for (s of sections(); track s.id) { <th class="py-3 px-2">Section {{ s.name }}</th> }
          </tr></thead>
          <tbody>
            @for (it of items(); track it.subject_id) {
              <tr class="border-t border-slate-100 dark:border-slate-800">
                <td class="py-3 pr-4 font-black whitespace-nowrap">{{ it.name }}</td>
                @for (s of sections(); track s.id) {
                  @let row = rowFor(s.id, it.subject_id);
                  <td class="py-2 px-2">
                    @if (row) {
                      <select class="field !py-2.5 !text-xs" [ngModel]="row.teacher_id" (ngModelChange)="assign(row, $event)" [attr.aria-label]="it.name + ' teacher for section ' + s.name">
                        <option [ngValue]="null">Not assigned</option>
                        @for (t of teachersFor(it.subject_id); track t.id) { <option [ngValue]="t.id">{{ t.name }} ({{ t.load }}/{{ t.max_per_week }})</option> }
                      </select>
                    } @else { <span class="text-xs font-bold text-slate-300">Save first</span> }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  </div>
  `
})
export class TtCurriculum {
  private api = inject(Api);
  private toast = inject(ToastService);
  private tt = inject(TtData);

  classes = signal<ClassInfo[]>([]);
  classId = signal<number | null>(null);
  subjects = signal<Subject[]>([]);
  teachers = signal<Teacher[]>([]);
  sections = signal<{ id: number; name: string }[]>([]);
  rows = signal<Row[]>([]);
  items = signal<Item[]>([]);
  error = signal('');
  note = signal('');

  capacity = computed(() => (this.tt.settings()?.days.length ?? 0) * (this.tt.settings()?.periodCount ?? 0));
  total = computed(() => this.items().reduce((a, i) => a + Number(i.periods_per_week || 0), 0));
  unused = computed(() => this.subjects().filter(s => !this.items().some(i => i.subject_id === s.id)));

  constructor() {
    this.api.get<Subject[]>('/timetable/subjects').subscribe(s => this.subjects.set(s));
    this.api.get<ClassInfo[]>('/classes').subscribe(c0 => { const c = c0.filter(x => this.tt.inWing(x.id)); this.classes.set(c); if (c.length) this.setClass(c[0].id); });
  }

  setClass(id: number) { this.classId.set(id); this.note.set(''); this.error.set(''); this.reload(); }

  reload() {
    const id = this.classId(); if (id == null) return;
    this.api.get<Teacher[]>('/timetable/teachers').subscribe(t => this.teachers.set(t));
    this.api.get<{ sections: { id: number; name: string }[]; rows: Row[] }>('/timetable/curriculum', { classId: id }).subscribe(r => {
      this.sections.set(r.sections); this.rows.set(r.rows);
      const seen = new Map<number, Item>();
      for (const row of r.rows) if (!seen.has(row.subject_id)) seen.set(row.subject_id, { subject_id: row.subject_id, name: row.subject_name, periods_per_week: row.periods_per_week, block: row.block });
      this.items.set([...seen.values()]);
    });
  }

  rowFor(sectionId: number, subjectId: number) { return this.rows().find(r => r.section_id === sectionId && r.subject_id === subjectId); }
  teachersFor(subjectId: number) {
    const q = this.teachers().filter(t => t.subjects.includes(subjectId));
    return q.length ? q : this.teachers();
  }

  addItem(subjectId: number | null) {
    if (subjectId == null) return;
    const s = this.subjects().find(x => x.id === subjectId); if (!s) return;
    this.items.set([...this.items(), { subject_id: s.id, name: s.name, periods_per_week: 4, block: 1 }]);
  }
  removeItem(it: Item) { this.items.set(this.items().filter(i => i.subject_id !== it.subject_id)); }

  saveCurriculum() {
    this.error.set('');
    const body = { items: this.items().map(i => ({ subject_id: i.subject_id, periods_per_week: Number(i.periods_per_week), block: Number(i.block) })) };
    this.api.put<{ clearedSlots: number }>(`/timetable/curriculum/class/${this.classId()}`, body).subscribe({
      next: r => { this.toast.show(r.clearedSlots ? `Saved. ${r.clearedSlots} published lesson periods were cleared, so generate again.` : 'Saved for all sections.'); this.reload(); },
      error: e => this.error.set(errorText(e))
    });
  }

  assign(row: Row, teacherId: number | null) {
    this.api.put(`/timetable/section-subjects/${row.id}`, { teacher_id: teacherId }).subscribe({
      next: () => this.reload(),
      error: e => { this.toast.show(errorText(e), 'error'); this.reload(); }
    });
  }

  auto(reassign: boolean) {
    if (reassign && !confirm('Re-assign every teacher in this class from scratch? Published lessons for this class will be cleared.')) return;
    this.api.post<{ assigned: number; unassigned: { section: string; subject: string; reason: string }[] }>('/timetable/assign/auto', { classId: this.classId(), reassign }).subscribe({
      next: r => {
        this.note.set(r.unassigned.length ? `Assigned ${r.assigned}. Could not assign ${r.unassigned.length}: ${r.unassigned[0].section} ${r.unassigned[0].subject}. ${r.unassigned[0].reason}` : `Assigned teachers to ${r.assigned} subjects.`);
        this.reload();
      },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
