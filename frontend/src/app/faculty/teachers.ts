import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { PhotoCropper } from '../pages/photo-cropper';
import { fmtCnic, fmtPhone } from '../pages/admission/form-data';
import { initials } from '../hr/hr';

interface Rank { key: string; label: string }
interface Subj { id: number; name: string }
interface Teacher {
  id: number; name: string; rank: string | null; rank_label: string | null; phone: string | null; email: string | null; cnic: string | null; qualification: string | null; address: string | null;
  joining_date: string | null; gender: string | null; max_per_day: number; max_per_week: number; has_photo: boolean; user_id: number | null; username: string | null; login_active: boolean | null;
  subjects: Subj[]; class_teacher_of: string[]; load: number; staff_id: number | null;
}
interface Form { name: string; rank: string; gender: string; phone: string; email: string; cnic: string; qualification: string; address: string; joining_date: string; max_per_day: number; max_per_week: number; subjects: number[]; username: string; password: string }
const blank = (): Form => ({ name: '', rank: '', gender: '', phone: '', email: '', cnic: '', qualification: '', address: '', joining_date: '', max_per_day: 6, max_per_week: 30, subjects: [], username: '', password: '' });
const suggestPassword = () => { const c = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 10; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };

@Component({
  selector: 'app-teachers',
  imports: [FormsModule, PhotoCropper],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex-1 min-w-64"><h2 class="text-3xl font-black tracking-tighter">Teachers</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">Add a teacher, change any detail, give or reset the login, and set the rank from Educator up to Professor.</p></div>
      <button type="button" class="btn-primary" (click)="openForm()">Add a teacher</button>
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-center">
      <button type="button" class="p-3 rounded-2xl" [class]="rankFilter() === '' ? 'bg-indigo-600 text-white' : 'bg-slate-500/5'" (click)="rankFilter.set('')"><div class="text-xl font-black">{{ items().length }}</div><div class="text-[10px] font-black uppercase tracking-widest">All</div></button>
      @for (r of ranks(); track r.key) {
        <button type="button" class="p-3 rounded-2xl" [class]="rankFilter() === r.key ? 'bg-indigo-600 text-white' : 'bg-slate-500/5'" (click)="rankFilter.set(r.key)"><div class="text-xl font-black">{{ countOf(r.key) }}</div><div class="text-[10px] font-black uppercase tracking-widest">{{ r.label }}</div></button>
      }
    </div>

    <div class="flex flex-wrap gap-3">
      <div class="flex-1 min-w-64"><label class="label" for="t-q">Search</label><input id="t-q" class="field" placeholder="Name, phone, subject or username" [ngModel]="q()" (ngModelChange)="q.set($event)"></div>
      <label class="flex items-center gap-2 text-sm font-bold pb-3"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="noLoginOnly()" (ngModelChange)="noLoginOnly.set($event)"> Only teachers without a login</label>
    </div>

    <div class="space-y-3">
      @for (t of shown(); track t.id) {
        <article class="bg-white dark:bg-slate-900/40 p-4 rounded-[2rem] border border-slate-200 dark:border-slate-800 flex flex-wrap gap-4 items-center">
          @if (photos()[t.id]) { <img [src]="photos()[t.id]" [alt]="t.name" class="w-14 h-[4.5rem] rounded-xl object-cover border border-slate-200"> }
          @else { <div class="w-14 h-[4.5rem] rounded-xl bg-indigo-600/10 text-indigo-700 flex items-center justify-center text-lg font-black">{{ ini(t.name) }}</div> }
          <div class="flex-1 min-w-56">
            <p class="text-lg font-black">{{ t.name }}</p>
            <p class="text-xs font-black uppercase tracking-widest text-indigo-600">{{ t.rank_label || 'Rank not set' }}</p>
            <p class="text-xs font-bold text-slate-500 mt-1">{{ subjectNames(t) || 'No subjects yet' }}</p>
            @if (t.class_teacher_of.length) { <p class="text-xs font-bold text-emerald-700">Class teacher of {{ joined(t.class_teacher_of) }}</p> }
          </div>
          <div class="text-xs font-bold text-slate-500 min-w-40">
            <p>{{ t.phone }}</p><p>{{ t.qualification }}</p><p>{{ t.load }} periods a week</p>
          </div>
          <div class="min-w-40 text-xs font-bold">
            @if (t.user_id) { <p>Login: <span class="font-black">{{ t.username }}</span></p><p [class]="t.login_active ? 'text-emerald-600' : 'text-rose-600'">{{ t.login_active ? 'Can sign in' : 'Login switched off' }}</p> }
            @else { <p class="text-amber-700">No login yet</p> }
          </div>
          <div class="flex gap-3 text-xs font-black">
            <button type="button" class="text-indigo-600" (click)="openForm(t)">Edit</button>
            <button type="button" class="text-indigo-600" (click)="openLogin(t)">{{ t.user_id ? 'Login and password' : 'Give a login' }}</button>
            <button type="button" class="text-rose-500" (click)="remove(t)">Remove</button>
          </div>
        </article>
      }
      @if (loaded() && !shown().length) { <p class="text-sm font-bold text-slate-400">No teachers to show.</p> }
    </div>
  </div>

  @if (editing(); as e) {
    <div class="no-print fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Teacher details">
      <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-3xl space-y-4 max-h-full overflow-y-auto">
        <h3 class="text-xl font-black">{{ e.id ? 'Change teacher details' : 'Add a teacher' }}</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="md:col-span-2"><label class="label" for="f-name">Name</label><input id="f-name" name="name" class="field" required maxlength="80" [(ngModel)]="tf.name"></div>
          <div><label class="label" for="f-rank">Rank</label><select id="f-rank" name="rank" class="field" [(ngModel)]="tf.rank"><option value="">Not set</option>@for (r of ranks(); track r.key) { <option [value]="r.key">{{ r.label }}</option> }</select></div>
          <div><label class="label" for="f-gen">Gender</label><select id="f-gen" name="gender" class="field" [(ngModel)]="tf.gender"><option value="">-</option><option value="male">Male</option><option value="female">Female</option></select></div>
          <div><label class="label" for="f-ph">Phone</label><input id="f-ph" name="ph" class="field" inputmode="numeric" maxlength="12" placeholder="0300-1234567" [ngModel]="tf.phone" (ngModelChange)="tf.phone = fp($event)"></div>
          <div><label class="label" for="f-cnic">CNIC</label><input id="f-cnic" name="cnic" class="field" inputmode="numeric" maxlength="15" placeholder="12345-1234567-1" [ngModel]="tf.cnic" (ngModelChange)="tf.cnic = fc($event)"></div>
          <div><label class="label" for="f-em">Email</label><input id="f-em" name="em" type="email" class="field" maxlength="80" [(ngModel)]="tf.email"></div>
          <div><label class="label" for="f-q">Qualification</label><input id="f-q" name="q" class="field" maxlength="120" [(ngModel)]="tf.qualification"></div>
          <div><label class="label" for="f-j">Joining date</label><input id="f-j" name="j" type="date" class="field" [(ngModel)]="tf.joining_date"></div>
          <div class="md:col-span-3"><label class="label" for="f-ad">Address</label><input id="f-ad" name="ad" class="field" maxlength="200" [(ngModel)]="tf.address"></div>
          <div><label class="label" for="f-md">Most periods a day</label><input id="f-md" name="md" type="number" min="1" max="12" class="field" [(ngModel)]="tf.max_per_day"></div>
          <div><label class="label" for="f-mw">Most periods a week</label><input id="f-mw" name="mw" type="number" min="1" max="70" class="field" [(ngModel)]="tf.max_per_week"></div>
        </div>
        <div><p class="label">Subjects this teacher can teach</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            @for (s of subjects(); track s.id) { <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" class="w-4 h-4 accent-indigo-600" [checked]="has(s.id)" (change)="toggle(s.id)"> {{ s.name }}</label> }
          </div>
          @if (!subjects().length) { <p class="text-xs font-bold text-slate-400">No subjects yet. Add them in Timetable, Subjects.</p> }
        </div>
        <div class="flex items-center gap-4">
          @if (photo()) { <img [src]="photo()" alt="Photo" class="w-14 h-[4.5rem] rounded-lg object-cover border border-slate-200"> }
          <label class="btn-ghost cursor-pointer">{{ photo() ? 'Change photo' : 'Add photo' }}<input type="file" accept="image/*" class="sr-only" (change)="pickPhoto($event)"></label>
          @if (photo()) { <button type="button" class="text-xs font-black text-rose-500" (click)="photo.set('')">Remove photo</button> }
        </div>
        @if (!e.id) {
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl bg-slate-500/5">
            <p class="md:col-span-2 text-sm font-black">Login (optional, can be given later)</p>
            <div><label class="label" for="f-un">Username</label><input id="f-un" name="un" class="field" maxlength="30" autocomplete="off" [(ngModel)]="tf.username"></div>
            <div><label class="label" for="f-pw">Password (at least 8 characters)</label><div class="flex gap-2"><input id="f-pw" name="pw" class="field" maxlength="60" autocomplete="off" [(ngModel)]="tf.password"><button type="button" class="btn-ghost" (click)="tf.password = suggest()">Make one</button></div></div>
          </div>
        }
        @if (formError()) { <p role="alert" class="text-sm font-bold text-rose-600">{{ formError() }}</p> }
        <div class="flex justify-end gap-2"><button type="button" class="btn-ghost" (click)="editing.set(null)">Cancel</button><button class="btn-primary" type="submit">Save</button></div>
      </form>
    </div>
  }

  @if (loginFor(); as t) {
    <div class="no-print fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Teacher login">
      <form (ngSubmit)="saveLogin()" class="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md space-y-4">
        <h3 class="text-xl font-black">Login of {{ t.name }}</h3>
        <div><label class="label" for="l-un">Username</label><input id="l-un" name="un" class="field" required maxlength="30" autocomplete="off" [(ngModel)]="lf.username"></div>
        <div><label class="label" for="l-pw">{{ t.user_id ? 'New password (leave empty to keep the old one)' : 'Password (at least 8 characters)' }}</label>
          <div class="flex gap-2"><input id="l-pw" name="pw" class="field" maxlength="60" autocomplete="off" [(ngModel)]="lf.password"><button type="button" class="btn-ghost" (click)="lf.password = suggest()">Make one</button></div></div>
        @if (t.user_id) { <label class="flex items-center gap-2 font-bold text-sm"><input type="checkbox" name="act" class="w-5 h-5 accent-indigo-600" [(ngModel)]="lf.active"> This teacher can sign in</label> }
        @if (lastPassword()) { <p class="p-3 rounded-xl bg-emerald-500/10 text-emerald-700 text-sm font-bold">Saved. Give the teacher: username <b>{{ lf.username }}</b>, password <b>{{ lastPassword() }}</b>. It is not shown again.</p> }
        @if (loginError()) { <p role="alert" class="text-sm font-bold text-rose-600">{{ loginError() }}</p> }
        <div class="flex justify-end gap-2"><button type="button" class="btn-ghost" (click)="closeLogin()">Close</button><button class="btn-primary" type="submit">{{ t.user_id ? 'Save' : 'Create login' }}</button></div>
      </form>
    </div>
  }
  @if (cropFile(); as cf) { <app-photo-cropper [file]="cf" (done)="photo.set($event); cropFile.set(null)" (cancel)="cropFile.set(null)" /> }
  `
})
export class Teachers {
  private api = inject(Api); private toast = inject(ToastService);
  items = signal<Teacher[]>([]); ranks = signal<Rank[]>([]); subjects = signal<Subj[]>([]); photos = signal<Record<number, string>>({});
  q = signal(''); rankFilter = signal(''); noLoginOnly = signal(false); loaded = signal(false); error = signal('');
  editing = signal<{ id: number | null } | null>(null); tf: Form = blank(); photo = signal(''); photoChanged = false; cropFile = signal<File | null>(null); formError = signal('');
  loginFor = signal<Teacher | null>(null); lf = { username: '', password: '', active: true }; loginError = signal(''); lastPassword = signal('');
  ini = initials; fp = fmtPhone; fc = fmtCnic; suggest = suggestPassword;
  private fail = (e: unknown) => this.toast.show(errorText(e), 'error');

  shown = computed(() => {
    const q = this.q().trim().toLowerCase(), r = this.rankFilter(), nl = this.noLoginOnly();
    return this.items().filter(t => (!r || t.rank === r) && (!nl || !t.user_id)
      && (!q || [t.name, t.phone ?? '', t.username ?? '', ...t.subjects.map(s => s.name)].some(x => x.toLowerCase().includes(q))));
  });
  countOf(key: string) { return this.items().filter(t => t.rank === key).length; }
  subjectNames(t: Teacher) { return t.subjects.map(s => s.name).join(', '); }
  joined(a: string[]) { return a.join(', '); }
  has(id: number) { return this.tf.subjects.includes(id); }
  toggle(id: number) { this.tf.subjects = this.has(id) ? this.tf.subjects.filter(x => x !== id) : [...this.tf.subjects, id]; }

  constructor() { const q = inject(ActivatedRoute).snapshot.queryParamMap.get('q'); if (q) this.q.set(q); this.load(); }
  load() {
    this.api.get<{ ranks: Rank[]; subjects: Subj[]; items: Teacher[] }>('/faculty').subscribe({
      next: r => {
        this.ranks.set(r.ranks); this.subjects.set(r.subjects); this.items.set(r.items); this.loaded.set(true);
        for (const t of r.items) if (t.has_photo && !this.photos()[t.id]) this.api.get<{ photo: string | null }>(`/faculty/${t.id}/photo`).subscribe(p => p.photo && this.photos.update(m => ({ ...m, [t.id]: p.photo! })));
      }, error: e => { this.error.set(errorText(e)); this.loaded.set(true); }
    });
  }

  openForm(t?: Teacher) {
    this.formError.set(''); this.photoChanged = false;
    this.tf = t ? { name: t.name, rank: t.rank ?? '', gender: t.gender ?? '', phone: t.phone ?? '', email: t.email ?? '', cnic: t.cnic ?? '', qualification: t.qualification ?? '', address: t.address ?? '', joining_date: t.joining_date ?? '', max_per_day: t.max_per_day, max_per_week: t.max_per_week, subjects: t.subjects.map(s => s.id), username: '', password: '' } : blank();
    this.photo.set(t ? (this.photos()[t.id] ?? '') : ''); this.editing.set({ id: t?.id ?? null });
  }
  pickPhoto(ev: Event) { const input = ev.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (f) { this.photoChanged = true; this.cropFile.set(f); } }
  save() {
    const e = this.editing(); if (!e) return;
    const f = this.tf, body: Record<string, unknown> = { name: f.name, rank: f.rank, gender: f.gender, phone: f.phone, email: f.email, cnic: f.cnic, qualification: f.qualification, address: f.address, joining_date: f.joining_date, max_per_day: f.max_per_day, max_per_week: f.max_per_week, subjects: f.subjects };
    if (e.id) { if (this.photoChanged || !this.photo()) body['photo'] = this.photo() || null; }
    else { if (this.photo()) body['photo'] = this.photo(); if (f.username || f.password) body['login'] = { username: f.username, password: f.password }; }
    (e.id ? this.api.put(`/faculty/${e.id}`, body) : this.api.post('/faculty', body)).subscribe({
      next: () => { this.editing.set(null); this.photos.set({}); this.load(); this.toast.show('Saved.'); },
      error: err => this.formError.set(errorText(err))
    });
  }

  openLogin(t: Teacher) { this.loginError.set(''); this.lastPassword.set(''); this.lf = { username: t.username ?? '', password: '', active: t.login_active ?? true }; this.loginFor.set(t); }
  closeLogin() { this.loginFor.set(null); this.load(); }
  saveLogin() {
    const t = this.loginFor(); if (!t) return;
    const body: Record<string, unknown> = { username: this.lf.username };
    if (this.lf.password) body['password'] = this.lf.password;
    if (t.user_id) body['active'] = this.lf.active;
    this.api.post(`/faculty/${t.id}/login`, body).subscribe({
      next: () => { this.loginError.set(''); this.lastPassword.set(this.lf.password); this.toast.show('Login saved.'); this.api.get<{ items: Teacher[] }>('/faculty').subscribe(r => { this.items.set(r.items); this.loginFor.set(r.items.find(x => x.id === t.id) ?? null); }); },
      error: e => this.loginError.set(errorText(e))
    });
  }

  remove(t: Teacher) {
    if (!confirm(`Remove ${t.name}? The login is closed too.`)) return;
    this.api.delete(`/faculty/${t.id}`).subscribe({
      next: () => this.load(),
      error: (e: unknown) => {
        const body = (e as HttpErrorResponse)?.error;
        if (body?.needsForce && confirm(`${body.message}`)) this.api.delete(`/faculty/${t.id}?force=1`).subscribe({ next: () => this.load(), error: this.fail });
        else if (!body?.needsForce) this.fail(e);
      }
    });
  }
}
