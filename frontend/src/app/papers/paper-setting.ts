import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { kb, saveBase64 } from '../core/files';
import { ToastService } from '../core/toast';

interface Req { id: number; exam_id: number | null; title: string; class_id: number; class_name: string; subject_id: number; subject: string; teacher_user_id: number; teacher: string; due_date: string; instructions: string; copies: number; status: string; version: number; filename: string | null; size: number | null; submitted_at: string | null; remark: string | null; print_count: number; overdue: boolean; can_submit: boolean }
interface Sum { total: number; requested: number; submitted: number; returned: number; approved: number; printed: number; overdue: number }
interface Opts { classes: { id: number; name: string }[]; subjects: { id: number; name: string }[]; teachers: { id: number; name: string }[]; exams: { id: number; name: string; session: string }[] }
interface Line { class_id: number; subject_id: number; teacher_user_id: number; copies: number | null }
const LABEL: Record<string, string> = { requested: 'Waiting for teacher', submitted: 'Submitted', returned: 'Sent back', approved: 'Approved', printed: 'Printed' };
const COLOR: Record<string, string> = { requested: 'bg-slate-500/10 text-slate-500', submitted: 'bg-sky-500/15 text-sky-600', returned: 'bg-amber-500/15 text-amber-700', approved: 'bg-emerald-500/15 text-emerald-600', printed: 'bg-indigo-500/15 text-indigo-600' };
const tomorrow = () => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

@Component({
  selector: 'app-paper-setting',
  imports: [FormsModule],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <div class="flex flex-wrap items-end gap-3"><div class="flex-1 min-w-64"><h2 class="text-3xl font-black tracking-tighter">{{ dept() ? 'Paper Collection' : 'Papers to Set' }}</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">{{ dept() ? 'Ask teachers to prepare papers, collect them here, approve and print.' : 'Papers the Exam Department has asked you to prepare. Upload each one before the last date.' }}</p></div>
      @if (dept()) { <button type="button" class="btn-primary no-print" (click)="show.set(!show())">{{ show() ? 'Close' : 'Ask for papers' }}</button><button type="button" class="btn-ghost no-print" (click)="print()">Print this list</button> }
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (sum(); as s) { <div class="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
      @for (c of cards(s); track c.k) { <div class="p-3 rounded-2xl bg-slate-500/5"><div class="text-xl font-black" [class.text-rose-600]="c.k === 'overdue' && c.n">{{ c.n }}</div><div class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ c.label }}</div></div> }</div> }

    @if (!dept() && mine(); as m) {
      <section class="no-print bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <div class="flex flex-wrap items-center gap-3"><h3 class="font-black flex-1">Make my own paper</h3><button type="button" class="btn-ghost" (click)="showMine.set(!showMine())">{{ showMine() ? 'Close' : 'Start a paper' }}</button></div>
        @if (showMine()) {
          <form (ngSubmit)="createMine()" class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="col-span-2"><label class="label" for="m-title">Title</label><input id="m-title" name="mt" class="field" required maxlength="120" placeholder="Physics test, chapter 3" [(ngModel)]="mf.title"></div>
            <div><label class="label" for="m-due">Last date</label><input id="m-due" name="md" type="date" class="field" required [min]="today" [(ngModel)]="mf.due_date"></div>
            <div><label class="label" for="m-ex">Exam (optional)</label><select id="m-ex" name="me" class="field" [(ngModel)]="mf.exam_id"><option [ngValue]="null">None</option>@for (e of m.exams; track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }</select></div>
            <div><label class="label" for="m-c">Class</label><select id="m-c" name="mc" class="field" required [(ngModel)]="mf.class_id"><option [ngValue]="0">Choose</option>@for (c of m.classes; track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
            <div><label class="label" for="m-s">Subject</label><select id="m-s" name="ms" class="field" required [(ngModel)]="mf.subject_id"><option [ngValue]="0">Choose</option>@for (s of m.subjects; track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
            <div class="col-span-2"><label class="label" for="m-i">Instructions (time, marks)</label><input id="m-i" name="mi" class="field" maxlength="1000" [(ngModel)]="mf.instructions"></div>
            <div class="col-span-2 md:col-span-4"><button class="btn-primary" type="submit">Create, then upload the file</button><p class="text-xs font-bold text-slate-400 mt-2">It appears in your list below. Upload the paper there; you can download it again any time.</p></div>
          </form>
        }
      </section>
    }

    @if (dept() && show() && opts(); as o) {
      <form (ngSubmit)="create()" class="no-print bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
        <h3 class="col-span-2 md:col-span-4 font-black">Ask teachers for papers</h3>
        <div class="col-span-2"><label class="label" for="p-title">Title</label><input id="p-title" name="title" class="field" required maxlength="120" placeholder="Mid-term papers" [(ngModel)]="nf.title"></div>
        <div><label class="label" for="p-due">Last date to submit</label><input id="p-due" name="due" type="date" class="field" required [min]="min" [(ngModel)]="nf.due_date"></div>
        <div><label class="label" for="p-exam">Exam (optional)</label><select id="p-exam" name="exam" class="field" [(ngModel)]="nf.exam_id"><option [ngValue]="null">None</option>@for (e of o.exams; track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.session }})</option> }</select></div>
        <div class="col-span-2 md:col-span-4"><label class="label" for="p-ins">Instructions (pattern, time, marks)</label><input id="p-ins" name="ins" class="field" maxlength="1000" [(ngModel)]="nf.instructions"></div>
        <div class="col-span-2 md:col-span-4 space-y-2">
          <div class="flex flex-wrap items-center gap-2"><p class="label !mb-0">Class, subject and teacher</p>@if (nf.exam_id) { <button type="button" class="btn-ghost" (click)="suggest()">Fill from the exam plan</button> }</div>
          @for (l of lines; track $index; let i = $index) {
            <div class="grid grid-cols-6 gap-2"><select class="field col-span-2 md:col-span-1" [name]="'c' + i" [attr.aria-label]="'Class of line ' + (i + 1)" [(ngModel)]="l.class_id"><option [ngValue]="0">Class</option>@for (c of o.classes; track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
              <select class="field col-span-2 md:col-span-2" [name]="'s' + i" [attr.aria-label]="'Subject of line ' + (i + 1)" [(ngModel)]="l.subject_id"><option [ngValue]="0">Subject</option>@for (s of o.subjects; track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select>
              <select class="field col-span-2 md:col-span-2" [name]="'t' + i" [attr.aria-label]="'Teacher of line ' + (i + 1)" [(ngModel)]="l.teacher_user_id"><option [ngValue]="0">Teacher</option>@for (t of o.teachers; track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }</select>
              <button type="button" class="text-xs font-black text-rose-500" (click)="lines.splice(i, 1)" [attr.aria-label]="'Remove line ' + (i + 1)">Remove</button></div>
          }
          <button type="button" class="btn-ghost" (click)="lines.push({ class_id: 0, subject_id: 0, teacher_user_id: 0, copies: null })">Add line</button>
        </div>
        <div class="col-span-2 md:col-span-4"><button class="btn-primary" type="submit">Send requests</button></div>
      </form>
    }

    <div class="space-y-2">
      @for (r of items(); track r.id) {
        <article class="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border" [class]="r.overdue ? 'border-rose-500/50' : 'border-slate-200 dark:border-slate-800'">
          <div class="flex flex-wrap items-center gap-3">
            <span class="font-black min-w-40">{{ r.class_name }} · {{ r.subject }}</span>
            <span class="text-sm font-bold text-slate-500 flex-1 min-w-40">{{ dept() ? r.teacher + ' · ' : '' }}{{ r.title }} · {{ r.copies }} copies</span>
            <span class="text-xs font-black" [class]="r.overdue ? 'text-rose-600' : 'text-slate-400'">{{ r.overdue ? 'Late · ' : 'By ' }}{{ r.due_date }}</span>
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="color[r.status]">{{ label[r.status] }}</span>
          </div>
          @if (r.instructions) { <p class="text-xs font-bold text-slate-400 mt-1">{{ r.instructions }}</p> }
          @if (r.remark) { <p class="text-sm font-bold text-amber-700 dark:text-amber-300 mt-1">Please change: {{ r.remark }}</p> }
          <div class="flex flex-wrap items-center gap-3 mt-2 no-print">
            @if (r.filename) { <button type="button" class="text-xs font-black text-indigo-600" (click)="download(r)">{{ r.filename }} ({{ size(r.size ?? 0) }}, version {{ r.version }})</button> }
            @if (r.can_submit) { <label class="btn-ghost cursor-pointer !py-2"><span>{{ r.filename ? 'Upload a new version' : 'Upload paper' }}</span><input type="file" class="sr-only" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" (change)="upload(r, $event)" [attr.aria-label]="'Paper file for ' + r.class_name + ' ' + r.subject"></label> }
            @if (dept()) {
              @if (r.status === 'submitted') { <button type="button" class="btn-primary !py-2" (click)="approve(r)">Approve</button><button type="button" class="btn-ghost !py-2" (click)="sendBack(r)">Send back</button> }
              @if (r.status === 'approved' || r.status === 'printed') { <button type="button" class="btn-ghost !py-2" (click)="printed(r)">{{ r.status === 'printed' ? 'Printed again' : 'Mark printed' }}{{ r.print_count ? ' (' + r.print_count + ')' : '' }}</button> }
              @if (r.status === 'requested' || r.status === 'returned') { <button type="button" class="btn-ghost !py-2" (click)="remind(r)">Remind teacher</button> }
              @if (r.status !== 'printed') { <button type="button" class="text-xs font-black text-rose-500" (click)="remove(r)">Delete</button> }
            }
          </div>
        </article>
      } @empty { <p class="p-10 text-center text-sm font-bold text-slate-400">{{ dept() ? 'No paper requests yet.' : 'Nothing is waiting for you.' }}</p> }
    </div>
  </div>
  `
})
export class PaperSetting {
  private api = inject(Api); private http = inject(HttpClient); private toast = inject(ToastService);
  label = LABEL; color = COLOR; size = kb; min = tomorrow();
  dept = signal(false); items = signal<Req[]>([]); sum = signal<Sum | null>(null); opts = signal<Opts | null>(null); error = signal(''); show = signal(false);
  nf: { title: string; due_date: string; exam_id: number | null; instructions: string } = { title: '', due_date: '', exam_id: null, instructions: '' };
  lines: Line[] = [{ class_id: 0, subject_id: 0, teacher_user_id: 0, copies: null }];
  mine = signal<{ classes: { id: number; name: string }[]; subjects: { id: number; name: string }[]; exams: { id: number; name: string }[] } | null>(null); showMine = signal(false);
  today = new Date().toISOString().slice(0, 10);
  mf: { title: string; due_date: string; exam_id: number | null; class_id: number; subject_id: number; instructions: string } = { title: '', due_date: '', exam_id: null, class_id: 0, subject_id: 0, instructions: '' };
  createMine() {
    if (!this.mf.class_id || !this.mf.subject_id) { this.toast.show('Choose the class and the subject.', 'error'); return; }
    this.api.post('/paper-setting/mine', this.mf).subscribe({ next: () => { this.toast.show('Paper created. Upload the file from the list.'); this.showMine.set(false); this.mf = { title: '', due_date: '', exam_id: null, class_id: 0, subject_id: 0, instructions: '' }; this.load(); }, error: this.fail });
  }
  private fail = (e: unknown) => this.toast.show(errorText(e), 'error');
  constructor() { this.load(); }
  cards(s: Sum) { return [{ k: 'requested', label: 'Waiting', n: s.requested }, { k: 'submitted', label: 'To review', n: s.submitted }, { k: 'returned', label: 'Sent back', n: s.returned }, { k: 'approved', label: 'Approved', n: s.approved }, { k: 'printed', label: 'Printed', n: s.printed }, { k: 'overdue', label: 'Late', n: s.overdue }]; }
  load() {
    this.api.get<{ dept: boolean; summary: Sum; items: Req[] }>('/paper-setting').subscribe({
      next: r => { this.dept.set(r.dept); this.sum.set(r.summary); this.items.set(r.items); if (r.dept && !this.opts()) this.api.get<Opts>('/paper-setting/options').subscribe({ next: o => this.opts.set(o) }); if (!r.dept && !this.mine()) this.api.get<any>('/paper-setting/my-options').subscribe({ next: o => this.mine.set(o), error: () => { /* open teaching is off */ } }); },
      error: e => this.error.set(errorText(e))
    });
  }
  suggest() {
    this.api.get<{ class_id: number; subject_id: number; teacher_user_id: number | null }[]>('/paper-setting/suggest', { exam_id: this.nf.exam_id ?? '' }).subscribe({
      next: r => { this.lines = r.map(x => ({ class_id: x.class_id, subject_id: x.subject_id, teacher_user_id: x.teacher_user_id ?? 0, copies: null })); this.toast.show(`${r.length} lines filled. Check the teachers.`); }, error: this.fail });
  }
  create() {
    const items = this.lines.filter(l => l.class_id || l.subject_id || l.teacher_user_id).map(l => ({ ...l, copies: l.copies ?? undefined }));
    this.api.post('/paper-setting', { ...this.nf, items }).subscribe({ next: () => { this.toast.show('Requests sent.'); this.show.set(false); this.lines = [{ class_id: 0, subject_id: 0, teacher_user_id: 0, copies: null }]; this.load(); }, error: this.fail });
  }
  upload(r: Req, ev: Event) {
    const input = ev.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (!f) return;
    this.http.put(`/api/paper-setting/${r.id}/upload?name=${encodeURIComponent(f.name)}`, f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }).subscribe({ next: () => { this.toast.show('Paper submitted.'); this.load(); }, error: this.fail });
  }
  download(r: Req) { this.api.get<{ filename: string; mime: string; base64: string }>(`/paper-setting/${r.id}/file`).subscribe({ next: saveBase64, error: this.fail }); }
  approve(r: Req) { this.api.put(`/paper-setting/${r.id}/review`, { action: 'approve' }).subscribe({ next: () => this.load(), error: this.fail }); }
  sendBack(r: Req) { const remark = prompt('What should the teacher change?'); if (remark) this.api.put(`/paper-setting/${r.id}/review`, { action: 'return', remark }).subscribe({ next: () => this.load(), error: this.fail }); }
  printed(r: Req) { const c = prompt('Copies printed', String(r.copies)); if (c !== null) this.api.put(`/paper-setting/${r.id}/printed`, { copies: c }).subscribe({ next: () => this.load(), error: this.fail }); }
  remind(r: Req) { this.api.post(`/paper-setting/${r.id}/remind`, {}).subscribe({ next: () => this.toast.show(`Reminder sent to ${r.teacher} as a task.`), error: this.fail }); }
  remove(r: Req) { if (confirm('Delete this request?')) this.api.delete(`/paper-setting/${r.id}`).subscribe({ next: () => this.load(), error: this.fail }); }
  print() { window.print(); }
}
