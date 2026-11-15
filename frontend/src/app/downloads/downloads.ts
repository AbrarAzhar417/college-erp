import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassInfo } from '../core/models';

interface DlFile { id: number; title: string; category: string; class_id: number | null; class_name: string | null; subject: string | null; description: string; filename: string; mime: string; size: number; uploaded_at: string; downloads: number; uploaded_by: number | null; uploaded_by_name: string | null }
const CATS: Record<string, string> = { forms: 'Forms', datesheets: 'Date sheets', notes: 'Notes', syllabus: 'Syllabus', circulars: 'Circulars', other: 'Other' };
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

@Component({
  selector: 'app-downloads',
  imports: [FormsModule],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Download Center</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Forms, date sheets, notes and syllabus in one place. PDF, JPG, PNG, Word, Excel and PowerPoint up to 6 MB.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (canUpload()) {
      <form (ngSubmit)="upload()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
        <h3 class="col-span-2 md:col-span-4 font-black">Add a file</h3>
        <div class="col-span-2"><label class="label" for="u-title">Title</label><input id="u-title" name="title" class="field" required maxlength="120" [(ngModel)]="uf.title"></div>
        <div><label class="label" for="u-cat">Category</label><select id="u-cat" name="cat" class="field" [(ngModel)]="uf.category">@for (c of uploadCats(); track c.key) { <option [value]="c.key">{{ c.label }}</option> }</select></div>
        <div><label class="label" for="u-cls">Class (optional)</label><select id="u-cls" name="cls" class="field" [(ngModel)]="uf.class_id"><option [ngValue]="0">All classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="u-sub">Subject (optional)</label><input id="u-sub" name="sub" class="field" maxlength="60" [(ngModel)]="uf.subject"></div>
        <div class="col-span-2"><label class="label" for="u-desc">Short description (optional)</label><input id="u-desc" name="desc" class="field" maxlength="300" [(ngModel)]="uf.description"></div>
        <div class="col-span-2 md:col-span-4"><label class="label" for="u-file">File</label><input id="u-file" #fileInput name="file" type="file" class="field" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx" (change)="picked(fileInput)"></div>
        <div class="col-span-2 md:col-span-4"><button class="btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Uploading...' : 'Upload' }}</button></div>
      </form>
    }

    <div class="flex flex-wrap items-end gap-3">
      <div><label class="label" for="f-cat">Category</label><select id="f-cat" name="fcat" class="field" [ngModel]="cat()" (ngModelChange)="cat.set($event); load()"><option value="">All</option>@for (c of cats; track c.key) { <option [value]="c.key">{{ c.label }}</option> }</select></div>
      <div><label class="label" for="f-cls">Class</label><select id="f-cls" name="fcls" class="field" [ngModel]="cls()" (ngModelChange)="cls.set($event); load()"><option [ngValue]="0">All</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
      <div class="flex-1 min-w-48"><label class="label" for="f-q">Search</label><input id="f-q" name="fq" class="field" placeholder="Title or subject" [ngModel]="q()" (ngModelChange)="q.set($event); load()"></div>
    </div>

    <div class="space-y-2">
      @for (f of files(); track f.id) {
        <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
          <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">{{ catLabel[f.category] }}</span>
          <div class="flex-1 min-w-48"><div class="font-black">{{ f.title }}</div>
            <div class="text-xs font-bold text-slate-400">{{ f.class_name ?? 'All classes' }}{{ f.subject ? ' · ' + f.subject : '' }} · {{ size(f.size) }} · {{ f.uploaded_by_name ?? '-' }} · {{ f.uploaded_at.slice(0, 10) }} · {{ f.downloads }} downloads</div>
            @if (f.description) { <div class="text-sm text-slate-500">{{ f.description }}</div> }</div>
          <button type="button" class="btn-primary" (click)="download(f)">Download</button>
          @if (canChange(f)) { <button type="button" class="text-xs font-black text-rose-500" (click)="remove(f)" [attr.aria-label]="'Delete ' + f.title">Delete</button> }
        </div>
      } @empty { <p class="p-10 text-center text-sm font-bold text-slate-400">No files found.</p> }
    </div>
  </div>
  `
})
export class Downloads {
  private api = inject(Api); private http = inject(HttpClient); private toast = inject(ToastService); private auth = inject(AuthService);
  cats = Object.entries(CATS).map(([key, label]) => ({ key, label })); catLabel = CATS; size = kb;
  role = computed(() => this.auth.user()?.role ?? ''); canUpload = computed(() => ['director', 'principal', 'admin', 'teacher'].includes(this.role()));
  uploadCats = computed(() => (this.role() === 'teacher' ? this.cats.filter(c => c.key === 'notes') : this.cats));
  files = signal<DlFile[]>([]); classes = signal<{ id: number; name: string }[]>([]); error = signal(''); busy = signal(false);
  cat = signal(''); cls = signal(0); q = signal(''); file: File | null = null;
  uf = { title: '', category: this.role() === 'teacher' ? 'notes' : 'forms', class_id: 0, subject: '', description: '' };
  constructor() {
    this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => this.classes.set(c.map(k => ({ id: k.id, name: k.name }))) });
    this.load();
  }
  load() { this.api.get<DlFile[]>('/downloads', { category: this.cat(), class_id: this.cls() || '', q: this.q() }).subscribe({ next: r => this.files.set(r), error: e => this.error.set(errorText(e)) }); }
  canChange(f: DlFile) { return ['director', 'principal', 'admin'].includes(this.role()) || f.uploaded_by === this.auth.user()?.id; }
  picked(i: HTMLInputElement) { this.file = i.files?.[0] ?? null; if (this.file && !this.uf.title) this.uf.title = this.file.name.replace(/\.[^.]+$/, ''); }
  upload() {
    const f = this.file; if (!f) { this.toast.show('Choose a file first.', 'error'); return; }
    const p = new URLSearchParams({ title: this.uf.title, category: this.uf.category, name: f.name, subject: this.uf.subject, description: this.uf.description }); if (this.uf.class_id) p.set('class_id', String(this.uf.class_id));
    this.busy.set(true);
    this.http.post(`/api/downloads?${p}`, f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }).subscribe({
      next: () => { this.busy.set(false); this.toast.show('Uploaded.'); this.file = null; this.uf = { ...this.uf, title: '', subject: '', description: '' }; (document.getElementById('u-file') as HTMLInputElement | null)?.setAttribute('value', ''); this.load(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
  download(f: DlFile) {
    this.api.get<{ filename: string; mime: string; base64: string }>(`/downloads/${f.id}/file`).subscribe({
      next: r => { const bin = atob(r.base64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: r.mime })), a = document.createElement('a'); a.href = url; a.download = r.filename; a.click(); URL.revokeObjectURL(url); this.load(); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
  remove(f: DlFile) { if (confirm(`Delete "${f.title}"?`)) this.api.delete(`/downloads/${f.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
