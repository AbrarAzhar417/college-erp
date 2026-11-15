import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';

type Kind = 'students' | 'staff';
interface Analysis {
  kind: Kind; delimiter: string; headers: string[]; mapping: Record<string, string>; fields: { key: string; label: string; required: boolean }[];
  counts: { total: number; new: number; duplicate: number; error: number; warnings: number }; sample: string[][];
  rows: { line: number; status: 'new' | 'duplicate' | 'error'; problems: string[]; warnings: string[]; summary: string }[];
}
interface RealPreview { counts: { total: number; new: number; duplicate: number; error: number } }
interface Saved { kind: Kind; saved: number; duplicates: number; errors: number; families_linked: number; rejected_csv: string }

@Component({
  selector: 'app-data-import',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6 max-w-5xl">
    <div>
      <a routerLink="/students" class="text-xs font-black text-slate-400 hover:text-indigo-500">&larr; Students</a>
      <h2 class="text-2xl font-black tracking-tight mt-1">Import data from a CSV file</h2>
      <p class="text-sm font-bold text-slate-400 mt-1">Upload a CSV from the old website or any sheet. Column names can be different in every file: the system matches them itself, and you can change any match before saving. Nothing is saved until you press Save.</p>
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div class="flex flex-wrap items-end gap-4">
        <div><label class="label" for="imp-file">CSV file</label><input id="imp-file" type="file" accept=".csv,.txt,text/csv" class="field" (change)="pick($event)"></div>
        <div><label class="label" for="imp-kind">This file has</label>
          <select id="imp-kind" name="kind" class="field" [ngModel]="kind()" (ngModelChange)="setKind($event)"><option value="">Find out automatically</option><option value="students">Students</option><option value="staff">Staff</option></select></div>
        <label class="flex items-center gap-2 text-sm font-bold pb-3"><input type="checkbox" name="cm" [ngModel]="createMissing()" (ngModelChange)="setCreate($event)"> Create missing classes and sections</label>
      </div>
      <p class="text-xs font-bold text-slate-400">No file yet? Download a sample:
        <button type="button" class="text-indigo-600 font-black" (click)="template('students')">students.csv</button> ·
        <button type="button" class="text-indigo-600 font-black" (click)="template('staff')">staff.csv</button>. Save an Excel sheet as "CSV UTF-8" first.</p>
    </div>

    <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
      <h3 class="text-lg font-black">KMCB students, classes XI and XII (2026-27)</h3>
      <p class="text-xs font-bold text-slate-400">The college's own list (name, father, class, admission number, category). 246 students with their admission numbers. Students already in the database are skipped, so this can be run again safely. Take a backup first. 25 names from the end of the sheet had no admission number and are not included (see samples/kmcb-pending-no-admission-no.csv).</p>
      @if (real(); as p) {
        <p class="text-sm font-bold">{{ p.counts.total }} in the list · {{ p.counts.new }} new · {{ p.counts.duplicate }} already there · {{ p.counts.error }} with problems.</p>
        @if (p.counts.new) { <button type="button" class="btn-primary" [disabled]="busy()" (click)="addReal()">Add {{ p.counts.new }} students</button> }
      } @else { <button type="button" class="btn-ghost" (click)="loadReal()">Check what would be added</button> }
    </div>

    @if (a(); as r) {
      <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-lg font-black">{{ r.kind === 'students' ? 'Students' : 'Staff' }} file · {{ fileName() }}</h3>
        <div class="flex flex-wrap gap-3 text-sm font-black">
          <span class="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{{ r.counts.new }} will be saved</span>
          <span class="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300">{{ r.counts.duplicate }} already there (skipped)</span>
          <span class="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600">{{ r.counts.error }} have problems (skipped)</span>
          <span class="px-3 py-1.5 rounded-xl bg-slate-500/10 text-slate-500">{{ r.counts.total }} rows</span>
        </div>

        <h4 class="font-black pt-2">Which column is which?</h4>
        <div class="grid md:grid-cols-2 gap-x-6 gap-y-2">
          @for (h of r.headers; track h; let i = $index) {
            <div class="flex items-center gap-2">
              <label class="flex-1 text-sm font-bold truncate" [for]="'map'+i" [title]="h">{{ h }} <span class="text-slate-400 font-medium">{{ r.sample[0]?.[i] ? '(e.g. ' + r.sample[0][i] + ')' : '' }}</span></label>
              <select [id]="'map'+i" [name]="'map'+i" class="field !w-52" [ngModel]="map()[h] ?? ''" (ngModelChange)="remap(h, $event)">
                <option value="">Ignore this column</option>
                @for (f of r.fields; track f.key) { <option [value]="f.key">{{ f.label }}{{ f.required ? ' *' : '' }}</option> }
              </select>
            </div>
          }
        </div>

        @if (r.rows.length) {
          <h4 class="font-black pt-2">Rows to look at</h4>
          <div class="overflow-x-auto"><table class="w-full text-sm text-left">
            <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2 pr-3">Row</th><th class="py-2 pr-3">Who</th><th class="py-2 pr-3">Result</th><th class="py-2">What</th></tr></thead>
            <tbody>@for (x of r.rows; track x.line) {
              <tr class="border-t border-slate-100 dark:border-slate-800 align-top">
                <td class="py-2 pr-3 font-bold">{{ x.line }}</td><td class="py-2 pr-3 font-black">{{ x.summary }}</td>
                <td class="py-2 pr-3 font-black" [class]="x.status === 'new' ? 'text-emerald-600' : x.status === 'duplicate' ? 'text-amber-600' : 'text-rose-600'">{{ x.status === 'new' ? 'Will be saved' : x.status === 'duplicate' ? 'Already there' : 'Problem' }}</td>
                <td class="py-2 text-slate-500 font-bold">{{ x.problems.concat(x.warnings).join(' · ') }}</td></tr>
            }</tbody></table></div>
          <p class="text-xs font-bold text-slate-400">Only the first rows with a note are listed. Every row is checked.</p>
        }

        <div class="flex flex-wrap gap-3 pt-2">
          <button type="button" class="btn-primary" [disabled]="busy() || !r.counts.new" (click)="save()">Save {{ r.counts.new }} {{ r.kind === 'students' ? 'students' : 'staff' }} to the database</button>
        </div>
        <p class="text-xs font-bold text-slate-400">Uploading the same file again is safe: rows already saved are skipped. After saving, brothers and sisters are linked from CNIC / phone and category and sibling fees are worked out.</p>
      </div>
    }

    @if (done(); as d) {
      <div class="p-6 rounded-[2rem] bg-emerald-500/10 space-y-3">
        <p class="font-black text-emerald-700 dark:text-emerald-300">Saved {{ d.saved }} {{ d.kind === 'students' ? 'students' : 'staff' }}.
          @if (d.kind === 'students' && d.families_linked) { {{ d.families_linked }} brother/sister link(s) made. }
          @if (d.duplicates) { {{ d.duplicates }} were already there. } @if (d.errors) { {{ d.errors }} had problems. }</p>
        @if (d.rejected_csv) { <button type="button" class="btn-ghost" (click)="download(d.rejected_csv)">Download the rows that were not saved (with the reason)</button><p class="text-xs font-bold text-slate-500">Fix them in Excel, delete the last column and upload again.</p> }
      </div>
    }
  </div>
  `
})
export class DataImport {
  private api = inject(Api);
  private toast = inject(ToastService);
  kind = signal<'' | Kind>(''); createMissing = signal(false); fileName = signal('');
  a = signal<Analysis | null>(null); map = signal<Record<string, string>>({}); done = signal<Saved | null>(null);
  error = signal(''); busy = signal(false);
  real = signal<RealPreview | null>(null);
  private text = '';

  async pick(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    this.fileName.set(f.name); this.done.set(null); this.error.set('');
    // UTF-8 first; an old Windows file (Excel "CSV") is read as windows-1252 when UTF-8 shows replacement marks
    const buf = await f.arrayBuffer(); let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);
    this.text = t; this.run(true);
  }
  setKind(k: '' | Kind) { this.kind.set(k); if (this.text) this.run(true); }
  setCreate(v: boolean) { this.createMissing.set(v); if (this.text) this.run(false); }
  remap(h: string, f: string) { const m = { ...this.map() }; if (f) { for (const k of Object.keys(m)) if (m[k] === f) delete m[k]; m[h] = f; } else delete m[h]; this.map.set(m); this.run(false); }
  private body(useAuto: boolean) { return { text: this.text, kind: this.kind() || undefined, createMissing: this.createMissing(), mapping: useAuto ? undefined : this.map() }; }
  private run(useAuto: boolean) {
    this.busy.set(true); this.error.set('');
    this.api.post<Analysis>('/import/analyze', this.body(useAuto)).subscribe({
      next: r => { this.a.set(r); this.map.set(r.mapping); this.busy.set(false); },
      error: e => { this.a.set(null); this.error.set(errorText(e)); this.busy.set(false); }
    });
  }
  save() {
    const r = this.a(); if (!r || !confirm(`Save ${r.counts.new} ${r.kind} to the database?`)) return;
    this.busy.set(true);
    this.api.post<Saved>('/import/commit', { ...this.body(false), kind: r.kind }).subscribe({
      next: s => { this.done.set(s); this.busy.set(false); this.toast.show(`Saved ${s.saved}.`); this.run(false); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  loadReal() { this.api.get<RealPreview>('/import/real-students').subscribe({ next: p => this.real.set(p), error: e => this.error.set(errorText(e)) }); }
  addReal() {
    const p = this.real(); if (!p || !confirm(`Add ${p.counts.new} students to the database?`)) return;
    this.busy.set(true);
    this.api.post<Saved>('/import/real-students', {}).subscribe({ next: s => { this.busy.set(false); this.toast.show(`Added ${s.saved} students.`); this.loadReal(); }, error: e => { this.busy.set(false); this.error.set(errorText(e)); } });
  }
  template(kind: Kind) {
    this.api.get<{ csv: string }>(`/import/template/${kind}`).subscribe({ next: t => this.download(t.csv, `${kind}-sample.csv`), error: e => this.error.set(errorText(e)) });
  }
  download(csv: string, name = 'not-saved.csv') {
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
}
