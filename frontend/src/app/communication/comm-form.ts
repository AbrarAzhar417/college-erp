import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';
import { AUDIENCE_LABEL, DateRow, KIND_LABEL, Kind, MeetingPoint, Notice, ResultLine } from './comm-types';

interface ExamLite { id: number; name: string; session: string; status: string }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const HINT: Record<Kind, string> = {
  circular: 'A general instruction for staff or parents.', meeting: 'Minutes of a meeting: who attended and what was decided, with who is responsible and by when.',
  order: 'An office order, for example a transfer, duty or change of timing.', datesheet: 'Exam dates by class. You can fill it from the exam module.',
  result: 'Tells parents the result is declared. You can fill the class summary from the exam module.', notice: 'A short notice, for example a holiday or an event.'
};

@Component({
  selector: 'app-comm-form',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="max-w-4xl mx-auto pb-16 space-y-6">
    <a routerLink="/communication" class="text-xs font-black text-indigo-600">&larr; Back</a>
    <h2 class="text-3xl font-black tracking-tighter">{{ id ? 'Change notice' : 'New notice' }}</h2>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 gap-4">
      <div><label class="label" for="c-kind">Kind</label><select id="c-kind" name="kind" class="field" [(ngModel)]="f.kind">@for (k of kinds; track k.key) { <option [value]="k.key">{{ k.label }}</option> }</select></div>
      <div><label class="label" for="c-aud">Who receives it</label><select id="c-aud" name="aud" class="field" [(ngModel)]="f.audience">@for (a of audiences; track a.key) { <option [value]="a.key">{{ a.label }}</option> }</select></div>
      <p class="col-span-2 text-xs font-bold text-slate-400">{{ hint[f.kind] }}</p>
      <div class="col-span-2"><label class="label" for="c-title">Subject</label><input id="c-title" name="title" class="field" required maxlength="150" [(ngModel)]="f.title"></div>
      @if (f.audience === 'parents' || f.audience === 'all') {
        <fieldset class="col-span-2"><legend class="label">Classes{{ f.audience === 'all' ? ' (leave empty for every class)' : '' }}</legend>
          <div class="flex flex-wrap gap-2">@for (c of classes(); track c.id) { <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-bold"><input type="checkbox" [checked]="f.class_ids.includes(c.id)" (change)="toggleClass(c.id)"> {{ c.name }}</label> }</div></fieldset>
      }

      @if (f.kind === 'meeting') {
        <div><label class="label" for="m-date">Meeting date</label><input id="m-date" name="mdate" type="date" class="field" [(ngModel)]="f.data.meeting_date"></div>
        <div><label class="label" for="m-time">Time</label><input id="m-time" name="mtime" class="field" placeholder="10:00 AM" [(ngModel)]="f.data.time"></div>
        <div><label class="label" for="m-venue">Venue</label><input id="m-venue" name="mvenue" class="field" [(ngModel)]="f.data.venue"></div>
        <div><label class="label" for="m-att">Present</label><input id="m-att" name="matt" class="field" placeholder="Principal, HODs..." [(ngModel)]="f.data.attendees"></div>
        <div class="col-span-2 space-y-2"><p class="label">Points and decisions</p>
          @for (p of points; track $index; let i = $index) {
            <div class="grid grid-cols-6 gap-2"><input class="field col-span-6 md:col-span-3" [name]="'pt' + i" [attr.aria-label]="'Point ' + (i + 1)" placeholder="Decision or point" [(ngModel)]="p.text">
              <input class="field col-span-3 md:col-span-1" [name]="'pa' + i" [attr.aria-label]="'Responsible for point ' + (i + 1)" placeholder="Who" [(ngModel)]="p.assignee">
              <input class="field col-span-2 md:col-span-1" type="date" [name]="'pd' + i" [attr.aria-label]="'Due date of point ' + (i + 1)" [(ngModel)]="p.due">
              <button type="button" class="text-xs font-black text-rose-500" (click)="points.splice(i, 1)" [attr.aria-label]="'Remove point ' + (i + 1)">Remove</button></div>
          }
          <button type="button" class="btn-ghost" (click)="points.push(blankPoint())">Add point</button></div>
      }

      @if (f.kind === 'datesheet') {
        <div class="col-span-2 space-y-3">
          <div class="flex flex-wrap items-end gap-2"><div><label class="label" for="d-exam">Fill from exam</label><select id="d-exam" name="dexam" class="field" [(ngModel)]="examId"><option [ngValue]="0">Choose exam</option>@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }})</option> }</select></div>
            <button type="button" class="btn-ghost" (click)="fillDatesheet()" [disabled]="!examId">Fill dates</button></div>
          <div><label class="label" for="d-name">Exam name on the sheet</label><input id="d-name" name="dname" class="field" [(ngModel)]="f.data.exam_name"></div>
          @for (r of rows; track $index; let i = $index) {
            <div class="grid grid-cols-6 gap-2"><input class="field col-span-2 md:col-span-1" [name]="'rc' + i" [attr.aria-label]="'Class of row ' + (i + 1)" placeholder="Class" [(ngModel)]="r.class_label">
              <input class="field col-span-4 md:col-span-1" type="date" [name]="'rd' + i" [attr.aria-label]="'Date of row ' + (i + 1)" [(ngModel)]="r.date">
              <input class="field col-span-3 md:col-span-2" [name]="'rs' + i" [attr.aria-label]="'Subject of row ' + (i + 1)" placeholder="Subject" [(ngModel)]="r.subject">
              <input class="field col-span-2 md:col-span-1" [name]="'rt' + i" [attr.aria-label]="'Time of row ' + (i + 1)" placeholder="9:00 - 12:00" [(ngModel)]="r.time">
              <button type="button" class="text-xs font-black text-rose-500" (click)="rows.splice(i, 1)" [attr.aria-label]="'Remove row ' + (i + 1)">Remove</button></div>
          }
          <button type="button" class="btn-ghost" (click)="rows.push(blankRow())">Add row</button>
        </div>
      }

      @if (f.kind === 'result') {
        <div class="col-span-2 space-y-3">
          <div class="flex flex-wrap items-end gap-2"><div><label class="label" for="r-exam">Fill from exam</label><select id="r-exam" name="rexam" class="field" [(ngModel)]="examId"><option [ngValue]="0">Choose exam</option>@for (e of exams(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }}, {{ e.status }})</option> }</select></div>
            <button type="button" class="btn-ghost" (click)="fillResult()" [disabled]="!examId">Fill class results</button></div>
          <div><label class="label" for="r-name">Exam name</label><input id="r-name" name="rname" class="field" [(ngModel)]="f.data.exam_name"></div>
          @for (l of lines; track $index; let i = $index) {
            <div class="grid grid-cols-6 gap-2"><input class="field col-span-2 md:col-span-1" [name]="'lc' + i" [attr.aria-label]="'Class of line ' + (i + 1)" [(ngModel)]="l.class_label">
              <input class="field" type="number" [name]="'lp' + i" [attr.aria-label]="'Pass percent of line ' + (i + 1)" placeholder="Pass %" [(ngModel)]="l.pass_pct">
              <input class="field" type="number" [name]="'la' + i" [attr.aria-label]="'Average of line ' + (i + 1)" placeholder="Avg %" [(ngModel)]="l.avg">
              <input class="field col-span-2" [name]="'lt' + i" [attr.aria-label]="'Top student of line ' + (i + 1)" placeholder="Top student" [(ngModel)]="l.top">
              <button type="button" class="text-xs font-black text-rose-500" (click)="lines.splice(i, 1)" [attr.aria-label]="'Remove line ' + (i + 1)">Remove</button></div>
          }
          <button type="button" class="btn-ghost" (click)="lines.push(blankLine())">Add line</button>
        </div>
      }

      <div class="col-span-2"><label class="label" for="c-body">{{ f.kind === 'meeting' ? 'Extra remarks (optional)' : 'Text' }}</label><textarea dir="auto" id="c-body" name="body" rows="6" class="field" maxlength="8000" [(ngModel)]="f.body"></textarea></div>
      <div><label class="label" for="c-date">Issue date</label><input id="c-date" name="date" type="date" class="field" [(ngModel)]="f.issue_date"></div>
      <div><label class="label" for="c-sign">Signed by</label><input id="c-sign" name="sign" class="field" maxlength="80" [(ngModel)]="f.signed_by"></div>
      <label class="col-span-2 flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="urgent" [checked]="f.priority === 'urgent'" (change)="f.priority = f.priority === 'urgent' ? 'normal' : 'urgent'"> Mark as urgent</label>
      <div class="col-span-2 flex gap-3"><button class="btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Saving...' : (id ? 'Save changes' : 'Save as draft') }}</button><a routerLink="/communication" class="btn-ghost">Cancel</a></div>
      <p class="col-span-2 text-xs font-bold text-slate-400">A draft is seen only by the office. The principal or director publishes it; it then gets its reference number.</p>
    </form>
  </div>
  `
})
export class CommForm {
  private api = inject(Api); private toast = inject(ToastService); private router = inject(Router);
  id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id')) || 0;
  kinds = (Object.keys(KIND_LABEL) as Kind[]).map(key => ({ key, label: KIND_LABEL[key] })); audiences = Object.entries(AUDIENCE_LABEL).map(([key, label]) => ({ key, label })); hint = HINT;
  error = signal(''); busy = signal(false); classes = signal<{ id: number; name: string }[]>([]); exams = signal<ExamLite[]>([]); examId = 0;
  f: { kind: Kind; title: string; body: string; audience: string; class_ids: number[]; priority: string; issue_date: string; signed_by: string; data: { meeting_date?: string; time?: string; venue?: string; attendees?: string; exam_name?: string; exam_id?: number | null } } =
    { kind: 'circular', title: '', body: '', audience: 'staff', class_ids: [], priority: 'normal', issue_date: today(), signed_by: 'Principal', data: {} };
  points: MeetingPoint[] = [this.blankPoint()]; rows: DateRow[] = []; lines: ResultLine[] = [];
  blankPoint(): MeetingPoint { return { text: '', assignee: '', due: '' }; } blankRow(): DateRow { return { class_label: '', subject: '', date: '', time: '' }; } blankLine(): ResultLine { return { class_label: '', pass_pct: null, avg: null, top: '' }; }
  constructor() {
    this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => this.classes.set(c.map(k => ({ id: k.id, name: k.name }))), error: e => this.error.set(errorText(e)) });
    this.api.get<ExamLite[]>('/exam/exams').subscribe({ next: r => this.exams.set(r) });
    if (this.id) this.api.get<Notice>(`/communication/${this.id}`).subscribe({
      next: n => { this.f = { kind: n.kind, title: n.title, body: n.body, audience: n.audience, class_ids: n.class_ids, priority: n.priority, issue_date: n.issue_date, signed_by: n.signed_by, data: { meeting_date: n.data.meeting_date, time: n.data.time, venue: n.data.venue, attendees: n.data.attendees, exam_name: n.data.exam_name, exam_id: n.data.exam_id } };
        this.points = n.data.points?.length ? n.data.points : [this.blankPoint()]; this.rows = n.data.rows ?? []; this.lines = n.data.lines ?? []; },
      error: e => this.error.set(errorText(e))
    });
  }
  toggleClass(id: number) { this.f.class_ids = this.f.class_ids.includes(id) ? this.f.class_ids.filter(x => x !== id) : [...this.f.class_ids, id]; }
  fillDatesheet() {
    this.api.get<{ exam: ExamLite; missing: number; rows: DateRow[] }>('/communication/generate/datesheet', { exam_id: this.examId }).subscribe({
      next: r => { this.rows = r.rows; this.f.data.exam_name = r.exam.name; if (!this.f.title) this.f.title = `Date sheet: ${r.exam.name}`; this.toast.show(r.missing ? `${r.rows.length} rows filled. ${r.missing} papers still have no date.` : `${r.rows.length} rows filled.`, r.missing ? 'error' : 'ok'); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
  fillResult() {
    this.api.get<{ exam: ExamLite; skipped: number; lines: ResultLine[] }>('/communication/generate/result', { exam_id: this.examId }).subscribe({
      next: r => { this.lines = r.lines; this.f.data.exam_name = r.exam.name; this.f.data.exam_id = r.exam.id; if (!this.f.title) this.f.title = `Result: ${r.exam.name}`;
        this.toast.show(r.skipped ? `${r.lines.length} classes filled. ${r.skipped} class(es) skipped because marks are incomplete.` : `${r.lines.length} classes filled.`, r.skipped ? 'error' : 'ok'); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
  save() {
    const data = { ...this.f.data, points: this.f.kind === 'meeting' ? this.points : undefined, rows: this.f.kind === 'datesheet' ? this.rows : undefined, lines: this.f.kind === 'result' ? this.lines : undefined };
    const body = { ...this.f, data, class_ids: this.f.audience === 'staff' || this.f.audience === 'teachers' ? [] : this.f.class_ids };
    this.busy.set(true);
    (this.id ? this.api.put(`/communication/${this.id}`, body) : this.api.post('/communication', body)).subscribe({
      next: () => { this.busy.set(false); this.toast.show('Draft saved.'); this.router.navigate(['/communication']); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  }
}
