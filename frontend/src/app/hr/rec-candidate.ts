import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { Candidate, EMPLOYMENT, HrFiles, Job, STAFF_TYPES, STAGES, STAGE_LABEL, ScoreInfo, fmtDate, money, scoreBadge, stageBadge, timeText, today } from './hr';
import { RecSend } from './rec-send';

interface FileRow { id: number; label: string | null; name: string; size: number }
interface Iv { id: number; round: string; date: string; time: string | null; venue: string | null; panel: string | null; status: string; score: number | null; feedback: string | null; result: string | null }
interface Msg { id: number; channel: string; kind: string; text: string | null; by_name: string | null; sent_at: string }
interface Detail { candidate: Candidate; job: Job | null; files: FileRow[]; interviews: Iv[]; messages: Msg[]; score: ScoreInfo | null; checklist: { item: string; done: boolean }[]; has_text: boolean }

@Component({
  selector: 'app-rec-candidate',
  imports: [FormsModule, RouterLink, RecSend],
  template: `
  <div class="space-y-6">
    <a routerLink="/hr/recruit/candidates" class="text-xs font-black uppercase tracking-widest text-indigo-600">← All candidates</a>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (x(); as v) {
      <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="text-2xl font-black tracking-tight">{{ v.candidate.name }}</h3><p class="text-sm font-bold text-slate-400">{{ v.job?.title || 'No post chosen' }} · applied {{ d(v.candidate.applied_date) }}</p></div>
          <span class="px-3 py-1.5 rounded-xl text-xs font-black" [class]="sb(v.candidate.stage)">{{ sl[v.candidate.stage] }}</span></div>
        <div class="flex flex-wrap gap-2">
          @for (s of moves; track s) { @if (v.candidate.stage !== s && v.candidate.stage !== 'hired') { <button type="button" class="btn-ghost" (click)="move(s)">{{ s === 'rejected' ? 'Not selected' : 'Move to ' + sl[s] }}</button> } }
          <button type="button" class="btn-primary" (click)="panel.set(panel() === 'send' ? '' : 'send')">WhatsApp / SMS / email</button>
          @if (v.candidate.stage === 'hired' && v.candidate.staff_id) { <a class="btn-primary" [routerLink]="['/hr/staff', v.candidate.staff_id]">Open staff record</a> }
        </div>
        @if (v.candidate.reject_reason && v.candidate.stage === 'rejected') { <p class="text-sm font-bold text-rose-500">Reason: {{ v.candidate.reject_reason }}</p> }
      </div>
      @if (panel() === 'send') { <app-rec-send [people]="[v.candidate]" [initialKind]="v.candidate.stage === 'offered' ? 'offer' : v.candidate.stage === 'rejected' ? 'reject' : 'interview'" (closed)="panel.set('')" /> }

      <div class="grid lg:grid-cols-2 gap-6">
        <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
          <h3 class="text-lg font-black tracking-tight">Details and screening</h3>
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2"><label class="label" for="n">Name</label><input id="n" name="n" class="field" required [(ngModel)]="f.name"></div>
            <div><label class="label" for="j">Applying for</label><select id="j" name="j" class="field" [(ngModel)]="f.job_id"><option [ngValue]="null">-</option>@for (j of jobs(); track j.id) { <option [ngValue]="j.id">{{ j.title }}</option> }</select></div>
            <div><label class="label" for="ph">Phone</label><input id="ph" name="ph" class="field" [(ngModel)]="f.phone"></div>
            <div><label class="label" for="em">Email</label><input id="em" name="em" type="email" class="field" [(ngModel)]="f.email"></div>
            <div><label class="label" for="ci">CNIC</label><input id="ci" name="ci" class="field" [(ngModel)]="f.cnic"></div>
            <div><label class="label" for="q">Qualification</label><input id="q" name="q" class="field" [(ngModel)]="f.qualification"></div>
            <div><label class="label" for="x">Experience (years)</label><input id="x" name="x" type="number" min="0" step="0.5" class="field" [(ngModel)]="f.experience_years"></div>
            <div><label class="label" for="ce">Current employer</label><input id="ce" name="ce" class="field" [(ngModel)]="f.current_employer"></div>
            <div><label class="label" for="ct">City</label><input id="ct" name="ct" class="field" [(ngModel)]="f.city"></div>
            <div><label class="label" for="cs">Current salary</label><input id="cs" name="cs" type="number" min="0" class="field" [(ngModel)]="f.current_salary"></div>
            <div><label class="label" for="es">Expected salary</label><input id="es" name="es" type="number" min="0" class="field" [(ngModel)]="f.expected_salary"></div>
            <div><label class="label" for="r">Stars (1 to 5)</label><select id="r" name="r" class="field" [(ngModel)]="f.rating"><option [ngValue]="null">Not rated</option>@for (n of five; track n) { <option [ngValue]="n">{{ n }} ★</option> }</select></div>
            <div><label class="label" for="so">Came from</label><input id="so" name="so" class="field" [(ngModel)]="f.source"></div>
            <div class="col-span-2"><label class="label" for="no">Screening notes</label><textarea id="no" name="no" rows="3" class="field" [(ngModel)]="f.notes"></textarea></div>
          </div>
          <button class="btn-primary" type="submit">Save</button>
        </form>

        <div class="space-y-6">
          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
            <h3 class="text-lg font-black tracking-tight">CV and papers</h3>
            @for (fl of v.files; track fl.id) { <div class="flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800 text-sm"><button type="button" class="font-bold text-left hover:text-indigo-500" (click)="files.open(fl.id)">{{ fl.label || 'CV' }} · {{ fl.name }}</button>
              <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="removeFile(fl)">Delete</button></div> } @empty { <p class="text-sm font-bold text-slate-400">No CV uploaded.</p> }
            <label class="btn-ghost cursor-pointer text-center block">Upload CV or paper<input type="file" class="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" (change)="upload($event)"></label>
          </section>

          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
            <div class="flex items-center justify-between gap-3"><h3 class="text-lg font-black tracking-tight">Score</h3>
              <span class="px-3 py-1.5 rounded-xl text-sm font-black" [class]="sbadge(v.candidate.score)">{{ v.candidate.score ?? '-' }} / 100</span></div>
            @if (v.score; as sc) {
              <p class="text-xs font-bold text-slate-500">Words from the post {{ sc.keywords }} · experience {{ sc.experience }} · qualification {{ sc.qualification }}</p>
              @if (sc.found.length || sc.missing.length) { <div class="flex flex-wrap gap-1.5">@for (w of sc.found; track w) { <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-emerald-500/15 text-emerald-700">✓ {{ w }}</span> }@for (w of sc.missing; track w) { <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-slate-500/10 text-slate-500">✗ {{ w }}</span> }</div> }
            }
            @if (!v.has_text) { <p class="text-xs font-bold text-amber-600">No text could be read from the CV (it may be a picture), so the score uses only the details typed here.</p> }
            <p class="text-xs font-bold text-slate-400">Set the words to look for in the job post. The score is re-made when the details or a CV change.</p>
          </section>

          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-2">
            <div class="flex items-center justify-between gap-3"><h3 class="text-lg font-black tracking-tight">Papers to bring</h3><span class="text-xs font-black text-slate-400">{{ doneCount(v.checklist) }} of {{ v.checklist.length }}</span></div>
            @for (c of v.checklist; track c.item) { <label class="flex items-center gap-3 text-sm font-bold py-1"><input type="checkbox" [checked]="c.done" (change)="tick(v.checklist, c.item, $any($event.target).checked)"> <span [class.line-through]="c.done" [class.text-slate-400]="c.done">{{ c.item }}</span></label> }
            @if (doneCount(v.checklist) < v.checklist.length && v.candidate.stage === 'offered') { <p class="text-xs font-bold text-amber-600">Some papers are still missing. You can still join the person as staff.</p> }
          </section>

          <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
            <h3 class="text-lg font-black tracking-tight">Interviews</h3>
            @for (i of v.interviews; track i.id) { <p class="text-sm font-bold py-1.5 border-b border-slate-100 dark:border-slate-800">{{ i.round }} · {{ d(i.date) }} {{ tt(i.time) }}{{ i.venue ? ' · ' + i.venue : '' }}<span class="block text-xs text-slate-400 capitalize">{{ i.status.replace('_', ' ') }}{{ i.result ? ' · ' + i.result : '' }}{{ i.score !== null ? ' · ' + i.score + '/100' : '' }}{{ i.feedback ? ' · ' + i.feedback : '' }}</span></p> } @empty { <p class="text-sm font-bold text-slate-400">No interview yet.</p> }
            @for (i of v.interviews; track i.id) { <a class="text-xs font-black text-indigo-600 block" routerLink="/hr/print/marksheet" [queryParams]="{ id: i.id }">Print marks sheet for {{ d(i.date) }}</a> }
            @if (v.candidate.stage !== 'hired') {
              <form (ngSubmit)="addInterview()" class="grid grid-cols-2 gap-3 items-end">
                <div><label class="label" for="id">Date</label><input id="id" name="id" type="date" class="field" required [(ngModel)]="iv.date"></div>
                <div><label class="label" for="it">Time</label><input id="it" name="it" type="time" class="field" [(ngModel)]="iv.time"></div>
                <div><label class="label" for="ir">Round</label><input id="ir" name="ir" class="field" [(ngModel)]="iv.round"></div>
                <div><label class="label" for="iv">Place</label><input id="iv" name="iv" class="field" [(ngModel)]="iv.venue"></div>
                <button class="btn-ghost col-span-2" type="submit">Schedule interview</button>
              </form> }
          </section>
        </div>
      </div>

      @if (v.candidate.stage !== 'hired' && v.candidate.stage !== 'rejected') {
        <div class="grid lg:grid-cols-2 gap-6">
          <form (ngSubmit)="offer()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
            <h3 class="text-lg font-black tracking-tight">Job offer</h3>
            <div class="grid grid-cols-2 gap-4">
              <div><label class="label" for="od">Post / designation</label><input id="od" name="od" class="field" [(ngModel)]="of.designation"></div>
              <div><label class="label" for="os">Salary (Rs)</label><input id="os" name="os" type="number" min="1" class="field" required [(ngModel)]="of.salary"></div>
              <div><label class="label" for="oj">Joining date</label><input id="oj" name="oj" type="date" class="field" required [(ngModel)]="of.joining_date"></div>
              <div><label class="label" for="oe">Employment</label><select id="oe" name="oe" class="field" [(ngModel)]="of.employment">@for (e of emps; track e.key) { <option [value]="e.key">{{ e.label }}</option> }</select></div>
            </div>
            <div class="flex flex-wrap gap-3"><button class="btn-primary" type="submit">{{ v.candidate.stage === 'offered' ? 'Update offer' : 'Make offer' }}</button>
              @if (v.candidate.stage === 'offered') { <a class="btn-ghost" routerLink="/hr/print/offer" [queryParams]="{ id: v.candidate.id }">Print offer letter</a> }</div>
          </form>
          @if (v.candidate.stage === 'offered') {
            <form (ngSubmit)="hire()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border-2 border-emerald-500/40 shadow-enterprise space-y-4">
              <h3 class="text-lg font-black tracking-tight">Hire: make this person staff</h3>
              <p class="text-sm font-bold text-slate-400">The CV and papers move to the new staff record. Teachers also appear in the Timetable and drivers in Transport.</p>
              <div class="grid grid-cols-2 gap-4">
                <div><label class="label" for="ht">Staff type</label><select id="ht" name="ht" class="field" [(ngModel)]="hf.staff_type">@for (t of types; track t.key) { <option [value]="t.key">{{ t.label }}</option> }</select></div>
                <div><label class="label" for="hj">Joining date</label><input id="hj" name="hj" type="date" class="field" [(ngModel)]="hf.joining_date"></div>
                <div><label class="label" for="hb">Basic salary</label><input id="hb" name="hb" type="number" min="0" class="field" [(ngModel)]="hf.basic_salary"></div>
                <div><label class="label" for="hc">Contract ends (if any)</label><input id="hc" name="hc" type="date" class="field" [(ngModel)]="hf.contract_end"></div>
              </div>
              <button class="btn-primary" type="submit">Complete hiring</button>
            </form>
          }
        </div>
      }

      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-2">
        <h3 class="text-lg font-black tracking-tight">Messages sent</h3>
        @for (m of v.messages; track m.id) { <p class="text-sm font-bold py-1.5 border-b border-slate-100 dark:border-slate-800"><span class="capitalize">{{ m.channel }} · {{ m.kind }}</span> · {{ m.sent_at }}{{ m.by_name ? ' · ' + m.by_name : '' }}</p> } @empty { <p class="text-sm font-bold text-slate-400">Nothing sent yet.</p> }
      </section>
    }
  </div>
  `
})
export class RecCandidate {
  private api = inject(Api);
  private toast = inject(ToastService);
  private router = inject(Router);
  files = inject(HrFiles);
  id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  d = fmtDate; m = money; tt = timeText; sl = STAGE_LABEL; sb = stageBadge; sbadge = scoreBadge; emps = EMPLOYMENT; types = STAFF_TYPES; five = [1, 2, 3, 4, 5];
  moves = STAGES.filter(s => s !== 'hired' && s !== 'offered');
  x = signal<Detail | null>(null); jobs = signal<Job[]>([]); error = signal(''); panel = signal('');
  f: Partial<Candidate> = {};
  iv = { candidate_ids: [this.id], date: today(), time: '09:00', round: 'Interview', venue: '', panel: '', slot_minutes: 0 };
  of = { designation: '', salary: null as number | null, joining_date: today(), employment: 'permanent' };
  hf = { staff_type: 'teacher', joining_date: today(), basic_salary: 0, contract_end: '' };
  constructor() { this.api.get<Job[]>('/hr/recruit/jobs').subscribe({ next: j => this.jobs.set(j) }); this.load(); }
  load() {
    this.api.get<Detail>(`/hr/recruit/candidates/${this.id}`).subscribe({
      next: v => {
        this.x.set(v); this.f = { ...v.candidate };
        const c = v.candidate;
        this.of = { designation: c.offer_designation ?? v.job?.title ?? '', salary: c.offer_salary ?? c.expected_salary, joining_date: c.joining_date ?? today(), employment: c.offer_employment ?? 'permanent' };
        this.hf = { staff_type: v.job?.kind === 'teaching' ? 'teacher' : 'office', joining_date: c.joining_date ?? today(), basic_salary: c.offer_salary ?? 0, contract_end: '' };
        this.iv.venue = this.iv.venue || '';
      }, error: e => this.error.set(errorText(e))
    });
  }
  save() { this.api.put(`/hr/recruit/candidates/${this.id}`, this.f).subscribe({ next: () => { this.toast.show('Saved.'); this.load(); }, error: e => this.error.set(errorText(e)) }); }
  move(stage: string) {
    const reason = stage === 'rejected' ? (prompt('Reason (optional)') ?? '') : '';
    this.api.post('/hr/recruit/candidates/stage', { ids: [this.id], stage, reason }).subscribe({ next: () => { this.toast.show('Moved.'); this.load(); }, error: e => this.error.set(errorText(e)) });
  }
  async upload(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
    try { await this.files.upload('candidate', this.id, file, 'CV'); this.toast.show('Uploaded.'); this.load(); } catch (e) { this.error.set(errorText(e)); }
    input.value = '';
  }
  doneCount = (l: { done: boolean }[]) => l.filter(x => x.done).length;
  tick(list: { item: string; done: boolean }[], item: string, on: boolean) {
    const done: Record<string, boolean> = {};
    for (const c of list) done[c.item] = c.item === item ? on : c.done;
    this.api.put(`/hr/recruit/candidates/${this.id}/checklist`, { done }).subscribe({ next: () => { const c = list.find(x => x.item === item); if (c) c.done = on; }, error: e => this.toast.show(errorText(e), 'error') });
  }
  removeFile(fl: FileRow) { if (!confirm(`Delete ${fl.name}?`)) return; this.api.delete(`/hr/files/${fl.id}`).subscribe({ next: () => this.load(), error: e => this.error.set(errorText(e)) }); }
  addInterview() { this.api.post('/hr/recruit/interviews', this.iv).subscribe({ next: () => { this.toast.show('Interview scheduled.'); this.load(); }, error: e => this.error.set(errorText(e)) }); }
  offer() { this.api.put(`/hr/recruit/candidates/${this.id}/offer`, this.of).subscribe({ next: () => { this.toast.show('Offer saved. Send it by WhatsApp or print the letter.'); this.load(); }, error: e => this.error.set(errorText(e)) }); }
  hire() {
    if (!confirm('Complete the hiring and create the staff record?')) return;
    this.api.post<{ staff_id: number }>(`/hr/recruit/candidates/${this.id}/hire`, this.hf).subscribe({ next: r => { this.toast.show('Hired. The staff record is ready.'); this.router.navigate(['/hr/staff', r.staff_id]); }, error: e => this.error.set(errorText(e)) });
  }
}
