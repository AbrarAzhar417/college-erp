import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { ToastService } from '../core/toast';
import { HrLookup, Job, STAGES, STAGE_LABEL, fmtDate, today } from './hr';

const blank = (): Partial<Job> => ({ title: '', department: 'Teaching', kind: 'teaching', positions: 1, qualification: '', experience: '', salary_range: '', keywords: '', description: '', posted_date: today(), last_date: '' });

@Component({
  selector: 'app-rec-jobs',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5">
      <h3 class="text-xl font-black tracking-tight">{{ f.id ? 'Edit job post' : 'New job post' }}</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="col-span-2"><label class="label" for="jt">Post (job title)</label><input id="jt" name="jt" class="field" required placeholder="Math teacher (Class 9 to 12)" [(ngModel)]="f.title"></div>
        <div><label class="label" for="jd">Department</label><input id="jd" name="jd" class="field" list="rec-depts" [(ngModel)]="f.department"></div>
        <div><label class="label" for="jk">Kind of job</label><select id="jk" name="jk" class="field" [(ngModel)]="f.kind"><option value="teaching">Teaching</option><option value="non_teaching">Office / support</option><option value="transport">Transport</option></select></div>
        <div><label class="label" for="jp">Seats</label><input id="jp" name="jp" type="number" min="1" class="field" [(ngModel)]="f.positions"></div>
        <div><label class="label" for="jq">Qualification</label><input id="jq" name="jq" class="field" placeholder="MSc Mathematics" [(ngModel)]="f.qualification"></div>
        <div><label class="label" for="je">Experience</label><input id="je" name="je" class="field" placeholder="2 years" [(ngModel)]="f.experience"></div>
        <div><label class="label" for="js">Salary</label><input id="js" name="js" class="field" placeholder="Rs 40,000 to 55,000" [(ngModel)]="f.salary_range"></div>
        <div><label class="label" for="jo">Posted on</label><input id="jo" name="jo" type="date" class="field" [(ngModel)]="f.posted_date"></div>
        <div><label class="label" for="jl">Last date to apply</label><input id="jl" name="jl" type="date" class="field" [(ngModel)]="f.last_date"></div>
        <div class="col-span-2 md:col-span-4"><label class="label" for="jw">Words to look for in CVs (separate with commas; they give the score out of 100)</label><input id="jw" name="jw" class="field" placeholder="cambridge, lesson planning, b.ed" [(ngModel)]="f.keywords"></div>
        <div class="col-span-2 md:col-span-4"><label class="label" for="jr">Description (duties, timings, how to apply)</label><textarea id="jr" name="jr" rows="3" class="field" [(ngModel)]="f.description"></textarea></div>
      </div>
      <datalist id="rec-depts">@for (n of look()?.departments ?? []; track n) { <option [value]="n"></option> }</datalist>
      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
      <div class="flex gap-3"><button class="btn-primary" type="submit">{{ f.id ? 'Save' : 'Create post' }}</button>@if (f.id) { <button type="button" class="btn-ghost" (click)="f = blank()">Cancel</button> }</div>
    </form>

    <div class="grid md:grid-cols-2 gap-4">
      @for (j of jobs(); track j.id) {
        <article class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3" [class.opacity-60]="j.status === 'closed'">
          <div class="flex items-start justify-between gap-3"><div><h4 class="text-lg font-black tracking-tight">{{ j.title }}</h4><p class="text-xs font-bold text-slate-400">{{ j.department }} · {{ j.positions }} seat{{ j.positions === 1 ? '' : 's' }} · {{ j.filled }} filled{{ j.last_date ? ' · apply by ' + d(j.last_date) : '' }}</p></div>
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="j.status === 'open' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/10 text-slate-500'">{{ j.status === 'open' ? 'Open' : 'Closed' }}</span></div>
          <p class="text-sm text-slate-500">{{ j.qualification }}{{ j.experience ? ' · ' + j.experience : '' }}{{ j.salary_range ? ' · ' + j.salary_range : '' }}</p>
          <div class="flex flex-wrap gap-1.5">@for (s of stages; track s) { <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-100 dark:bg-slate-800">{{ sl[s] }}: {{ j.stages[s] ?? 0 }}</span> }</div>
          <div class="flex flex-wrap gap-2 pt-1">
            <a class="btn-ghost" routerLink="/hr/recruit/candidates" [queryParams]="{ job: j.id }">Candidates ({{ j.total }})</a>
            <a class="btn-ghost" routerLink="/hr/print/job" [queryParams]="{ id: j.id }">Poster (print)</a>
            <button type="button" class="btn-ghost" (click)="copyAd(j)">Copy ad text</button>
            <a class="btn-ghost" [href]="waAd(j)" target="_blank" rel="noopener">Share on WhatsApp</a>
            <button type="button" class="btn-ghost" (click)="edit(j)">Edit</button>
            <button type="button" class="btn-ghost" (click)="setStatus(j)">{{ j.status === 'open' ? 'Close post' : 'Reopen' }}</button>
            @if (!j.total) { <button type="button" class="btn-ghost !text-rose-500" (click)="remove(j)">Delete</button> }</div>
        </article>
      } @empty { <p class="md:col-span-2 p-8 text-center text-sm font-bold text-slate-400">No job posts yet. Create the first one above, then add the CVs that come in under Candidates.</p> }
    </div>
  </div>
  `
})
export class RecJobs {
  private api = inject(Api);
  private toast = inject(ToastService);
  private settings = inject(SettingsService);
  d = fmtDate; sl = STAGE_LABEL; stages = STAGES; blank = blank;
  jobs = signal<Job[]>([]); look = signal<HrLookup | null>(null); error = signal(''); f: Partial<Job> = blank();
  constructor() { this.load(); this.api.get<HrLookup>('/hr/lookup').subscribe({ next: l => this.look.set(l) }); }
  load() { this.api.get<Job[]>('/hr/recruit/jobs').subscribe({ next: j => this.jobs.set(j), error: e => this.error.set(errorText(e)) }); }
  edit(j: Job) { this.f = { ...j }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  save() {
    this.error.set('');
    const req = this.f.id ? this.api.put(`/hr/recruit/jobs/${this.f.id}`, this.f) : this.api.post('/hr/recruit/jobs', this.f);
    req.subscribe({ next: () => { this.toast.show('Saved.'); this.f = blank(); this.load(); }, error: e => this.error.set(errorText(e)) });
  }
  /** The same words for WhatsApp, Facebook, a group or a notice board. */
  adText(j: Job) {
    const L = ['📢 *WANTED: ' + j.title + '*', this.settings.instituteName(), ''];
    L.push(`Seats: ${j.positions}`);
    if (j.qualification) L.push('Qualification: ' + j.qualification);
    if (j.experience) L.push('Experience: ' + j.experience);
    if (j.salary_range) L.push('Salary: ' + j.salary_range);
    if (j.description) L.push('', j.description);
    L.push('', '📩 How to apply: send your CV' + (this.settings.email() ? ' to ' + this.settings.email() : '') + (this.settings.phone() ? ' or WhatsApp / call ' + this.settings.phone() : ''));
    if (j.last_date) L.push('Last date: ' + fmtDate(j.last_date));
    if (this.settings.address()) L.push('📍 ' + this.settings.address());
    return L.join('\n');
  }
  waAd = (j: Job) => 'https://wa.me/?text=' + encodeURIComponent(this.adText(j));
  async copyAd(j: Job) {
    try { await navigator.clipboard.writeText(this.adText(j)); this.toast.show('Ad text copied. Paste it in WhatsApp, Facebook or any group.'); }
    catch { this.toast.show('Copy did not work in this browser. Use "Share on WhatsApp" instead.', 'error'); }
  }
  setStatus(j: Job) { this.api.put(`/hr/recruit/jobs/${j.id}/status`, { status: j.status === 'open' ? 'closed' : 'open' }).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
  remove(j: Job) { if (!confirm(`Delete the post "${j.title}"?`)) return; this.api.delete(`/hr/recruit/jobs/${j.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
