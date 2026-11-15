import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';

interface View { folder: string; email: string; webdav: { url: string; user: string; pass_set: boolean }; pass_set: boolean; report: { at: string; file: string; results: { where: string; ok: boolean; note: string }[] } | null }

@Component({
  selector: 'app-offsite',
  imports: [FormsModule],
  template: `
  <section class="space-y-4">
    <p class="text-sm font-bold text-slate-500">A backup that stays on this computer is lost with this computer. Here you choose where a second copy goes after every daily backup. Copies are compressed and <b>encrypted</b> with your passphrase, so a stolen mailbox or drive shows nothing. <b>The passphrase cannot be recovered. If you forget it the copies cannot be opened.</b></p>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (v(); as x) {
      <div class="grid md:grid-cols-2 gap-4 bg-white dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-800">
        <div class="md:col-span-2"><label class="label" for="of-pass">Passphrase (at least 8 characters) {{ x.pass_set ? '— already set, leave blank to keep' : '' }}</label><input id="of-pass" type="password" class="field" autocomplete="new-password" [(ngModel)]="pass"></div>
        <div class="md:col-span-2"><label class="label" for="of-folder">Folder (USB drive, or a folder synced by Dropbox / OneDrive / Google Drive)</label><input id="of-folder" class="field" placeholder="e.g. E:\\Backups or /mnt/usb/backups" [(ngModel)]="x.folder"></div>
        <div><label class="label" for="of-mail">E-mail address (needs Email set up in HR settings; copies up to 20 MB)</label><input id="of-mail" type="email" class="field" [(ngModel)]="x.email"></div>
        <div></div>
        <div class="md:col-span-2 grid md:grid-cols-3 gap-4"><div class="md:col-span-3 text-xs font-black uppercase tracking-widest text-slate-400">WebDAV (Nextcloud, many NAS boxes and cloud drives)</div>
          <div><label class="label" for="of-url">Address</label><input id="of-url" class="field" placeholder="https://…/remote.php/dav/files/you/backups" [(ngModel)]="x.webdav.url"></div>
          <div><label class="label" for="of-user">User</label><input id="of-user" class="field" autocomplete="off" [(ngModel)]="x.webdav.user"></div>
          <div><label class="label" for="of-wp">Password {{ x.webdav.pass_set ? '(set)' : '' }}</label><input id="of-wp" type="password" class="field" autocomplete="new-password" [(ngModel)]="wpass"></div></div>
        <div class="md:col-span-2 flex flex-wrap gap-3"><button type="button" class="btn-primary" [disabled]="busy()" (click)="save()">Save</button><button type="button" class="btn-ghost" [disabled]="busy()" (click)="run()">Send the latest backup now</button></div>
      </div>
      @if (x.report; as r) {
        <div class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-sm font-bold space-y-1">
          <p class="text-slate-400">Last copy: {{ when(r.at) }} — {{ r.file }}</p>
          @for (z of r.results; track z.where) { <p [class]="z.ok ? 'text-emerald-600' : 'text-rose-600'">{{ z.where }}: {{ z.ok ? 'sent' : 'FAILED' }} — {{ z.note }}</p> }
          @if (!r.results.length) { <p class="text-slate-400">Nothing is set up yet.</p> }
        </div>
      }
      <p class="text-xs font-bold text-slate-400">To open an encrypted copy: on the computer run <code>node scripts/decrypt-backup.mjs copy.db.enc restored.db</code> in the backend folder, type the passphrase, then use "Restore from a file…" on the Backup tab. Google Drive and OneDrive cannot take a direct upload here: use a folder that their desktop app syncs.</p>
    }
  </section>
  `
})
export class Offsite {
  private api = inject(Api);
  private toast = inject(ToastService);
  v = signal<View | null>(null); error = signal(''); busy = signal(false);
  pass = ''; wpass = '';
  when = (iso: string) => new Date(iso).toLocaleString();
  constructor() { this.load(); }
  load() { this.api.get<View>('/backup/offsite').subscribe({ next: r => this.v.set(r), error: e => this.error.set(errorText(e)) }); }
  save() {
    const x = this.v(); if (!x) return; this.error.set('');
    this.api.put<View>('/backup/offsite', { pass: this.pass, folder: x.folder, email: x.email, webdav: { url: x.webdav.url, user: x.webdav.user, pass: this.wpass } }).subscribe({
      next: r => { this.v.set(r); this.pass = this.wpass = ''; this.toast.show('Saved.'); }, error: e => this.error.set(errorText(e)) });
  }
  run() {
    this.busy.set(true); this.error.set('');
    this.api.post('/backup/offsite/run', {}).subscribe({ next: () => { this.busy.set(false); this.load(); this.toast.show('Done. See the result below.'); }, error: e => { this.busy.set(false); this.error.set(errorText(e)); } });
  }
}
