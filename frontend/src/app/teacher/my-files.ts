import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { kb, saveBase64 } from '../core/files';
import { ToastService } from '../core/toast';

interface MyFile { id: number; title: string; kind: string; filename: string; mime: string; size: number; uploaded_at: string }
const KINDS: Record<string, string> = { paper: 'Paper', marks: 'Marks file', notes: 'Notes', other: 'Other' };

@Component({
  selector: 'app-my-files',
  imports: [FormsModule],
  template: `
  <div class="max-w-4xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">My Files</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Your own papers, marks sheets and notes. Only you and the principal can open them. PDF, Word, Excel, PowerPoint, CSV, text, JPG and PNG up to 10 MB.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <form (ngSubmit)="upload()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 gap-4">
      <div class="col-span-2 md:col-span-1"><label class="label" for="f-title">Title</label><input id="f-title" name="title" class="field" required maxlength="120" [(ngModel)]="title"></div>
      <div class="col-span-2 md:col-span-1"><label class="label" for="f-kind">Kind</label><select id="f-kind" name="kind" class="field" [(ngModel)]="kind">@for (k of kinds; track k.key) { <option [value]="k.key">{{ k.label }}</option> }</select></div>
      <div class="col-span-2"><label class="label" for="f-file">File</label><input id="f-file" name="file" type="file" class="field" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png" (change)="picked($event)"></div>
      <div class="col-span-2"><button class="btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Uploading...' : 'Upload' }}</button></div>
    </form>
    <div class="space-y-2">
      @for (f of files(); track f.id) {
        <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">{{ label[f.kind] }}</span>
          <div class="flex-1 min-w-48"><div class="font-black">{{ f.title }}</div><div class="text-xs font-bold text-slate-400">{{ f.filename }} · {{ size(f.size) }} · {{ f.uploaded_at.slice(0, 10) }}</div></div>
          <button type="button" class="btn-ghost" (click)="download(f)">Download</button>
          <button type="button" class="text-xs font-black text-rose-500" (click)="remove(f)" [attr.aria-label]="'Delete ' + f.title">Delete</button>
        </div>
      } @empty { <p class="p-10 text-center text-sm font-bold text-slate-400">No files yet.</p> }
    </div>
  </div>
  `
})
export class MyFiles {
  private api = inject(Api); private http = inject(HttpClient); private toast = inject(ToastService);
  kinds = Object.entries(KINDS).map(([key, label]) => ({ key, label })); label = KINDS; size = kb;
  files = signal<MyFile[]>([]); error = signal(''); busy = signal(false); title = ''; kind = 'paper'; private file: File | null = null;
  empty = computed(() => this.files().length === 0);
  constructor() { this.load(); }
  load() { this.api.get<MyFile[]>('/my-files').subscribe({ next: r => this.files.set(r), error: e => this.error.set(errorText(e)) }); }
  picked(ev: Event) { this.file = (ev.target as HTMLInputElement).files?.[0] ?? null; if (this.file && !this.title) this.title = this.file.name.replace(/\.[^.]+$/, ''); }
  upload() {
    const f = this.file; if (!f) { this.toast.show('Choose a file first.', 'error'); return; }
    this.busy.set(true);
    this.http.post(`/api/my-files?title=${encodeURIComponent(this.title)}&kind=${this.kind}&name=${encodeURIComponent(f.name)}`, f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }).subscribe({
      next: () => { this.busy.set(false); this.toast.show('Uploaded.'); this.title = ''; this.file = null; this.load(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
  download(f: MyFile) { this.api.get<{ filename: string; mime: string; base64: string }>(`/my-files/${f.id}/file`).subscribe({ next: saveBase64, error: e => this.toast.show(errorText(e), 'error') }); }
  remove(f: MyFile) { if (confirm(`Delete "${f.title}"?`)) this.api.delete(`/my-files/${f.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
