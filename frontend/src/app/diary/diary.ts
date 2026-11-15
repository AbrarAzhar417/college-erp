import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { StudentPage } from '../core/models';

interface Scope { today: string; sections: { id: number; grade: number; label: string; class_teacher: boolean; subjects: { id: number; name: string }[] }[] }
interface Entry { id: number; date: string; section_id: number; subject_id: number | null; subject: string | null; kind: string; title: string; body: string; due_date: string | null; posted_by: string; can_edit: boolean }
interface TLine { id: number; user_id: number; date: string; teacher: string; section: string | null; subject: string | null; section_id: number | null; subject_id: number | null; topic: string; plan_next: string; remarks: string; reviewed_at: string | null; reviewed_by_name: string | null; review_note: string | null; can_edit: boolean }
interface Note { id: number; date: string; kind: string; note: string; parent_seen: number; parent_seen_at: string | null; by_name: string }
interface Missing { date: string; sections: { id: number; label: string }[]; teachers: { id: number; name: string }[] }
type Tab = 'class' | 'mine' | 'notes' | 'missing';

const KIND_LABEL: Record<string, string> = { homework: 'Homework', classwork: 'Classwork', test: 'Test', notice: 'Notice' };
const KIND_COLOR: Record<string, string> = { homework: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300', classwork: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', test: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', notice: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' };
const NOTE_LABEL: Record<string, string> = { praise: 'Praise', concern: 'Concern', late: 'Late', uniform: 'Uniform', homework_missing: 'Homework not done', other: 'Other' };
const shift = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

@Component({
  selector: 'app-diary',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <div>
      <h2 class="text-3xl font-black tracking-tighter">Daily Diary</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Homework and notices for each class, the teacher's own daily record, and short notes for parents about one student.</p>
    </div>
    <nav class="flex gap-2 overflow-x-auto" aria-label="Diary sections">
      @for (t of tabs(); track t.key) { <button type="button" (click)="go(t.key)" class="shrink-0 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest border border-slate-200 dark:border-slate-800" [class]="tab() === t.key ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-white dark:bg-slate-900/40 text-slate-500'">{{ t.label }}</button> }
    </nav>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @switch (tab()) {
      @case ('class') {
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="label" for="d-sec">Class and section</label><select id="d-sec" name="sec" class="field" [ngModel]="section()" (ngModelChange)="section.set($event); loadClass()"><option [ngValue]="0">Choose</option>@for (s of scope()?.sections ?? []; track s.id) { <option [ngValue]="s.id">{{ s.label }}</option> }</select></div>
          <div class="flex items-end gap-1"><button type="button" class="btn-ghost" aria-label="Previous day" (click)="day(-1)">&larr;</button>
            <div><label class="label" for="d-date">Date</label><input id="d-date" name="date" type="date" class="field" [ngModel]="date()" (ngModelChange)="date.set($event); loadClass()"></div>
            <button type="button" class="btn-ghost" aria-label="Next day" (click)="day(1)">&rarr;</button></div>
          @if (section()) { <a class="btn-ghost" routerLink="/diary/print" [queryParams]="{ section_id: section(), date: date() }">Print this day</a> }
        </div>
        @if (!(scope()?.sections?.length)) { <p class="p-6 rounded-2xl bg-slate-500/5 text-sm font-bold text-slate-500">You are not set as a teacher of any class yet. The office can set your classes in the timetable and as class teacher in Attendance.</p> }
        @if (section() && canWriteHere()) {
          <form (ngSubmit)="saveClass()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
            <h3 class="col-span-2 md:col-span-4 font-black">{{ ef.id ? 'Change entry' : 'New entry for ' + nice(date()) }}</h3>
            <div><label class="label" for="e-sub">Subject</label><select id="e-sub" name="sub" class="field" [(ngModel)]="ef.subject_id"><option [ngValue]="null">General (whole class)</option>@for (s of subjectsHere(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
            <div><label class="label" for="e-kind">Kind</label><select id="e-kind" name="kind" class="field" [(ngModel)]="ef.kind"><option value="homework">Homework</option><option value="classwork">Classwork</option><option value="test">Test</option><option value="notice">Notice</option></select></div>
            <div class="col-span-2"><label class="label" for="e-title">Title</label><input id="e-title" name="title" class="field" required maxlength="120" placeholder="Exercise 4.1, questions 1 to 5" [(ngModel)]="ef.title"></div>
            <div class="col-span-2 md:col-span-3"><label class="label" for="e-body">Details (optional)</label><textarea id="e-body" name="body" rows="2" class="field" maxlength="2000" [(ngModel)]="ef.body"></textarea></div>
            <div><label class="label" for="e-due">Due date (optional)</label><input id="e-due" name="due" type="date" class="field" [(ngModel)]="ef.due_date"></div>
            <div class="col-span-2 md:col-span-4 flex gap-3"><button class="btn-primary" type="submit">{{ ef.id ? 'Save' : 'Add to diary' }}</button>@if (ef.id) { <button type="button" class="btn-ghost" (click)="resetEntry()">Cancel</button> }</div>
          </form>
        }
        @if (section()) {
          <div class="space-y-3">
            @for (e of entries(); track e.id) {
              <article class="bg-white dark:bg-slate-900/40 p-5 rounded-[1.75rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
                <div class="flex flex-wrap items-center gap-2"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="kindColor[e.kind]">{{ kindLabel[e.kind] }}</span><span class="font-black">{{ e.subject || 'General' }}</span>
                  <span class="text-xs font-bold text-slate-400 ml-auto">{{ e.posted_by }}</span></div>
                <h4 class="text-lg font-black mt-2">{{ e.title }}</h4>
                @if (e.body) { <p class="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line mt-1">{{ e.body }}</p> }
                @if (e.due_date) { <p class="text-xs font-black text-rose-500 mt-2">Due {{ nice(e.due_date) }}</p> }
                @if (e.can_edit) { <div class="flex gap-3 mt-3"><button type="button" class="text-xs font-black text-indigo-600" (click)="editEntry(e)">Edit</button><button type="button" class="text-xs font-black text-rose-500" (click)="removeEntry(e)">Delete</button></div> }
              </article>
            } @empty { <p class="p-8 text-center text-sm font-bold text-slate-400">Nothing in the diary of this class for {{ nice(date()) }}.</p> }
          </div>
        }
      }

      @case ('mine') {
        <form (ngSubmit)="saveLine()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
          <h3 class="col-span-2 md:col-span-4 font-black">{{ lf.id ? 'Change line' : 'What I taught' }}</h3>
          <div><label class="label" for="t-date">Date</label><input id="t-date" name="date" type="date" class="field" [max]="scope()?.today" [(ngModel)]="lf.date"></div>
          <div><label class="label" for="t-sec">Class</label><select id="t-sec" name="sec" class="field" [(ngModel)]="lf.section_id"><option [ngValue]="null">-</option>@for (s of scope()?.sections ?? []; track s.id) { <option [ngValue]="s.id">{{ s.label }}</option> }</select></div>
          <div><label class="label" for="t-sub">Subject</label><select id="t-sub" name="sub" class="field" [(ngModel)]="lf.subject_id"><option [ngValue]="null">-</option>@for (s of lineSubjects(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
          <div class="col-span-2 md:col-span-4"><label class="label" for="t-topic">Topic covered</label><input id="t-topic" name="topic" class="field" required maxlength="300" [(ngModel)]="lf.topic"></div>
          <div class="col-span-2"><label class="label" for="t-next">Plan for next lesson</label><input id="t-next" name="next" class="field" maxlength="500" [(ngModel)]="lf.plan_next"></div>
          <div class="col-span-2"><label class="label" for="t-rem">Remarks (optional)</label><input id="t-rem" name="rem" class="field" maxlength="1000" [(ngModel)]="lf.remarks"></div>
          <div class="col-span-2 md:col-span-4 flex gap-3"><button class="btn-primary" type="submit">{{ lf.id ? 'Save' : 'Add line' }}</button>@if (lf.id) { <button type="button" class="btn-ghost" (click)="resetLine()">Cancel</button> }</div>
        </form>
        <div class="flex items-center gap-3"><label class="label !mb-0" for="t-from">Show from</label><input id="t-from" name="from" type="date" class="field !w-auto" [ngModel]="from()" (ngModelChange)="from.set($event); loadLines()"></div>
        <div class="space-y-3">
          @for (l of lines(); track l.id) {
            <article class="bg-white dark:bg-slate-900/40 p-5 rounded-[1.75rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
              <div class="flex flex-wrap items-center gap-2 text-xs font-black text-slate-400"><span>{{ nice(l.date) }}</span>@if (l.section) { <span>· {{ l.section }}</span> }@if (l.subject) { <span>· {{ l.subject }}</span> }@if (reviewer()) { <span class="ml-auto text-slate-600 dark:text-slate-300">{{ l.teacher }}</span> }</div>
              <h4 class="text-base font-black mt-1">{{ l.topic }}</h4>
              @if (l.plan_next) { <p class="text-sm text-slate-500">Next: {{ l.plan_next }}</p> }
              @if (l.remarks) { <p class="text-sm text-slate-500">{{ l.remarks }}</p> }
              @if (l.reviewed_at) { <p class="text-xs font-black text-emerald-600 mt-2">Reviewed by {{ l.reviewed_by_name }}{{ l.review_note ? ': ' + l.review_note : '' }}</p> }
              <div class="flex gap-3 mt-3">
                @if (l.can_edit) { <button type="button" class="text-xs font-black text-indigo-600" (click)="editLine(l)">Edit</button><button type="button" class="text-xs font-black text-rose-500" (click)="removeLine(l)">Delete</button> }
                @if (reviewer() && !l.reviewed_at) { <button type="button" class="text-xs font-black text-emerald-600" (click)="review(l)">Mark reviewed</button> }
              </div>
            </article>
          } @empty { <p class="p-8 text-center text-sm font-bold text-slate-400">No lines in this period.</p> }
        </div>
      }

      @case ('notes') {
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="label" for="n-sec">Class and section</label><select id="n-sec" name="sec" class="field" [ngModel]="noteSection()" (ngModelChange)="pickNoteSection($event)"><option [ngValue]="0">Choose</option>@for (s of scope()?.sections ?? []; track s.id) { <option [ngValue]="s.id">{{ s.label }}</option> }</select></div>
          <div><label class="label" for="n-stu">Student</label><select id="n-stu" name="stu" class="field" [ngModel]="student()" (ngModelChange)="pickStudent($event)"><option [ngValue]="0">Choose</option>@for (s of students(); track s.id) { <option [ngValue]="s.id">{{ s.roll_no ?? '-' }}. {{ s.name }}</option> }</select></div>
        </div>
        @if (student()) {
          <form (ngSubmit)="saveNote()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label class="label" for="n-kind">Kind</label><select id="n-kind" name="kind" class="field" [(ngModel)]="nf.kind">@for (k of noteKinds; track k) { <option [value]="k">{{ noteLabel[k] }}</option> }</select></div>
            <div><label class="label" for="n-date">Date</label><input id="n-date" name="date" type="date" class="field" [max]="scope()?.today" [(ngModel)]="nf.date"></div>
            <div class="col-span-2"><label class="label" for="n-text">Note for the parents</label><input id="n-text" name="text" class="field" required maxlength="500" [(ngModel)]="nf.note"></div>
            <div class="col-span-2 md:col-span-4"><button class="btn-primary" type="submit">Add note</button></div>
          </form>
          <div class="space-y-2">
            @for (n of notes(); track n.id) {
              <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                <span class="text-xs font-black text-slate-400 w-28">{{ nice(n.date) }}</span><span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-slate-100 dark:bg-slate-800">{{ noteLabel[n.kind] }}</span>
                <span class="flex-1 min-w-48 text-sm font-bold">{{ n.note }} <span class="text-slate-400 font-medium">- {{ n.by_name }}</span></span>
                <label class="flex items-center gap-1.5 text-xs font-black text-slate-500"><input type="checkbox" [checked]="!!n.parent_seen" (change)="seen(n, $any($event.target).checked)"> Parent signed</label>
                <button type="button" class="text-xs font-black text-rose-500" (click)="removeNote(n)">Delete</button>
              </div>
            } @empty { <p class="p-6 text-center text-sm font-bold text-slate-400">No notes for this student yet.</p> }
          </div>
        }
      }

      @case ('missing') {
        <div class="flex items-end gap-3"><div><label class="label" for="m-date">Date</label><input id="m-date" name="date" type="date" class="field" [ngModel]="missDate()" (ngModelChange)="missDate.set($event); loadMissing()"></div></div>
        @if (missing(); as m) {
          <div class="grid md:grid-cols-2 gap-6">
            <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800"><h4 class="font-black mb-2">Classes with lessons but no diary ({{ m.sections.length }})</h4>
              @for (s of m.sections; track s.id) { <p class="py-1 text-sm font-bold border-t border-slate-100 dark:border-slate-800">{{ s.label }}</p> } @empty { <p class="text-sm font-bold text-emerald-600">All classes have a diary entry.</p> }</div>
            <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800"><h4 class="font-black mb-2">Teachers with lessons but no line ({{ m.teachers.length }})</h4>
              @for (t of m.teachers; track t.id) { <p class="py-1 text-sm font-bold border-t border-slate-100 dark:border-slate-800">{{ t.name }}</p> } @empty { <p class="text-sm font-bold text-emerald-600">Every teacher wrote a line.</p> }</div>
          </div>
          <p class="text-xs font-bold text-slate-400">Based on the timetable for that weekday. Holidays are not taken into account.</p>
        }
      }
    }
  </div>
  `
})
export class Diary {
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  nice = nice; kindLabel = KIND_LABEL; kindColor = KIND_COLOR; noteLabel = NOTE_LABEL; noteKinds = Object.keys(NOTE_LABEL);
  tab = signal<Tab>('class'); error = signal(''); scope = signal<Scope | null>(null);
  reviewer = computed(() => this.auth.isLeadership());
  tabs = computed(() => { const t: { key: Tab; label: string }[] = [{ key: 'class', label: 'Class diary' }, { key: 'mine', label: this.reviewer() ? 'Teacher diary' : 'My teacher diary' }, { key: 'notes', label: 'Student notes' }]; return this.reviewer() ? [...t, { key: 'missing' as Tab, label: 'Not written' }] : t; });

  section = signal(0); date = signal(''); entries = signal<Entry[]>([]); ef: Partial<Entry> & { subject_id: number | null } = { subject_id: null, kind: 'homework', title: '', body: '', due_date: '' };
  subjectsHere = computed(() => this.scope()?.sections.find(s => s.id === this.section())?.subjects ?? []);
  canWriteHere = computed(() => !!this.scope()?.sections.some(s => s.id === this.section()));

  from = signal(''); lines = signal<TLine[]>([]); lf: Partial<TLine> = this.blankLine();
  lineSubjects = computed(() => { const s = this.scope()?.sections; const sec = s?.find(x => x.id === this.lf.section_id); return sec?.subjects ?? [...new Map((s ?? []).flatMap(x => x.subjects).map(x => [x.id, x])).values()]; });

  noteSection = signal(0); students = signal<{ id: number; name: string; roll_no: number | null }[]>([]); student = signal(0); notes = signal<Note[]>([]); nf = { kind: 'praise', date: '', note: '' };
  missDate = signal(''); missing = signal<Missing | null>(null);

  constructor() {
    this.api.get<Scope>('/diary/scope').subscribe({
      next: s => { this.scope.set(s); this.date.set(s.today); this.from.set(shift(s.today, -7)); this.missDate.set(s.today); this.nf.date = s.today; this.lf = this.blankLine(); if (s.sections.length === 1) { this.section.set(s.sections[0].id); this.loadClass(); } },
      error: e => this.error.set(errorText(e))
    });
  }
  go(t: Tab) { this.tab.set(t); this.error.set(''); if (t === 'mine') this.loadLines(); if (t === 'missing') this.loadMissing(); }
  private fail = (e: unknown) => this.toast.show(errorText(e), 'error');

  // class diary
  day(n: number) { this.date.set(shift(this.date(), n)); this.loadClass(); }
  loadClass() { if (!this.section()) { this.entries.set([]); return; } this.api.get<Entry[]>('/diary/class', { section_id: this.section(), date: this.date() }).subscribe({ next: r => this.entries.set(r), error: e => this.error.set(errorText(e)) }); }
  resetEntry() { this.ef = { subject_id: null, kind: 'homework', title: '', body: '', due_date: '' }; }
  editEntry(e: Entry) { this.ef = { ...e, due_date: e.due_date ?? '' }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  saveClass() {
    const body = { date: this.date(), section_id: this.section(), subject_id: this.ef.subject_id, kind: this.ef.kind, title: this.ef.title, body: this.ef.body, due_date: this.ef.due_date || null };
    const req = this.ef.id ? this.api.put(`/diary/class/${this.ef.id}`, body) : this.api.post('/diary/class', body);
    req.subscribe({ next: () => { this.toast.show('Saved.'); this.resetEntry(); this.loadClass(); }, error: this.fail });
  }
  removeEntry(e: Entry) { if (confirm('Delete this entry?')) this.api.delete(`/diary/class/${e.id}`).subscribe({ next: () => this.loadClass(), error: this.fail }); }

  // teacher diary
  private blankLine(): Partial<TLine> { return { date: this.scope()?.today ?? '', section_id: null, subject_id: null, topic: '', plan_next: '', remarks: '' }; }
  loadLines() { this.api.get<TLine[]>('/diary/teacher', { from: this.from(), to: this.scope()?.today }).subscribe({ next: r => this.lines.set(r), error: e => this.error.set(errorText(e)) }); }
  resetLine() { this.lf = this.blankLine(); }
  editLine(l: TLine) { this.lf = { ...l }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  saveLine() {
    const b = { date: this.lf.date, section_id: this.lf.section_id, subject_id: this.lf.subject_id, topic: this.lf.topic, plan_next: this.lf.plan_next, remarks: this.lf.remarks };
    const req = this.lf.id ? this.api.put(`/diary/teacher/${this.lf.id}`, b) : this.api.post('/diary/teacher', b);
    req.subscribe({ next: () => { this.toast.show('Saved.'); this.resetLine(); this.loadLines(); }, error: this.fail });
  }
  removeLine(l: TLine) { if (confirm('Delete this line?')) this.api.delete(`/diary/teacher/${l.id}`).subscribe({ next: () => this.loadLines(), error: this.fail }); }
  review(l: TLine) { const note = prompt('A short remark for the teacher (optional)') ?? ''; this.api.put(`/diary/teacher/${l.id}/review`, { note }).subscribe({ next: () => this.loadLines(), error: this.fail }); }

  // student notes
  pickNoteSection(id: number) { this.noteSection.set(id); this.student.set(0); this.notes.set([]); this.students.set([]); if (id) this.api.get<StudentPage>('/students', { sectionId: id, limit: 100 }).subscribe({ next: r => this.students.set(r.items), error: e => this.error.set(errorText(e)) }); }
  pickStudent(id: number) { this.student.set(id); this.loadNotes(); }
  loadNotes() { if (!this.student()) return; this.api.get<Note[]>(`/diary/students/${this.student()}/notes`).subscribe({ next: r => this.notes.set(r), error: e => this.error.set(errorText(e)) }); }
  saveNote() { this.api.post(`/diary/students/${this.student()}/notes`, this.nf).subscribe({ next: () => { this.toast.show('Note added.'); this.nf.note = ''; this.loadNotes(); }, error: this.fail }); }
  seen(n: Note, v: boolean) { this.api.put(`/diary/notes/${n.id}/seen`, { seen: v }).subscribe({ next: () => this.loadNotes(), error: this.fail }); }
  removeNote(n: Note) { if (confirm('Delete this note?')) this.api.delete(`/diary/notes/${n.id}`).subscribe({ next: () => this.loadNotes(), error: this.fail }); }

  // principal
  loadMissing() { this.api.get<Missing>('/diary/missing', { date: this.missDate() }).subscribe({ next: r => this.missing.set(r), error: e => this.error.set(errorText(e)) }); }
}
