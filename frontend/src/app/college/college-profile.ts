import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { ToastService } from '../core/toast';
import { PhotoCropper } from '../pages/photo-cropper';
import { initials } from '../hr/hr';

interface Bearer { id: number; post: string; title: string | null; name: string; phone: string | null; email: string | null; qualification: string | null; has_photo: boolean; label: string }
interface Form { post: string; title: string; name: string; phone: string; email: string; qualification: string }
const blank = (): Form => ({ post: 'principal', title: '', name: '', phone: '', email: '', qualification: '' });

/** Shrinks a wide picture (the campus) to at most 1200 px so it stays small. */
function shrinkWide(file: File, maxW = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This picture cannot be read.')); };
    img.src = url;
  });
}

@Component({
  selector: 'app-college-profile',
  imports: [FormsModule, PhotoCropper],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-8">
    <div><h2 class="text-3xl font-black tracking-tighter">College Profile</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Change anything here once and it shows everywhere: the login page, the sidebar, fee vouchers, receipts, letters, ID cards, and the signature lines of printed sheets.</p></div>

    <section class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-hidden">
      <div class="relative h-48 bg-slate-100 dark:bg-slate-800">
        @if (campus()) { <img [src]="campus()" alt="Campus" class="w-full h-full object-cover"> }
        @else { <div class="w-full h-full flex items-center justify-center text-sm font-bold text-slate-400">No campus picture yet</div> }
        <div class="absolute right-4 bottom-4 flex gap-2">
          <label class="btn-ghost bg-white/90 cursor-pointer">{{ campus() ? 'Change picture' : 'Add campus picture' }}<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" (change)="pickCampus($event)"></label>
          @if (campus()) { <button type="button" class="btn-ghost bg-white/90 !text-rose-600" (click)="removeCampus()">Remove</button> }
        </div>
      </div>
      <div class="p-8 space-y-6">
        <div class="flex items-center gap-5">
          @if (settings.logoUrl()) { <img [src]="settings.logoUrl()" alt="College logo" class="w-24 h-24 rounded-2xl object-contain bg-white border border-slate-200 p-1"> }
          @else { <div class="w-24 h-24 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-4xl font-black italic">{{ settings.initial() }}</div> }
          <div class="space-y-2">
            <label class="btn-ghost cursor-pointer">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" (change)="pickLogo($event)"></label>
            @if (settings.logoUrl()) { <button type="button" class="block text-xs font-black text-rose-500" (click)="removeLogo()">Remove logo</button> }
          </div>
        </div>
        <form (ngSubmit)="saveCollege()" class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="md:col-span-2"><label class="label" for="c-name">College name</label><input id="c-name" name="n" class="field" required maxlength="80" [(ngModel)]="f.instituteName"></div>
          <div><label class="label" for="c-short">Short name (e.g. KMCB)</label><input id="c-short" name="s" class="field" maxlength="20" [(ngModel)]="f.shortName"></div>
          <div><label class="label" for="c-motto">Motto</label><input id="c-motto" name="m" class="field" maxlength="120" [(ngModel)]="f.motto"></div>
          <div class="md:col-span-2"><label class="label" for="c-addr">Address</label><input id="c-addr" name="a" class="field" maxlength="160" [(ngModel)]="f.address"></div>
          <div><label class="label" for="c-ph">Phone</label><input id="c-ph" name="p" class="field" maxlength="60" [(ngModel)]="f.phone"></div>
          <div><label class="label" for="c-em">Email</label><input id="c-em" name="e" type="email" class="field" maxlength="80" [(ngModel)]="f.email"></div>
          <div><label class="label" for="c-web">Website</label><input id="c-web" name="w" class="field" maxlength="80" [(ngModel)]="f.website"></div>
          <div><label class="label" for="c-aff">Board / affiliation</label><input id="c-aff" name="f" class="field" maxlength="120" [(ngModel)]="f.affiliation"></div>
          <div><label class="label" for="c-est">Established</label><input id="c-est" name="x" class="field" maxlength="20" placeholder="1985" [(ngModel)]="f.established"></div>
          <div class="md:col-span-2"><label class="label" for="c-pub">Address this system is opened with (used in the QR codes)</label>
            <input id="c-pub" name="pu" class="field" maxlength="120" placeholder="http://192.168.1.10:3000" [(ngModel)]="f.publicUrl">
            <p class="text-xs font-bold text-slate-400 mt-1">Phones on the college WiFi open this when they scan a card. It works without internet. Leave empty to use the address of the browser you are using now.</p>
            @if (settings.lanUrls().length) { <p class="text-xs font-bold mt-1">This computer can be reached at: @for (u of settings.lanUrls(); track u) { <button type="button" class="underline text-indigo-600 mx-1" (click)="f.publicUrl = u">{{ u }}</button> }</p> }</div>
          <div class="md:col-span-2"><button class="btn-primary" type="submit">Save college details</button></div>
        </form>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center gap-3"><div class="flex-1"><h3 class="text-xl font-black tracking-tight">Office-bearers</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Who is the principal, vice principal, headmaster, accounts, HR and admin officer. Their names print under the signature lines.</p></div>
        <button type="button" class="btn-primary" (click)="openForm()">Add a person</button></div>
      @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        @for (b of items(); track b.id) {
          <article class="bg-white dark:bg-slate-900/40 p-5 rounded-[2rem] border border-slate-200 dark:border-slate-800 flex gap-4">
            @if (photos()[b.id]) { <img [src]="photos()[b.id]" [alt]="b.name" class="w-16 h-20 rounded-xl object-cover border border-slate-200"> }
            @else { <div class="w-16 h-20 rounded-xl bg-indigo-600/10 text-indigo-700 flex items-center justify-center text-xl font-black">{{ ini(b.name) }}</div> }
            <div class="flex-1 min-w-0">
              <p class="text-[11px] font-black uppercase tracking-widest text-indigo-600">{{ b.label }}</p>
              <p class="text-lg font-black truncate">{{ b.name }}</p>
              <p class="text-xs font-bold text-slate-400">{{ b.qualification }}</p>
              <p class="text-xs font-bold text-slate-500 mt-1">{{ b.phone }}{{ b.phone && b.email ? ' · ' : '' }}{{ b.email }}</p>
              <div class="flex gap-3 mt-2"><button type="button" class="text-xs font-black text-indigo-600" (click)="openForm(b)">Edit</button><button type="button" class="text-xs font-black text-rose-500" (click)="remove(b)">Remove</button></div>
            </div>
          </article>
        }
      </div>
      @if (!items().length) { <p class="text-sm font-bold text-slate-400">Nobody added yet.</p> }
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
      <h3 class="text-xl font-black tracking-tight">Teaching access</h3>
      <label class="flex items-start gap-3 font-bold"><input type="checkbox" class="w-5 h-5 mt-1 accent-indigo-600" [ngModel]="open()" (ngModelChange)="setOpen($event)">
        <span>Any teacher can take attendance, enter marks, make a paper and print sheets for any class and subject.</span></label>
      <p class="text-xs font-bold text-slate-400">Switch off to go back to "own classes and subjects only". The class teacher always keeps the class sheet, the whole-class result and the parent meetings of their class.</p>
    </section>
  </div>

  @if (editing(); as e) {
    <div class="no-print fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Office-bearer">
      <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-lg space-y-4 max-h-full overflow-y-auto">
        <h3 class="text-xl font-black">{{ e.id ? 'Change details' : 'Add a person' }}</h3>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="label" for="b-post">Post</label><select id="b-post" name="post" class="field" [(ngModel)]="bf.post">@for (p of posts(); track p[0]) { <option [value]="p[0]">{{ p[1] }}</option> }</select></div>
          @if (bf.post === 'other') { <div><label class="label" for="b-title">Title</label><input id="b-title" name="title" class="field" maxlength="40" placeholder="Librarian" [(ngModel)]="bf.title"></div> }
          <div class="col-span-2"><label class="label" for="b-name">Name</label><input id="b-name" name="name" class="field" required maxlength="80" [(ngModel)]="bf.name"></div>
          <div><label class="label" for="b-ph">Phone</label><input id="b-ph" name="ph" class="field" maxlength="30" [(ngModel)]="bf.phone"></div>
          <div><label class="label" for="b-em">Email</label><input id="b-em" name="em" type="email" class="field" maxlength="80" [(ngModel)]="bf.email"></div>
          <div class="col-span-2"><label class="label" for="b-q">Qualification</label><input id="b-q" name="q" class="field" maxlength="120" [(ngModel)]="bf.qualification"></div>
        </div>
        <div class="flex items-center gap-4">
          @if (photo()) { <img [src]="photo()" alt="Photo" class="w-14 h-[4.5rem] rounded-lg object-cover border border-slate-200"> }
          <label class="btn-ghost cursor-pointer">{{ photo() ? 'Change photo' : 'Add photo' }}<input type="file" accept="image/*" class="sr-only" (change)="pickPhoto($event)"></label>
          @if (photo()) { <button type="button" class="text-xs font-black text-rose-500" (click)="photo.set('')">Remove photo</button> }
        </div>
        @if (formError()) { <p role="alert" class="text-sm font-bold text-rose-600">{{ formError() }}</p> }
        <div class="flex justify-end gap-2"><button type="button" class="btn-ghost" (click)="editing.set(null)">Cancel</button><button class="btn-primary" type="submit">Save</button></div>
      </form>
    </div>
  }
  @if (cropFile(); as cf) { <app-photo-cropper [file]="cf" (done)="photo.set($event); cropFile.set(null)" (cancel)="cropFile.set(null)" /> }
  `
})
export class CollegeProfile {
  settings = inject(SettingsService);
  private api = inject(Api); private toast = inject(ToastService);
  f = { instituteName: this.settings.instituteName(), shortName: this.settings.shortName(), address: this.settings.address(), phone: this.settings.phone(), email: this.settings.email(), website: this.settings.website(), publicUrl: this.settings.publicUrl(), motto: this.settings.motto(), affiliation: this.settings.affiliation(), established: this.settings.established() };
  campus = signal(''); open = signal(true);
  items = signal<Bearer[]>([]); posts = signal<[string, string][]>([]); photos = signal<Record<number, string>>({});
  editing = signal<{ id: number | null } | null>(null); bf: Form = blank(); photo = signal(''); cropFile = signal<File | null>(null); formError = signal(''); error = signal('');
  ini = initials;
  private fail = (e: unknown) => this.toast.show(errorText(e), 'error');

  constructor() {
    this.api.get<{ photo: string | null }>('/college/campus-photo').subscribe({ next: r => this.campus.set(r.photo ?? ''), error: () => { /* optional */ } });
    this.api.get<{ teacherOpen: boolean }>('/college/policy').subscribe({ next: r => this.open.set(r.teacherOpen) });
    this.loadList();
  }
  loadList() {
    this.api.get<{ posts: Record<string, string>; items: Bearer[] }>('/college/bearers').subscribe({
      next: r => {
        this.posts.set(Object.entries(r.posts)); this.items.set(r.items);
        for (const b of r.items) if (b.has_photo && !this.photos()[b.id]) this.api.get<{ photo: string | null }>(`/college/bearers/${b.id}/photo`).subscribe(p => p.photo && this.photos.update(m => ({ ...m, [b.id]: p.photo! })));
      }, error: e => this.error.set(errorText(e))
    });
  }
  saveCollege() {
    this.api.put<Record<string, string>>('/settings', this.f).subscribe({
      next: r => { this.settings.apply(r); document.title = this.settings.instituteName(); this.toast.show('College details saved.'); }, error: this.fail });
  }
  async pickCampus(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
    try { const dataUrl = await shrinkWide(file); this.api.put('/college/campus-photo', { dataUrl }).subscribe({ next: () => { this.campus.set(dataUrl); this.toast.show('Campus picture saved.'); }, error: this.fail }); }
    catch (e) { this.toast.show((e as Error).message, 'error'); }
  }
  removeCampus() { this.api.delete('/college/campus-photo').subscribe({ next: () => this.campus.set(''), error: this.fail }); }
  /** The logo is shrunk to 480 px before it is sent. */
  pickLogo(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      this.api.put('/settings/logo', { dataUrl: c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9) }).subscribe({ next: () => { this.settings.apply({ hasLogo: true, logoVersion: String(Date.now()) }); this.toast.show('Logo saved.'); }, error: this.fail });
    };
    img.onerror = () => { URL.revokeObjectURL(url); this.toast.show('This picture cannot be read.', 'error'); };
    img.src = url;
  }
  removeLogo() { this.api.delete('/settings/logo').subscribe({ next: () => this.settings.apply({ hasLogo: false, logoVersion: String(Date.now()) }), error: this.fail }); }

  openForm(b?: Bearer) {
    this.formError.set(''); this.bf = b ? { post: b.post, title: b.post === 'other' ? (b.title ?? '') : '', name: b.name, phone: b.phone ?? '', email: b.email ?? '', qualification: b.qualification ?? '' } : blank();
    this.photo.set(b ? (this.photos()[b.id] ?? '') : ''); this.editing.set({ id: b?.id ?? null });
  }
  pickPhoto(ev: Event) { const input = ev.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (f) this.cropFile.set(f); }
  save() {
    const e = this.editing(); if (!e) return;
    const body: Record<string, unknown> = { ...this.bf, photo: this.photo() || null };
    const req = e.id ? this.api.put(`/college/bearers/${e.id}`, body) : this.api.post('/college/bearers', body);
    req.subscribe({
      next: () => { this.editing.set(null); this.photos.set({}); this.loadList(); this.refreshPublic(); this.toast.show('Saved.'); },
      error: err => this.formError.set(errorText(err))
    });
  }
  remove(b: Bearer) {
    if (!confirm(`Remove ${b.name} (${b.label})?`)) return;
    this.api.delete(`/college/bearers/${b.id}`).subscribe({ next: () => { this.loadList(); this.refreshPublic(); }, error: this.fail });
  }
  setOpen(on: boolean) { this.api.put<{ teacherOpen: boolean }>('/college/policy', { teacherOpen: on }).subscribe({ next: r => { this.open.set(r.teacherOpen); this.toast.show(r.teacherOpen ? 'Teachers can work on any class and subject.' : 'Teachers are limited to their own classes and subjects.'); }, error: e => { this.open.set(!on); this.fail(e); } }); }
  private refreshPublic() { this.settings.load(); }
}
