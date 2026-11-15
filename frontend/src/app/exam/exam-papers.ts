import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { fmtDate, STATUS_LABEL } from './exam';

interface Paper { teacher_name?: string; id: number; exam_id: number; exam_name: string; exam_status: string; class_name: string; section_name: string; subject: string; test_date: string | null; max_marks: number; entered: number; total: number }

@Component({
  selector: 'app-exam-papers',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="flex flex-wrap items-end gap-4">
      @if (manager) { <div class="w-72"><label class="label" for="pt">Teacher</label><select id="pt" class="field" [ngModel]="teacherId()" (ngModelChange)="setTeacher($event)"><option [ngValue]="null">Choose teacher…</option>@for (t of teachers(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }</select></div> }
      @if (!manager) { <label class="flex items-center gap-2 text-sm font-bold pb-3"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="every()" (ngModelChange)="every.set($event); load()"> Show every class and subject</label> }
      <label class="flex items-center gap-2 text-sm font-bold pb-3"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="all()" (ngModelChange)="all.set($event); load()"> Also show closed exams</label>
    </div>
    @if (note()) { <p class="p-5 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ note() }}</p> }
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @for (g of groups(); track g.exam) {
      <section class="space-y-3">
        <h3 class="text-xl font-black tracking-tight">{{ g.exam }} <span class="text-xs font-bold text-slate-400">{{ st(g.status) }}</span></h3>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          @for (p of g.papers; track p.id) {
            <a [routerLink]="['/exams/marks', p.id]" class="block p-5 rounded-[2rem] border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-indigo-400 transition-all">
              <p class="text-lg font-black">{{ p.class_name }}-{{ p.section_name }} · {{ p.subject }}</p>
              <p class="text-xs font-bold text-slate-400 mt-1">{{ p.teacher_name ? p.teacher_name + ' · ' : '' }}{{ p.test_date ? 'Test on ' + d(p.test_date) : 'Date not set' }} · out of {{ p.max_marks }}</p>
              <p class="text-xs font-black mt-3" [class]="p.entered >= p.total ? 'text-emerald-600' : p.entered ? 'text-amber-600' : 'text-rose-500'">{{ p.entered >= p.total ? 'All marks entered' : p.entered ? p.entered + ' of ' + p.total + ' entered' : 'Marks not entered yet' }}</p>
            </a>
          }
        </div>
      </section>
    }
    @if (loaded() && !papers().length && !note()) { <p class="text-sm font-bold text-slate-400">No papers to show.</p> }
  </div>
  `
})
export class ExamPapers {
  private api = inject(Api);
  auth = inject(AuthService);
  manager = this.auth.canWriteStudents();
  d = fmtDate; st = (s: string) => STATUS_LABEL[s];
  teachers = signal<{ id: number; name: string }[]>([]); teacherId = signal<number | null>(null);
  papers = signal<Paper[]>([]); all = signal(false); every = signal(false); note = signal(''); error = signal(''); loaded = signal(false);
  groups = () => { const m = new Map<number, { exam: string; status: string; papers: Paper[] }>(); for (const p of this.papers()) (m.get(p.exam_id) ?? m.set(p.exam_id, { exam: p.exam_name, status: p.exam_status, papers: [] }).get(p.exam_id)!).papers.push(p); return [...m.values()]; };

  constructor() { if (this.manager) this.api.get<{ id: number; name: string }[]>('/timetable/teachers').subscribe(t => this.teachers.set(t)); else this.load(); }
  setTeacher(id: number | null) { this.teacherId.set(id); this.load(); }
  load() {
    if (this.manager && !this.teacherId()) { this.papers.set([]); this.loaded.set(true); return; }
    this.api.get<{ papers: Paper[]; note?: string }>('/exam/my-papers', { teacherId: this.teacherId() ?? undefined, all: this.all() ? 1 : undefined, scope: !this.manager && this.every() ? 'all' : undefined }).subscribe({
      next: r => { this.papers.set(r.papers); this.note.set(r.note ?? ''); this.loaded.set(true); }, error: e => { this.error.set(errorText(e)); this.loaded.set(true); } });
  }
}
