import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { shrinkImage } from '../core/files';
import { ToastService } from '../core/toast';

interface ScanRow { line: number; student_id: number | null; name: string; reg_no: string; entry: { marks: number | null; status: string } | null; problem: string | null; read_marks: string; read_name: string; warning: string | null }
interface Row { line: number; student_id: number | null; name: string; read_name: string; marks: string; status: string; problem: string | null; warning: string | null }

/** Take a photo of the handwritten award list; the marks are read, shown here for checking, and saved only when the teacher confirms. */
@Component({
  selector: 'app-marks-scan',
  imports: [FormsModule],
  template: `
  <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4 no-print">
    <div><h3 class="text-lg font-black">Marks from a photo</h3>
      <p class="text-xs font-bold text-slate-400 mt-1">Photograph the filled award list (flat, well lit, whole page). The handwriting is read for you; check every row below before saving. Reading is not perfect, so the numbers on screen are yours to correct.</p></div>
    @if (canEdit) {
      <label class="btn-primary cursor-pointer inline-flex"><span>{{ busy() ? 'Reading…' : 'Take or choose photo' }}</span><input type="file" class="sr-only" accept="image/*" capture="environment" (change)="pick($event)" aria-label="Photo of the marks sheet" [disabled]="busy()"></label>
    }
    @if (error()) { <p role="alert" class="p-3 rounded-xl bg-rose-500/10 text-rose-600 text-sm font-bold">{{ error() }}</p> }
    @if (rows().length) {
      <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-[11px] font-black text-slate-400 uppercase"><th class="py-2 pr-2">Student</th><th class="py-2 pr-2 w-28">Marks (max {{ max() }})</th><th class="py-2 pr-2 w-20">A / L</th><th class="py-2">Check</th></tr></thead>
        <tbody>@for (r of rows(); track r.line) {
          <tr class="border-t border-slate-100 dark:border-slate-800 align-top"><td class="py-2 pr-2 font-bold">{{ r.name || r.read_name || '?' }}</td>
            <td class="py-2 pr-2"><input class="field !py-1" inputmode="decimal" [attr.aria-label]="'Marks of ' + r.name" [ngModel]="r.marks" (ngModelChange)="edit(r, 'marks', $event)" [disabled]="!r.student_id"></td>
            <td class="py-2 pr-2"><select class="field !py-1" [attr.aria-label]="'Status of ' + r.name" [ngModel]="r.status" (ngModelChange)="edit(r, 'status', $event)" [disabled]="!r.student_id"><option value="P">P</option><option value="A">A</option><option value="L">L</option></select></td>
            <td class="py-2 text-xs font-bold">@if (r.problem) { <span class="text-rose-600">{{ r.problem }}</span> } @else if (r.warning) { <span class="text-amber-600">{{ r.warning }}</span> } @else { <span class="text-emerald-600">OK</span> }</td></tr>
        }</tbody></table></div>
      <div class="flex gap-3"><button type="button" class="btn-primary" [disabled]="!readyCount() || busy()" (click)="commit()">Save {{ readyCount() }} marks</button><button type="button" class="btn-ghost" (click)="reset()">Cancel</button></div>
    }
  </section>
  `
})
export class MarksScan {
  private api = inject(Api); private http = inject(HttpClient); private toast = inject(ToastService);
  @Input({ required: true }) paperId!: number;
  @Input() canEdit = false;
  @Output() saved = new EventEmitter<void>();
  rows = signal<Row[]>([]); max = signal(0); error = signal(''); busy = signal(false);

  readyCount() { return this.rows().filter(r => r.student_id && (r.status !== 'P' || (r.marks.trim() !== '' && this.valid(r.marks)))).length; }
  private valid(m: string) { const n = Number(m.replace(',', '.')); return Number.isFinite(n) && n >= 0 && n <= this.max(); }
  edit(r: Row, k: 'marks' | 'status', v: string) {
    r[k] = v; r.problem = r.status === 'P' && r.marks.trim() !== '' && !this.valid(r.marks) ? `Must be a number from 0 to ${this.max()}.` : null;
    this.rows.update(x => [...x]);
  }
  reset() { this.rows.set([]); this.error.set(''); }

  async pick(ev: Event) {
    const input = ev.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (!f) return;
    this.busy.set(true); this.error.set(''); this.rows.set([]);
    const blob = await shrinkImage(f);
    this.http.post<{ max: number; rows: ScanRow[] }>(`/api/exam/papers/${this.paperId}/marks-scan`, blob, { headers: { 'Content-Type': 'application/octet-stream' } }).subscribe({
      next: r => {
        this.busy.set(false); this.max.set(r.max);
        this.rows.set(r.rows.map(x => ({ line: x.line, student_id: x.student_id, name: x.name, read_name: x.read_name, status: x.entry?.status ?? 'P', marks: x.entry?.marks != null ? String(x.entry.marks) : (x.problem ? x.read_marks : ''), problem: x.problem, warning: x.warning })));
        if (!r.rows.length) this.error.set('No rows could be read. Take the photo again, closer and flatter.');
      },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  commit() {
    this.busy.set(true);
    const rows = this.rows().filter(r => r.student_id).map(r => ({ student_id: r.student_id, marks: r.marks.replace(',', '.'), status: r.status }));
    this.api.post<{ saved: number; skipped: number }>(`/exam/papers/${this.paperId}/marks-scan/commit`, { rows }).subscribe({
      next: r => { this.busy.set(false); this.toast.show(`Marks saved for ${r.saved} students.`); this.reset(); this.saved.emit(); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
}
