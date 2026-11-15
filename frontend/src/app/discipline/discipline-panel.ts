import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';

export interface DiscRecord { id: number; student_id: number; date: string; kind: string; category: string | null; text: string; action: string | null; status: string; meet_date: string | null; outcome: string; outcome_note: string | null; by_name: string | null }
interface LetterRow { id: number; record_id: number | null; type: string; ref_no: string; subject: string; issued_on: string; issued_by_name: string | null }
interface Draft { type: string; types: string[]; subject: string; body: string }
export const LETTER_LABEL: Record<string, string> = { warning: 'Warning letter', summon: 'Summon letter', suspension: 'Suspension letter', appreciation: 'Appreciation letter', general: 'General letter' };
interface Resp { records: DiscRecord[]; summary: { letters: number; lettersByType: Record<string, number>; warnings: number; notes: number; praise: number; summons: number; suspensions: number; hint: string | null } | null }
export const KIND_LABEL: Record<string, string> = { note: 'Note', praise: 'Praise', warning: 'Warning', summon: 'Summon', suspension: 'Suspension' };
export const KIND_STYLE: Record<string, string> = { note: 'bg-slate-500/10 text-slate-600', praise: 'bg-emerald-500/10 text-emerald-600', warning: 'bg-amber-500/10 text-amber-700', summon: 'bg-indigo-500/10 text-indigo-600', suspension: 'bg-rose-500/10 text-rose-600' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

@Component({
  selector: 'app-discipline-panel',
  imports: [FormsModule],
  template: `
  <section class="space-y-4" aria-label="Behaviour record">
    @if (data()?.summary; as s) {
      <div class="flex flex-wrap gap-2 text-xs font-black">
        <span class="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-700">{{ s.warnings }} warning(s) this year</span>
        <span class="px-3 py-1.5 rounded-xl bg-slate-500/10">{{ s.notes }} note(s)</span>
        <span class="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600">{{ s.praise }} praise</span>
        <span class="px-3 py-1.5 rounded-xl bg-indigo-500/10 text-indigo-600">{{ s.summons }} summon(s)</span>
        <span class="px-3 py-1.5 rounded-xl bg-sky-500/10 text-sky-700">{{ s.letters }} letter(s) issued</span>
        @if (s.suspensions) { <span class="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600">{{ s.suspensions }} suspension(s)</span> }
      </div>
      @if (s.hint) { <p role="status" class="p-3 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm">{{ s.hint }}</p> }
    }
    @if (error()) { <p role="alert" class="p-3 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="no-print p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 space-y-3">
      <div class="grid sm:grid-cols-3 gap-3">
        <div><label class="label" for="dp-kind">Type</label>
          <select id="dp-kind" class="field" [ngModel]="kind()" (ngModelChange)="kind.set($event)">@for (k of kinds(); track k) { <option [value]="k">{{ label[k] }}</option> }</select></div>
        <div><label class="label" for="dp-cat">Reason</label>
          <select id="dp-cat" class="field" [ngModel]="category()" (ngModelChange)="category.set($event)"><option value="">-</option>@for (c of cats(); track c) { <option [value]="c">{{ c }}</option> }</select></div>
        <div><label class="label" for="dp-date">Date</label><input id="dp-date" type="date" class="field" [ngModel]="date()" (ngModelChange)="date.set($event)"></div>
      </div>
      <div><label class="label" for="dp-text">What happened</label><textarea id="dp-text" rows="2" class="field" [ngModel]="text()" (ngModelChange)="text.set($event)"></textarea></div>
      @if (kind() === 'summon') {
        <div class="flex flex-wrap gap-3 items-end">
          <div><label class="label" for="dp-meet">Parents should come on</label><input id="dp-meet" type="date" class="field" [ngModel]="meet()" (ngModelChange)="meet.set($event)"></div>
          <label class="flex items-center gap-2 text-sm font-bold pb-2"><input type="checkbox" [ngModel]="sms()" (ngModelChange)="sms.set($event)"> Send an SMS to the parent</label>
        </div>
      }
      <button type="button" class="btn-primary" [disabled]="busy()" (click)="add()">Add record</button>
    </div>

    @for (r of data()?.records ?? []; track r.id) {
      <article class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2 py-1 rounded-lg text-[11px] font-black" [class]="style[r.kind]">{{ label[r.kind] }}</span>
          @if (r.category) { <span class="text-xs font-black text-slate-500">{{ r.category }}</span> }
          <span class="text-xs font-bold text-slate-400">{{ r.date }}{{ r.by_name ? ' · ' + r.by_name : '' }}</span>
          @if (r.kind === 'summon') { <span class="ml-auto text-xs font-black" [class.text-amber-600]="r.status === 'open'">Meeting {{ r.meet_date }} · {{ outcomeLabel(r.outcome) }}</span> }
        </div>
        <p class="mt-2 text-sm font-bold whitespace-pre-line">{{ r.text }}</p>
        @if (r.outcome_note) { <p class="mt-1 text-xs font-bold text-slate-500">Result: {{ r.outcome_note }}</p> }
        @if (office()) {
          <div class="no-print mt-3 flex flex-wrap gap-2 items-center">
            <button type="button" class="btn-ghost !py-1 !px-3 text-xs" (click)="openDraft(r)">Issue a letter</button>
          </div>
          @if (draftFor() === r.id && draft(); as d) {
            <div class="no-print mt-3 p-4 rounded-2xl bg-slate-500/5 space-y-3">
              <div class="grid sm:grid-cols-3 gap-3">
                <div><label class="label" for="dl-type">Kind of letter</label><select id="dl-type" class="field" [ngModel]="lf.type" (ngModelChange)="changeType(r, $event)">@for (t of d.types; track t) { <option [value]="t">{{ letterLabel[t] }}</option> }</select></div>
                <div class="sm:col-span-2"><label class="label" for="dl-sub">Subject</label><input id="dl-sub" class="field" maxlength="150" [(ngModel)]="lf.subject"></div>
              </div>
              <div><label class="label" for="dl-body">Letter (you can change the words)</label><textarea id="dl-body" rows="8" class="field" [(ngModel)]="lf.body"></textarea></div>
              <div class="flex gap-2"><button type="button" class="btn-primary" [disabled]="busy()" (click)="issue(r)">Issue and print</button><button type="button" class="btn-ghost" (click)="draftFor.set(0)">Cancel</button></div>
            </div>
          }
        }
        @if (office() && (r.kind === 'summon' || r.kind === 'suspension' || canDelete())) {
          <div class="no-print mt-3 flex flex-wrap gap-2 items-center">
            @if (r.kind === 'summon') {
              @if (r.status === 'open') {
                <button type="button" class="btn-ghost !py-1 !px-3 text-xs" (click)="outcome(r, 'attended')">Parents came</button>
                <button type="button" class="btn-ghost !py-1 !px-3 text-xs" (click)="outcome(r, 'not_attended')">Did not come</button>
                <button type="button" class="btn-ghost !py-1 !px-3 text-xs" (click)="reschedule(r)">New date</button>
              }
            }
            @if (canDelete()) { <button type="button" class="btn-ghost !py-1 !px-3 text-xs text-rose-600" (click)="remove(r)">Delete</button> }
          </div>
        }
      </article>
    } @empty { <p class="p-6 text-center text-sm font-bold text-slate-400">Nothing recorded.</p> }

    @if (office()) {
      <div class="no-print space-y-2">
        <h3 class="text-sm font-black uppercase tracking-widest text-slate-400">Letters issued ({{ letters().length }})</h3>
        @for (l of letters(); track l.id) {
          <div class="flex flex-wrap items-center gap-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 text-sm font-bold">
            <span class="px-2 py-1 rounded-lg text-[11px] font-black bg-sky-500/10 text-sky-700">{{ letterLabel[l.type] }}</span>
            <span class="flex-1 min-w-40">{{ l.subject }}</span>
            <span class="text-xs text-slate-400">{{ l.ref_no }} · {{ l.issued_on }}{{ l.issued_by_name ? ' · ' + l.issued_by_name : '' }}</span>
            <button type="button" class="btn-ghost !py-1 !px-3 text-xs" (click)="print(l.id)">Print again</button>
            @if (canDelete()) { <button type="button" class="btn-ghost !py-1 !px-3 text-xs text-rose-600" (click)="removeLetter(l)">Delete</button> }
          </div>
        } @empty { <p class="text-sm font-bold text-slate-400">No letter has been issued for this student.</p> }
      </div>
    }
  </section>
  `
})
export class DisciplinePanel {
  studentId = input.required<number>();
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  label = KIND_LABEL; style = KIND_STYLE; letterLabel = LETTER_LABEL;
  letters = signal<LetterRow[]>([]); draftFor = signal(0); draft = signal<Draft | null>(null); lf = { type: 'general', subject: '', body: '' };
  data = signal<Resp | null>(null); error = signal(''); busy = signal(false); cats = signal<string[]>([]);
  kind = signal('note'); category = signal(''); text = signal(''); date = signal(new Date().toISOString().slice(0, 10)); meet = signal(''); sms = signal(true);
  office = computed(() => ['director', 'principal', 'admin'].includes(this.auth.user()?.role ?? ''));
  canDelete = computed(() => this.auth.isLeadership());
  kinds = computed(() => this.office() ? ['note', 'praise', 'warning', 'summon', 'suspension'] : ['note', 'praise']);
  constructor() {
    this.api.get<string[]>('/discipline/categories').subscribe({ next: c => this.cats.set(c) });
    effect(() => { this.studentId(); this.load(); });
  }
  load() {
    this.api.get<Resp>(`/discipline/student/${this.studentId()}`).subscribe({ next: d => { this.data.set(d); this.error.set(''); }, error: e => this.error.set(errorText(e)) });
    if (this.office()) this.api.get<{ letters: LetterRow[] }>(`/discipline/letters/student/${this.studentId()}`).subscribe({ next: r => this.letters.set(r.letters), error: () => this.letters.set([]) });
  }
  openDraft(r: DiscRecord) {
    if (this.draftFor() === r.id) { this.draftFor.set(0); return; }
    this.api.get<Draft>(`/discipline/records/${r.id}/draft`).subscribe({ next: d => { this.lf = { type: d.type, subject: d.subject, body: d.body }; this.draft.set(d); this.draftFor.set(r.id); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  changeType(r: DiscRecord, type: string) {
    this.api.get<Draft>(`/discipline/records/${r.id}/draft`, { type }).subscribe({ next: d => { this.lf = { type: d.type, subject: d.subject, body: d.body }; }, error: e => this.toast.show(errorText(e), 'error') });
  }
  issue(r: DiscRecord) {
    this.busy.set(true);
    this.api.post<{ id: number }>(`/discipline/records/${r.id}/letters`, { ...this.lf }).subscribe({
      next: x => { this.busy.set(false); this.draftFor.set(0); this.toast.show('Letter issued.'); this.load(); this.print(x.id); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
  removeLetter(l: LetterRow) { if (!window.confirm(`Delete letter ${l.ref_no}? It will no longer count on the student's record.`)) return; this.api.delete(`/discipline/letters/${l.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
  print(id: number) {
    this.api.get<any>(`/discipline/letters/${id}`).subscribe({
      next: l => {
        const w = window.open('', '_blank'); if (!w) { this.toast.show('Allow pop-ups to print the letter.', 'error'); return; }
        const paras = String(l.body).split(/\n{2,}/).map((p: string) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
        w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(l.ref_no)}</title><style>@page{size:A4;margin:18mm}body{font-family:Georgia,serif;max-width:680px;margin:0 auto;line-height:1.7}</style><body>
          <img src="${location.origin}/api/settings/logo" alt="" style="display:block;height:24mm;margin:0 auto 6px" onerror="this.remove()"><h2 style="text-align:center;margin:0">${esc(l.school)}</h2>
          <p style="text-align:center;margin:0 0 4px;font-size:13px">${esc([l.address, l.phone].filter(Boolean).join(' · '))}</p><hr>
          <p style="display:flex;justify-content:space-between"><span>Ref: ${esc(l.ref_no)}</span><span>Date: ${esc(l.issued_on)}</span></p>
          <p>To: Mr. ${esc(l.student.father_name || '')}, father of <b>${esc(l.student.name)}</b> (Reg. ${esc(l.student.reg_no)}, Class ${esc(l.student.class_name)})</p>
          <p><b>Subject: ${esc(l.subject)}</b></p><p>Respected Sir,</p>${paras}
          <p style="margin-top:64px"><b>${esc(l.signed_by)}</b><br>Principal</p>
          <p style="margin-top:36px;font-size:13px">Received by parent: ______________________ &nbsp; Date: ____________</p></body>`);
        w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
      },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
  outcomeLabel(o: string) { return ({ pending: 'waiting', attended: 'parents came', not_attended: 'did not come', rescheduled: 'new date given' } as Record<string, string>)[o] ?? o; }
  add() {
    this.busy.set(true);
    this.api.post<{ sms: { sent: number; failed: number; skipped: number } | null }>('/discipline', { student_id: this.studentId(), kind: this.kind(), category: this.category() || null, text: this.text(), date: this.date(), meet_date: this.meet() || null, send_sms: this.kind() === 'summon' && this.sms() }).subscribe({
      next: r => {
        this.busy.set(false); this.text.set('');
        this.toast.show(r.sms ? (r.sms.sent ? 'Saved and SMS sent.' : 'Saved. The SMS was not sent (no valid phone or the SMS service is off).') : 'Saved.', r.sms && !r.sms.sent ? 'error' : undefined);
        this.load();
      },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
  outcome(r: DiscRecord, outcome: string, extra: Record<string, unknown> = {}) { this.api.put(`/discipline/${r.id}/outcome`, { outcome, ...extra }).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
  reschedule(r: DiscRecord) { const d = window.prompt('New date (YYYY-MM-DD)', r.meet_date ?? ''); if (d) this.outcome(r, 'rescheduled', { meet_date: d }); }
  remove(r: DiscRecord) { if (!window.confirm('Delete this record for good?')) return; this.api.delete(`/discipline/${r.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
  letter(r: DiscRecord) {
    this.api.get<any>(`/discipline/${r.id}/letter`).subscribe({
      next: l => {
        const w = window.open('', '_blank'); if (!w) { this.toast.show('Allow pop-ups to print the letter.', 'error'); return; }
        w.document.write(`<!doctype html><meta charset="utf-8"><title>Letter</title><body style="font-family:Georgia,serif;max-width:640px;margin:48px auto;line-height:1.7">
          <img src="${location.origin}/api/settings/logo" alt="" style="display:block;height:24mm;margin:0 auto 6px"><h2 style="text-align:center;margin:0">${esc(l.school)}</h2><p style="text-align:center;margin:0 0 32px">Notice to parent / guardian</p>
          <p>Date: ${esc(l.date)}</p><p>To: Mr. ${esc(l.student.father_name || '')}, father of <b>${esc(l.student.name)}</b> (Reg. ${esc(l.student.reg_no)}, Class ${esc(l.student.class_name)})</p>
          <p>You are requested to come to the school office on <b>${esc(l.meet_date)}</b> to meet the Principal about your son.</p>
          <p><b>Reason:</b> ${esc(l.reason ? l.reason + ' — ' : '')}${esc(l.text)}</p><p>Your presence is necessary. Please bring this letter with you.</p>
          <p style="margin-top:64px">Principal ______________________</p><p style="margin-top:32px">Parent's signature ______________________</p></body>`);
        w.document.close(); w.focus(); w.print();
      },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
