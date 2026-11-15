import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Api, errorText } from '../core/api';
import { saveText } from '../core/files';
import { ToastService } from '../core/toast';

interface Checked { line: number; student_id: number | null; name: string; reg_no: string; entry: { marks: number | null; status: string } | null; skipped: boolean; problem: string | null }
interface Preview { max: number; rows: Checked[]; ok: number; skipped: number; problems: number }

/** Enter marks in Excel: download the class list, fill the Marks column, upload it back. */
@Component({
  selector: 'app-marks-file',
  template: `
  <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4 no-print">
    <div><h3 class="text-lg font-black">Marks from a file</h3><p class="text-xs font-bold text-slate-400 mt-1">Download the list, fill the Marks column in Excel (a number, A for absent or L for leave), then upload it as CSV or .xlsx. Blank rows keep what is already saved.</p></div>
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="btn-ghost" (click)="template()">Download class list</button>
      @if (canEdit) { <label class="btn-primary cursor-pointer"><span>Choose filled file</span><input type="file" class="sr-only" accept=".csv,.xlsx,text/csv" (change)="pick($event)" aria-label="Filled marks file"></label> }
    </div>
    @if (error()) { <p role="alert" class="p-3 rounded-xl bg-rose-500/10 text-rose-600 text-sm font-bold">{{ error() }}</p> }
    @if (pv(); as p) {
      <p class="text-sm font-bold">{{ p.ok }} rows ready · {{ p.skipped }} blank · <span [class.text-rose-600]="p.problems">{{ p.problems }} with problems</span> (out of {{ p.max }} marks)</p>
      @if (p.problems) { <ul class="space-y-1">@for (r of p.rows; track r.line) { @if (r.problem) { <li class="text-sm font-bold text-rose-600">Row {{ r.line }} · {{ r.name || r.reg_no }}: {{ r.problem }}</li> } }</ul> }
      <div class="flex gap-3"><button type="button" class="btn-primary" (click)="commit()" [disabled]="!p.ok || busy()">{{ busy() ? 'Saving...' : 'Save ' + p.ok + ' marks' }}</button><button type="button" class="btn-ghost" (click)="reset()">Cancel</button></div>
    }
  </section>
  `
})
export class MarksFile {
  private api = inject(Api); private http = inject(HttpClient); private toast = inject(ToastService);
  @Input({ required: true }) paperId!: number;
  @Input() canEdit = false;
  @Output() saved = new EventEmitter<void>();
  pv = signal<Preview | null>(null); error = signal(''); busy = signal(false); private file: File | null = null;
  template() { this.api.get<{ filename: string; csv: string }>(`/exam/papers/${this.paperId}/marks-template`).subscribe({ next: r => saveText(r.filename, r.csv), error: e => this.toast.show(errorText(e), 'error') }); }
  reset() { this.pv.set(null); this.error.set(''); this.file = null; }
  pick(ev: Event) {
    const input = ev.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (!f) return;
    this.file = f; this.error.set(''); this.pv.set(null); this.send('preview');
  }
  private send(mode: 'preview' | 'commit') {
    const f = this.file; if (!f) return;
    this.http.post<Preview & { saved?: number }>(`/api/exam/papers/${this.paperId}/marks-upload?mode=${mode}&name=${encodeURIComponent(f.name)}`, f, { headers: { 'Content-Type': 'application/octet-stream' } }).subscribe({
      next: r => { this.busy.set(false); if (mode === 'preview') this.pv.set(r); else { this.toast.show(`Marks saved for ${r.saved} students.`); this.reset(); this.saved.emit(); } },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  commit() { this.busy.set(true); this.send('commit'); }
}
