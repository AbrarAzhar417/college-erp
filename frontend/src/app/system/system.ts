import { DownloadsReport } from './downloads';
import { Offsite } from './offsite';
import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';

interface Backup { name: string; kind: string; size: number; created: string }
interface AuditRow { id: number; at: string; user_name: string | null; role: string | null; action: string; entity: string | null; entity_id: string | null; detail: string | null; ip: string | null }
interface PlanRow { section_id: number; grade: number; class_name: string; section_name: string; to: string; graduating: boolean; students: { id: number; name: string; roll_no: number | null; reg_no: string }[] }
interface Plan { session: string; next_session: string; rows: PlanRow[]; total: number; last: { at: string; promoted: number; passedOut: number; held: number } | null }

const KIND: Record<string, string> = { auto: 'Automatic (daily)', manual: 'Made by hand', 'pre-restore': 'Safety copy before a restore' };

@Component({
  selector: 'app-system',
  imports: [FormsModule, Offsite, DownloadsReport],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">System &amp; Safety</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Backups, who-did-what log, new session (promotion) and the parents' online result page. Only the Director and the Principal can open this page.</p></div>

    <div role="tablist" class="flex flex-wrap gap-2">
      @for (t of tabs; track t.key) {
        <button type="button" role="tab" [attr.aria-selected]="tab() === t.key" class="px-4 py-2 rounded-xl text-sm font-black" [class]="tab() === t.key ? 'bg-indigo-600 text-white' : 'bg-slate-500/10'" (click)="open(t.key)">{{ t.label }}</button>
      }
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (tab() === 'integrity') {
      <section class="space-y-4">
        <p class="text-sm font-bold text-slate-500">Looks through the whole database for broken links, repeated records and copies that disagree. "Fix automatically" repairs only what has one clear right answer. Money is never changed by it, it is only listed here for you to look at.</p>
        <div class="flex gap-3"><button type="button" class="btn-primary" [disabled]="busy()" (click)="runCheck()">Check now</button>
          @if (dc()?.findings?.length) { <button type="button" class="btn-ghost" [disabled]="busy()" (click)="runRepair()">Fix automatically</button> }</div>
        @if (dc(); as r) {
          <p class="p-4 rounded-2xl font-bold text-sm" [class]="r.ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-800'">
            {{ r.ok ? 'No problems found. The database is consistent.' : (r.findings.length + ' kind(s) of problem found.') }} Storage check: {{ r.engine }}{{ r.foreignKeys ? ', broken links: ' + r.foreignKeys : '' }}</p>
          @for (f of r.findings; track f.key) {
            <div class="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
              <p class="font-black">{{ f.label }} <span class="text-xs text-slate-400">({{ f.count }})</span> <span class="text-[11px] px-2 py-0.5 rounded-lg" [class]="f.fix === 'auto' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-600'">{{ f.fix === 'auto' ? 'can be fixed automatically' : 'needs a person to decide' }}</span></p>
              <p class="text-xs font-bold text-slate-500 mt-1 break-all">{{ show(f.sample) }}</p>
            </div>
          }
        }
      </section>
    }

    @if (tab() === 'backup') {
      <section class="space-y-4">
        <p class="text-sm font-bold text-slate-500">The program makes one backup every day by itself (the newest 14 are kept). Keep a copy on a USB drive or in your e-mail from time to time: a backup on the same computer does not help if that computer is lost.</p>
        <div class="flex flex-wrap gap-3 items-center">
          <button type="button" class="btn-primary" [disabled]="busy()" (click)="makeBackup()">Make a backup now</button>
          <label class="btn-ghost cursor-pointer">Restore from a file…<input type="file" accept=".db" class="sr-only" (change)="pickRestore($event)"></label>
        </div>
        <div class="overflow-x-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800">
          <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-4 py-3">When</th><th class="px-4 py-3">Kind</th><th class="px-4 py-3">Size</th><th class="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody>@for (b of backups(); track b.name) {
              <tr class="border-t border-slate-100 dark:border-slate-800"><td class="px-4 py-3 whitespace-nowrap font-bold">{{ when(b.created) }}</td><td class="px-4 py-3">{{ kind[b.kind] }}</td><td class="px-4 py-3">{{ mb(b.size) }}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap space-x-2"><button type="button" class="btn-ghost" (click)="download(b)">Download</button><button type="button" class="btn-ghost" (click)="askRestore(b.name)">Restore</button>@if (b.kind !== 'auto') { <button type="button" class="btn-ghost" (click)="removeBackup(b)">Delete</button> }</td></tr>
            } @empty { <tr><td colspan="4" class="p-8 text-center font-bold text-slate-400">No backup yet.</td></tr> }</tbody></table>
        </div>
        @if (restoreName() || restoreFile()) {
          <div class="p-5 rounded-2xl bg-amber-500/10 space-y-3" role="alertdialog" aria-label="Confirm restore">
            <p class="font-black">All data entered after this backup will be replaced by the backup. A safety copy of today's data is saved first.</p>
            <p class="text-sm font-bold text-slate-500">Restoring: {{ restoreName() || restoreFile()?.name }}. After a restore, everyone must log in again.</p>
            <div class="flex flex-wrap gap-3"><input class="field max-w-48" aria-label="Type RESTORE" placeholder="Type RESTORE" [ngModel]="word()" (ngModelChange)="word.set($event)">
              <button type="button" class="btn-primary" [disabled]="word() !== 'RESTORE' || busy()" (click)="doRestore()">Restore now</button><button type="button" class="btn-ghost" (click)="cancelRestore()">Cancel</button></div>
          </div>
        }
      </section>
    }

    @if (tab() === 'offsite') { <app-offsite /> }
    @if (tab() === 'downloads') { <app-downloads-report /> }

    @if (tab() === 'audit') {
      <section class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div><label class="label" for="a-act">Action</label><select id="a-act" class="field" [ngModel]="fAction()" (ngModelChange)="fAction.set($event); loadAudit(true)"><option value="">All</option>@for (a of actions(); track a) { <option [value]="a">{{ a }}</option> }</select></div>
          <div><label class="label" for="a-user">Person</label><input id="a-user" class="field" [ngModel]="fUser()" (ngModelChange)="fUser.set($event)" (keyup.enter)="loadAudit(true)"></div>
          <div><label class="label" for="a-from">From</label><input id="a-from" type="date" class="field" [ngModel]="fFrom()" (ngModelChange)="fFrom.set($event); loadAudit(true)"></div>
          <div><label class="label" for="a-to">To</label><input id="a-to" type="date" class="field" [ngModel]="fTo()" (ngModelChange)="fTo.set($event); loadAudit(true)"></div>
          <button type="button" class="btn-ghost" (click)="loadAudit(true)">Search</button>
        </div>
        <p class="text-xs font-bold text-slate-400">Every login and every change made in the program is listed here ({{ auditTotal() }} lines). Passwords and file contents are never written to the log.</p>
        <div class="overflow-x-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800">
          <table class="w-full text-left text-xs"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-3 py-3">When</th><th class="px-3 py-3">Person</th><th class="px-3 py-3">Action</th><th class="px-3 py-3">Detail</th><th class="px-3 py-3">From</th></tr></thead>
            <tbody>@for (r of audit(); track r.id) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="px-3 py-2 whitespace-nowrap">{{ r.at }}</td><td class="px-3 py-2 whitespace-nowrap font-bold">{{ r.user_name || '-' }} <span class="text-slate-400">{{ r.role }}</span></td><td class="px-3 py-2 font-black">{{ r.action }}</td><td class="px-3 py-2">{{ r.entity_id }} {{ r.detail }}</td><td class="px-3 py-2">{{ r.ip }}</td></tr> }
              @empty { <tr><td colspan="5" class="p-8 text-center font-bold text-slate-400">Nothing found.</td></tr> }</tbody></table>
        </div>
        @if (audit().length < auditTotal()) { <button type="button" class="btn-ghost" (click)="loadAudit(false)">Show older</button> }
      </section>
    }

    @if (tab() === 'rollover') {
      <section class="space-y-4">
        @if (plan(); as p) {
          <p class="text-sm font-bold text-slate-500">Session {{ p.session }} will end and session {{ p.next_session }} will start. Every active student moves to the same section letter of the next class; the top class is marked "passed out". Old results, attendance and fee records stay with the student. <strong>Tick a student to keep them back in the same class.</strong></p>
          @if (p.last) { <p class="text-xs font-bold text-emerald-600">Last promotion: {{ when(p.last.at) }} ({{ p.last.promoted }} promoted, {{ p.last.passedOut }} passed out, {{ p.last.held }} kept back).</p> }
          <div class="space-y-3">
            @for (r of p.rows; track r.section_id) {
              <details class="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
                <summary class="cursor-pointer font-black">{{ r.class_name }}-{{ r.section_name }} <span class="text-slate-400">→ {{ r.to }}</span> <span class="text-xs text-slate-400">({{ r.students.length }} students)</span></summary>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-1 mt-3">@for (s of r.students; track s.id) { <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" [checked]="held().has(s.id)" (change)="toggleHold(s.id)"> {{ s.roll_no }}. {{ s.name }}</label> }</div>
              </details>
            } @empty { <p class="p-8 text-center font-bold text-slate-400">There are no active students.</p> }
          </div>
          <div class="p-5 rounded-2xl bg-amber-500/10 space-y-3">
            <p class="font-black">{{ p.total - held().size }} students will move, {{ held().size }} stay.</p>
            <p class="text-sm font-bold text-slate-500">A backup is made automatically first. If something looks wrong afterwards, restore that backup from the Backup tab.</p>
            <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" [checked]="advance()" (change)="advance.set(!advance())"> Also start the new session {{ p.next_session }} in Examination settings</label>
            <div class="flex flex-wrap gap-3"><input class="field max-w-48" aria-label="Type PROMOTE" placeholder="Type PROMOTE" [ngModel]="word()" (ngModelChange)="word.set($event)"><button type="button" class="btn-primary" [disabled]="word() !== 'PROMOTE' || busy()" (click)="promote()">Promote students</button></div>
          </div>
        }
      </section>
    }

    @if (tab() === 'online') {
      <section class="space-y-4 max-w-2xl">
        <p class="text-sm font-bold text-slate-500">Parents can open <strong>{{ origin }}/result</strong> from their phone and see a <em>published</em> result by typing the registration number and the father's CNIC. Nothing else about the child is shown. A wrong guess says only "not found", and after 5 wrong tries for one registration number the lookup is blocked for 15 minutes.</p>
        <p class="text-sm font-bold text-slate-500">The page works only if the college server can be reached from the internet (see DEPLOY.md). Students without a father CNIC saved cannot use it.</p>
        <label class="flex items-center gap-3 font-black"><input type="checkbox" [checked]="online()" (change)="toggleOnline()"> Online result lookup is {{ online() ? 'ON' : 'OFF' }}</label>
      </section>
    }

    @if (tab() === 'ocr') {
      <section class="space-y-4 max-w-2xl">
        <p class="text-sm font-bold text-slate-500">Photo reading lets teachers photograph a handwritten marks sheet, and the office photograph a filled admission form, so the program fills in the numbers and boxes for them. Every result is shown for checking first; nothing is saved without a person confirming.</p>
        <p class="text-sm font-bold text-slate-500">It uses the Claude AI service, so it needs <strong>internet on the college computer</strong> and an <strong>API key</strong> (from console.anthropic.com) with a small credit balance; each photo costs a few rupees at most. <strong>The photo is sent to that service for reading.</strong> Do not turn this on if the college does not want pictures of student records to leave the building.</p>
        <p class="font-black">Status: <span [class]="ocrReady() ? 'text-emerald-600' : 'text-slate-400'">{{ ocrReady() ? 'Ready' : 'Not set up' }}</span></p>
        <div class="flex flex-wrap gap-3"><input class="field max-w-md" type="password" autocomplete="off" aria-label="API key" placeholder="sk-…" [ngModel]="ocrKey()" (ngModelChange)="ocrKey.set($event)">
          <button type="button" class="btn-primary" [disabled]="busy() || !ocrKey()" (click)="saveKey()">Save key</button>
          @if (ocrReady()) { <button type="button" class="btn-ghost" (click)="removeKey()">Remove key</button> }</div>
      </section>
    }
  </div>
  `
})
export class System {
  private api = inject(Api); private http = inject(HttpClient); private toast = inject(ToastService);
  tabs = [{ key: 'backup', label: 'Backup & Restore' }, { key: 'offsite', label: 'Copy outside' }, { key: 'audit', label: 'Audit log' }, { key: 'downloads', label: 'Downloads report' }, { key: 'rollover', label: 'New session (promotion)' }, { key: 'online', label: 'Online results' }, { key: 'ocr', label: 'Photo reading' }, { key: 'integrity', label: 'Data check' }];
  kind = KIND; origin = location.origin;
  tab = signal('backup'); error = signal(''); busy = signal(false); word = signal('');
  backups = signal<Backup[]>([]); restoreName = signal(''); restoreFile = signal<File | null>(null);
  audit = signal<AuditRow[]>([]); auditTotal = signal(0); actions = signal<string[]>([]); fAction = signal(''); fUser = signal(''); fFrom = signal(''); fTo = signal('');
  plan = signal<Plan | null>(null); held = signal<Set<number>>(new Set()); advance = signal(true);
  online = signal(false); ocrReady = signal(false); ocrKey = signal('');
  dc = signal<{ ok: boolean; engine: string; foreignKeys: number; findings: { key: string; label: string; count: number; sample: unknown[]; fix: string }[] } | null>(null);
  show(a: unknown[]) { return JSON.stringify(a); }
  runCheck() { this.busy.set(true); this.api.get<any>('/integrity').subscribe({ next: r => { this.busy.set(false); this.dc.set(r); }, error: e => this.fail(e) }); }
  runRepair() { this.busy.set(true); this.api.post<any>('/integrity/repair', {}).subscribe({ next: r => { this.busy.set(false); this.dc.set(r.after); this.toast.show(r.fixed.length ? 'Fixed.' : 'Nothing could be fixed automatically.'); }, error: e => this.fail(e) }); }
  constructor() { this.open('backup'); }

  open(t: string) { this.tab.set(t); this.error.set(''); this.word.set(''); if (t === 'backup') this.loadBackups(); if (t === 'audit') this.loadAudit(true); if (t === 'rollover') this.loadPlan(); if (t === 'integrity') this.runCheck(); if (t === 'ocr') this.api.get<{ ready: boolean }>('/ocr/status').subscribe({ next: r => this.ocrReady.set(r.ready), error: e => this.error.set(errorText(e)) });
    if (t === 'online') this.api.get<{ enabled: boolean }>('/public/result-setting').subscribe({ next: r => this.online.set(r.enabled), error: e => this.error.set(errorText(e)) }); }
  when = (iso: string) => new Date(iso).toLocaleString();
  mb = (n: number) => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1) + ' MB';
  private fail = (e: any) => { this.busy.set(false); this.error.set(errorText(e)); };

  loadBackups() { this.api.get<Backup[]>('/backup').subscribe({ next: r => this.backups.set(r), error: e => this.fail(e) }); }
  makeBackup() { this.busy.set(true); this.api.post('/backup', {}).subscribe({ next: () => { this.busy.set(false); this.toast.show('Backup made.'); this.loadBackups(); }, error: e => this.fail(e) }); }
  download(b: Backup) {
    this.http.get(`/api/backup/${b.name}/download`, { responseType: 'blob' }).subscribe({ next: blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = b.name; a.click(); URL.revokeObjectURL(a.href); }, error: e => this.fail(e) });
  }
  removeBackup(b: Backup) { if (!confirm('Delete this backup?')) return; this.api.delete(`/backup/${b.name}`).subscribe({ next: () => this.loadBackups(), error: e => this.fail(e) }); }
  askRestore(name: string) { this.restoreFile.set(null); this.restoreName.set(name); this.word.set(''); }
  pickRestore(ev: Event) { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) { this.restoreName.set(''); this.restoreFile.set(f); this.word.set(''); } (ev.target as HTMLInputElement).value = ''; }
  cancelRestore() { this.restoreName.set(''); this.restoreFile.set(null); this.word.set(''); }
  doRestore() {
    this.busy.set(true);
    const done = () => { this.busy.set(false); this.cancelRestore(); this.toast.show('Restored. Please log in again.'); setTimeout(() => { try { localStorage.clear(); } catch { /* ignore */ } location.href = '/login'; }, 1200); };
    const f = this.restoreFile();
    if (f) this.http.post('/api/backup/upload-restore?confirm=RESTORE', f, { headers: { 'Content-Type': 'application/octet-stream' } }).subscribe({ next: done, error: e => this.fail(e) });
    else this.api.post(`/backup/${this.restoreName()}/restore`, { confirm: 'RESTORE' }).subscribe({ next: done, error: e => this.fail(e) });
  }

  private offset = 0;
  loadAudit(reset: boolean) {
    if (reset) this.offset = 0;
    this.api.get<{ total: number; rows: AuditRow[]; actions: string[] }>('/audit', { action: this.fAction(), user: this.fUser(), from: this.fFrom(), to: this.fTo(), limit: 100, offset: this.offset }).subscribe({
      next: r => { this.audit.update(l => (reset ? r.rows : [...l, ...r.rows])); this.offset += r.rows.length; this.auditTotal.set(r.total); this.actions.set(r.actions); this.error.set(''); }, error: e => this.fail(e)
    });
  }

  loadPlan() { this.held.set(new Set()); this.api.get<Plan>('/rollover/plan').subscribe({ next: r => this.plan.set(r), error: e => this.fail(e) }); }
  toggleHold(id: number) { this.held.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  promote() {
    this.busy.set(true);
    this.api.post<{ promoted: number; passed_out: number; held: number; session: string }>('/rollover/commit', { confirm: 'PROMOTE', hold: [...this.held()], advance_session: this.advance() }).subscribe({
      next: r => { this.busy.set(false); this.word.set(''); this.toast.show(`Done: ${r.promoted} promoted, ${r.passed_out} passed out, ${r.held} kept back. Session ${r.session}.`); this.loadPlan(); }, error: e => this.fail(e)
    });
  }
  saveKey() { this.busy.set(true); this.api.put<{ ready: boolean }>('/ocr/key', { key: this.ocrKey() }).subscribe({ next: r => { this.busy.set(false); this.ocrReady.set(r.ready); this.ocrKey.set(''); this.toast.show('Saved.'); }, error: e => this.fail(e) }); }
  removeKey() { if (!confirm('Remove the key? Photo reading will stop working.')) return; this.api.put<{ ready: boolean }>('/ocr/key', { key: '' }).subscribe({ next: r => this.ocrReady.set(r.ready), error: e => this.fail(e) }); }
  toggleOnline() { this.api.put<{ enabled: boolean }>('/public/result-setting', { enabled: !this.online() }).subscribe({ next: r => this.online.set(r.enabled), error: e => this.fail(e) }); }
}
