import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { Candidate, CvImport, HrFiles, Job, STAGES, STAGE_LABEL, fmtDate, money, scoreBadge, stageBadge, timeText, today } from './hr';
import { RecSend } from './rec-send';

const blank = () => ({ job_id: null as number | null, name: '', phone: '', email: '', cnic: '', city: '', qualification: '', experience_years: null as number | null, current_employer: '', current_salary: null as number | null, expected_salary: null as number | null, source: '', notes: '' });

@Component({
  selector: 'app-rec-candidates',
  imports: [FormsModule, RouterLink, RecSend],
  template: `
  <div class="space-y-6">
    <div class="flex flex-wrap gap-3">
      <button type="button" class="btn-primary" (click)="panel.set(panel() === 'add' ? '' : 'add')">Add a candidate</button>
      <button type="button" class="btn-ghost" (click)="panel.set(panel() === 'bulk' ? '' : 'bulk')">Upload many CVs at once</button>
    </div>

    @if (panel() === 'add') {
      <form (ngSubmit)="add()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><label class="label" for="cj">Applying for</label><select id="cj" name="cj" class="field" [(ngModel)]="nf.job_id"><option [ngValue]="null">- not chosen -</option>@for (j of jobs(); track j.id) { <option [ngValue]="j.id">{{ j.title }}</option> }</select></div>
          <div class="col-span-2 md:col-span-1"><label class="label" for="cn">Name</label><input id="cn" name="cn" class="field" required [(ngModel)]="nf.name"></div>
          <div><label class="label" for="cp">Phone</label><input id="cp" name="cp" class="field" placeholder="0300 1234567" [(ngModel)]="nf.phone"></div>
          <div><label class="label" for="ce">Email</label><input id="ce" name="ce" type="email" class="field" [(ngModel)]="nf.email"></div>
          <div><label class="label" for="cq">Qualification</label><input id="cq" name="cq" class="field" [(ngModel)]="nf.qualification"></div>
          <div><label class="label" for="cx">Experience (years)</label><input id="cx" name="cx" type="number" min="0" step="0.5" class="field" [(ngModel)]="nf.experience_years"></div>
          <div><label class="label" for="cy">Current employer</label><input id="cy" name="cy" class="field" [(ngModel)]="nf.current_employer"></div>
          <div><label class="label" for="cc">City</label><input id="cc" name="cc" class="field" [(ngModel)]="nf.city"></div>
          <div><label class="label" for="cs">Current salary</label><input id="cs" name="cs" type="number" min="0" class="field" [(ngModel)]="nf.current_salary"></div>
          <div><label class="label" for="ca">Expected salary</label><input id="ca" name="ca" type="number" min="0" class="field" [(ngModel)]="nf.expected_salary"></div>
          <div><label class="label" for="ci">CNIC</label><input id="ci" name="ci" class="field" [(ngModel)]="nf.cnic"></div>
          <div><label class="label" for="co">Came from</label><input id="co" name="co" class="field" placeholder="Newspaper, referral, walk-in" [(ngModel)]="nf.source"></div>
          <div class="col-span-2 md:col-span-4"><label class="label" for="cv">CV (PDF, Word, JPG or PNG)</label><input id="cv" type="file" class="field" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" (change)="pickCv($event)"></div>
        </div>
        <button class="btn-primary" type="submit" [disabled]="busy()">Save candidate</button>
      </form>
    }
    @if (panel() === 'bulk') {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <p class="text-sm font-bold text-slate-500">Choose the post and select all the CV files together. The name, phone, email, qualification and experience are read from every CV, and a score out of 100 is given against the words of the post. A person who applied before is not added twice.</p>
        <div class="grid md:grid-cols-3 gap-4 items-end">
          <div><label class="label" for="bj">Applying for</label><select id="bj" class="field" [ngModel]="bulkJob()" (ngModelChange)="bulkJob.set($event)"><option [ngValue]="null">- not chosen -</option>@for (j of jobs(); track j.id) { <option [ngValue]="j.id">{{ j.title }}</option> }</select></div>
          <div class="md:col-span-2"><label class="label" for="bf">CV files</label><input id="bf" type="file" multiple class="field" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" (change)="bulkUpload($event)"></div>
        </div>
        @if (progress()) { <p class="text-sm font-black text-indigo-600">{{ progress() }}</p> }
        @if (results().length) {
          <div class="overflow-x-auto"><table class="w-full text-left text-sm">
            <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2 pr-3">File</th><th class="py-2 pr-3">Result</th><th class="py-2 pr-3">Name read</th><th class="py-2 pr-3">Phone</th><th class="py-2 pr-3">Email</th><th class="py-2 pr-3">Experience</th><th class="py-2">Score</th></tr></thead>
            <tbody>@for (r of results(); track $index) { <tr class="border-t border-slate-100 dark:border-slate-800">
              <td class="py-2 pr-3 text-xs font-bold text-slate-400">{{ r.file }}</td>
              <td class="py-2 pr-3">@if (r.status === 'duplicate') { <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-amber-500/15 text-amber-700">Applied before{{ r.existing_job ? ' (' + r.existing_job + ')' : '' }}</span> } @else if (!r.text_ok) { <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-rose-500/15 text-rose-700">Picture CV: fill details by hand</span> } @else if (!r.name_found) { <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-amber-500/15 text-amber-700">Check the name</span> } @else { <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-emerald-500/15 text-emerald-700">Added</span> }</td>
              <td class="py-2 pr-3"><a [routerLink]="['/hr/recruit/candidate', r.id]" class="font-black hover:text-indigo-500">{{ r.name }}</a></td>
              <td class="py-2 pr-3">{{ r.phone || '-' }}</td><td class="py-2 pr-3">{{ r.email || '-' }}</td><td class="py-2 pr-3">{{ r.experience_years === null ? '-' : r.experience_years + ' yrs' }}</td>
              <td class="py-2"><span class="px-2 py-0.5 rounded-lg text-[11px] font-black" [class]="sbadge(r.score)">{{ r.score ?? '-' }}</span></td></tr> }</tbody></table></div>
        }
      </section>
    }

    <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
      <div class="col-span-2"><label class="label" for="fq">Search</label><input id="fq" class="field" placeholder="Name, phone, qualification, city, notes" [ngModel]="q()" (ngModelChange)="q.set($event); load()"></div>
      <div><label class="label" for="fj">Post</label><select id="fj" class="field" [ngModel]="job()" (ngModelChange)="job.set($event); load()"><option value="">All posts</option>@for (j of jobs(); track j.id) { <option [value]="j.id">{{ j.title }}</option> }</select></div>
      <div><label class="label" for="fs">Stage</label><select id="fs" class="field" [ngModel]="stage()" (ngModelChange)="stage.set($event); load()"><option value="">All stages</option>@for (s of stages; track s) { <option [value]="s">{{ sl[s] }}</option> }</select></div>
      <div><label class="label" for="fe">Experience at least (years)</label><input id="fe" type="number" min="0" class="field" [ngModel]="minExp()" (ngModelChange)="minExp.set($event); load()"></div>
      <div><label class="label" for="fr">Stars at least</label><select id="fr" class="field" [ngModel]="minRating()" (ngModelChange)="minRating.set($event); load()"><option value="">Any</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option><option value="5">5</option></select></div>
      <label class="flex items-center gap-2 text-sm font-bold col-span-2"><input type="checkbox" [ngModel]="hasCv()" (ngModelChange)="hasCv.set($event); load()"> Only those with a CV</label>
      <div class="col-span-2"><label class="label" for="fk">Words in the CV (commas)</label><input id="fk" class="field" placeholder="cambridge, b.ed" [ngModel]="kw()" (ngModelChange)="kw.set($event); load()"></div>
      <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" [ngModel]="matchAll()" (ngModelChange)="matchAll.set($event); load()"> All words</label>
      <div><label class="label" for="fm">Score at least</label><input id="fm" type="number" min="0" max="100" class="field" [ngModel]="minScore()" (ngModelChange)="minScore.set($event); load()"></div>
      <div><label class="label" for="fo">Order</label><select id="fo" class="field" [ngModel]="sort()" (ngModelChange)="sort.set($event); load()"><option value="rating">Best rated</option><option value="score">Highest score</option><option value="experience">Most experience</option><option value="newest">Newest</option></select></div>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (picked().length) {
      <div class="sticky top-2 z-20 bg-indigo-600 text-white p-4 rounded-2xl shadow-xl flex flex-wrap items-center gap-3">
        <b class="text-sm">{{ picked().length }} selected</b>
        <button type="button" class="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-black" (click)="stageTo('shortlisted')">Shortlist</button>
        <button type="button" class="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-black" (click)="panel.set('interview')">Call for interview</button>
        <button type="button" class="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-black" (click)="panel.set('send')">Send WhatsApp / SMS / email</button>
        <button type="button" class="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-black" (click)="stageTo('rejected')">Not selected</button>
        <button type="button" class="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-black" (click)="clear()">Clear</button>
      </div>
    }
    @if (panel() === 'interview' && picked().length) {
      <form (ngSubmit)="schedule()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border-2 border-sky-500/30 shadow-enterprise grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
        <h3 class="col-span-2 md:col-span-6 text-lg font-black tracking-tight">Interview for {{ picked().length }} candidates</h3>
        <div><label class="label" for="id">Date</label><input id="id" name="id" type="date" class="field" required [min]="todayIso" [(ngModel)]="iv.date"></div>
        <div><label class="label" for="it">First time</label><input id="it" name="it" type="time" class="field" [(ngModel)]="iv.time"></div>
        <div><label class="label" for="im">Minutes each</label><input id="im" name="im" type="number" min="0" max="240" class="field" [(ngModel)]="iv.slot_minutes"></div>
        <div><label class="label" for="ir">Round</label><input id="ir" name="ir" class="field" [(ngModel)]="iv.round"></div>
        <div><label class="label" for="iv">Place</label><input id="iv" name="iv" class="field" [(ngModel)]="iv.venue"></div>
        <div><label class="label" for="ip">Panel</label><input id="ip" name="ip" class="field" placeholder="Principal, HOD" [(ngModel)]="iv.panel"></div>
        <p class="col-span-2 md:col-span-5 text-xs font-bold text-slate-400">With "Minutes each" the first one gets the first time, the next one the next slot, and so on (like 9:00, 9:20, 9:40). Leave it 0 to give everybody the same time.</p>
        <button class="btn-primary" type="submit">Schedule</button>
      </form>
    }
    @if (panel() === 'send' && picked().length) { <app-rec-send [people]="picked()" initialKind="interview" (closed)="panel.set('')" /> }

    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
          <th class="px-4 py-4 w-10"><input type="checkbox" aria-label="Select all" [checked]="allPicked()" (change)="toggleAll($any($event.target).checked)"></th>
          <th class="px-4 py-4">Candidate</th><th class="px-4 py-4">Post</th><th class="px-4 py-4">Qualification</th><th class="px-4 py-4">Experience</th><th class="px-4 py-4">Score</th><th class="px-4 py-4">Expects</th><th class="px-4 py-4">Stars</th><th class="px-4 py-4">Stage</th></tr></thead>
        <tbody>@for (c of list(); track c.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60">
            <td class="px-4 py-3"><input type="checkbox" [attr.aria-label]="'Select ' + c.name" [checked]="isPicked(c.id)" (change)="toggle(c.id, $any($event.target).checked)"></td>
            <td class="px-4 py-3"><a [routerLink]="['/hr/recruit/candidate', c.id]" class="font-black hover:text-indigo-500">{{ c.name }}</a>
              <span class="block text-[11px] font-bold text-slate-400">{{ c.phone || 'no phone' }}{{ c.city ? ' · ' + c.city : '' }}{{ c.cvs ? ' · CV ✓' : ' · no CV' }}{{ c.messages ? ' · ' + c.messages + ' messages' : '' }}</span>
              @if (c.int_date) { <span class="block text-[11px] font-black text-sky-600">Interview {{ d(c.int_date) }} {{ tt(c.int_time) }}</span> }</td>
            <td class="px-4 py-3 font-bold">{{ c.job_title || '-' }}</td><td class="px-4 py-3">{{ c.qualification || '-' }}</td><td class="px-4 py-3 whitespace-nowrap">{{ c.experience_years === null ? '-' : c.experience_years + ' yrs' }}</td>
            <td class="px-4 py-3 whitespace-nowrap"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="sbadge(c.score)">{{ c.score ?? '-' }}</span>@if (kw()) { <span class="block text-[10px] font-bold text-slate-400">{{ c.kw_hits ?? 0 }} word{{ c.kw_hits === 1 ? '' : 's' }} found</span> }</td>
            <td class="px-4 py-3 whitespace-nowrap">{{ c.expected_salary ? 'Rs ' + m(c.expected_salary) : '-' }}</td>
            <td class="px-4 py-3 whitespace-nowrap">@for (n of five; track n) { <button type="button" class="text-lg leading-none" [class]="(c.rating ?? 0) >= n ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'" [attr.aria-label]="n + ' stars for ' + c.name" (click)="rate(c, n)">★</button> }</td>
            <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="sb(c.stage)">{{ sl[c.stage] }}</span></td></tr> }</tbody>
      </table>
      @if (!list().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No candidates here.</p> }
    </div>
  </div>
  `
})
export class RecCandidates {
  private api = inject(Api);
  private toast = inject(ToastService);
  private files = inject(HrFiles);
  d = fmtDate; m = money; tt = timeText; sl = STAGE_LABEL; sb = stageBadge; sbadge = scoreBadge; stages = STAGES; five = [1, 2, 3, 4, 5]; todayIso = today();
  list = signal<Candidate[]>([]); jobs = signal<Job[]>([]); error = signal(''); busy = signal(false); panel = signal(''); progress = signal('');
  q = signal(''); job = signal(''); stage = signal(''); minExp = signal(''); minRating = signal(''); hasCv = signal(false); sort = signal('rating'); kw = signal(''); matchAll = signal(false); minScore = signal(''); results = signal<(CvImport & { file: string })[]>([]);
  sel = signal<Set<number>>(new Set()); bulkJob = signal<number | null>(null);
  nf = blank(); cvFile: File | null = null;
  iv = { date: today(), time: '09:00', slot_minutes: 20, round: 'Interview', venue: '', panel: '' };
  constructor() {
    const j = inject(ActivatedRoute).snapshot.queryParamMap.get('job'); if (j) { this.job.set(j); this.bulkJob.set(Number(j)); this.nf.job_id = Number(j); }
    this.api.get<Job[]>('/hr/recruit/jobs').subscribe({ next: x => this.jobs.set(x) });
    this.load();
  }
  load() {
    this.api.get<Candidate[]>('/hr/recruit/candidates', { job_id: this.job(), stage: this.stage(), q: this.q(), min_exp: this.minExp(), min_rating: this.minRating(), has_cv: this.hasCv() ? '1' : '', sort: this.sort(), kw: this.kw(), match: this.matchAll() ? 'all' : '', min_score: this.minScore() })
      .subscribe({ next: l => this.list.set(l), error: e => this.error.set(errorText(e)) });
  }
  picked = computed(() => this.list().filter(c => this.sel().has(c.id)));
  isPicked = (id: number) => this.sel().has(id);
  allPicked = () => this.list().length > 0 && this.list().every(c => this.sel().has(c.id));
  toggle(id: number, on: boolean) { this.sel.update(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }); }
  toggleAll(on: boolean) { this.sel.set(on ? new Set(this.list().map(c => c.id)) : new Set()); }
  clear() { this.sel.set(new Set()); this.panel.set(''); }

  pickCv(ev: Event) { this.cvFile = (ev.target as HTMLInputElement).files?.[0] ?? null; }
  async add() {
    this.error.set(''); this.busy.set(true);
    try {
      const r = await new Promise<{ id: number; duplicate_of: { name: string; job_title: string | null } | null }>((ok, fail) => this.api.post<{ id: number; duplicate_of: { name: string; job_title: string | null } | null }>('/hr/recruit/candidates', this.nf).subscribe({ next: ok, error: fail }));
      if (this.cvFile) await this.files.upload('candidate', r.id, this.cvFile, 'CV');
      this.toast.show(r.duplicate_of ? `Saved, but ${r.duplicate_of.name} (same phone, email or CNIC) already applied${r.duplicate_of.job_title ? ' for ' + r.duplicate_of.job_title : ''}.` : 'Candidate saved.', r.duplicate_of ? 'error' : undefined); const jid = this.nf.job_id; this.nf = blank(); this.nf.job_id = jid; this.cvFile = null; this.load();
    } catch (e) { this.error.set(errorText(e)); }
    this.busy.set(false);
  }
  async bulkUpload(ev: Event) {
    const input = ev.target as HTMLInputElement, files = Array.from(input.files ?? []); if (!files.length) return;
    let added = 0, dup = 0, failed = 0; const out: (CvImport & { file: string })[] = [];
    this.results.set([]);
    for (const f of files) {
      this.progress.set(`Reading CV ${added + dup + failed + 1} of ${files.length}…`);
      try { const r = await this.files.importCv(f, this.bulkJob()); out.push({ ...r, file: f.name }); if (r.status === 'duplicate') dup++; else added++; }
      catch { failed++; }
    }
    input.value = ''; this.results.set(out);
    const hand = out.filter(r => r.status === 'created' && !r.text_ok).length;
    this.progress.set(`${added} added, ${dup} already applied before${failed ? `, ${failed} failed (wrong file type or too big)` : ''}${hand ? `, ${hand} are pictures (fill their details by hand)` : ''}.`); this.load();
  }

  rate(c: Candidate, n: number) {
    const rating = c.rating === n ? null : n;
    this.api.put(`/hr/recruit/candidates/${c.id}`, { ...c, rating }).subscribe({ next: () => { c.rating = rating; }, error: e => this.toast.show(errorText(e), 'error') });
  }
  stageTo(stage: string) {
    const reason = stage === 'rejected' ? (prompt('Reason (optional)') ?? '') : '';
    this.api.post<{ changed: number }>('/hr/recruit/candidates/stage', { ids: Array.from(this.sel()), stage, reason }).subscribe({ next: r => { this.toast.show(`${r.changed} moved to ${STAGE_LABEL[stage]}.`); this.clear(); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  schedule() {
    this.api.post('/hr/recruit/interviews', { candidate_ids: this.picked().map(c => c.id), ...this.iv }).subscribe({
      next: () => { this.toast.show('Interviews scheduled. Now send them the message.'); const keep = this.sel(); this.load(); this.panel.set('send'); this.sel.set(keep); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
