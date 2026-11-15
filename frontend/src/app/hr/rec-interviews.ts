import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { fmtDate, stageBadge, STAGE_LABEL, timeText, today } from './hr';
import { Person, RecSend } from './rec-send';

interface Iv { id: number; candidate_id: number; name: string; phone: string | null; email: string | null; stage: string; job_title: string | null; round: string; date: string; time: string | null; venue: string | null; panel: string | null; status: string; score: number | null; feedback: string | null; result: string | null; edit?: boolean; sheets?: number }
interface Sheet { member: string; scores: Record<string, number | null>; remark: string }

@Component({
  selector: 'app-rec-interviews',
  imports: [FormsModule, RouterLink, RecSend],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-wrap items-end gap-4">
      <div><label class="label" for="vd">Day</label><input id="vd" type="date" class="field" [ngModel]="date()" (ngModelChange)="date.set($event); load()"></div>
      <button type="button" class="btn-ghost" (click)="date.set(''); load()">All days</button>
      <div><label class="label" for="vs">Status</label><select id="vs" class="field" [ngModel]="status()" (ngModelChange)="status.set($event); load()"><option value="">All</option><option value="scheduled">Waiting</option><option value="done">Done</option><option value="no_show">Did not come</option><option value="cancelled">Cancelled</option></select></div>
      <button type="button" class="btn-primary" (click)="remind.set(!remind())" [disabled]="!waiting().length">Send reminder to the {{ waiting().length }} waiting</button>
      <a class="btn-ghost" routerLink="/hr/print/interviews" [queryParams]="{ date: date() }">Print list</a>
      <a class="btn-ghost" routerLink="/hr/print/marksheet" [queryParams]="{ date: date() }">Print marks sheets (this day)</a>
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (remind()) { <app-rec-send [people]="waiting()" initialKind="interview" (closed)="remind.set(false)" /> }
    @if (mk(); as k) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border-2 border-indigo-500/30 shadow-enterprise space-y-4">
        <div class="flex items-center justify-between gap-3"><h3 class="text-lg font-black tracking-tight">Marks of {{ k.iv.name }} <span class="text-sm font-bold text-slate-400">(each point out of {{ k.max }})</span></h3><button type="button" class="btn-ghost" (click)="mk.set(null)">Close</button></div>
        <div class="overflow-x-auto"><table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-2 pr-3">Panel member</th>@for (c of k.criteria; track c) { <th class="py-2 pr-3">{{ c }}</th> }<th class="py-2 pr-3">Total</th><th class="py-2">Remark</th><th></th></tr></thead>
          <tbody>@for (sh of k.sheets; track $index; let n = $index) { <tr class="border-t border-slate-100 dark:border-slate-800">
            <td class="py-2 pr-3"><input class="field !py-2 min-w-32" [attr.aria-label]="'Member ' + (n + 1)" [(ngModel)]="sh.member" [name]="'mm' + n" placeholder="Name"></td>
            @for (c of k.criteria; track c) { <td class="py-2 pr-3"><input type="number" min="0" [max]="k.max" class="field !py-2 w-20" [attr.aria-label]="c + ' by ' + sh.member" [(ngModel)]="sh.scores[c]" [name]="'ms' + n + c"></td> }
            <td class="py-2 pr-3 font-black whitespace-nowrap">{{ sum(k, sh) }} / {{ k.max * k.criteria.length }}</td>
            <td class="py-2 pr-3"><input class="field !py-2 min-w-40" aria-label="Remark" [(ngModel)]="sh.remark" [name]="'mr' + n"></td>
            <td class="py-2"><button type="button" class="text-xs font-black text-rose-500" (click)="k.sheets.splice(n, 1)">Remove</button></td></tr> }</tbody></table></div>
        <div class="flex flex-wrap items-center gap-3"><button type="button" class="btn-ghost" (click)="addSheet(k)">Add panel member</button><button type="button" class="btn-primary" (click)="saveMarks(k)">Save marks</button>
          <span class="text-sm font-black text-indigo-600">Average: {{ avg(k) }}%</span></div>
      </section>
    }
    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800"><th class="px-4 py-4">When</th><th class="px-4 py-4">Candidate</th><th class="px-4 py-4">Round and place</th><th class="px-4 py-4">Result</th><th class="px-4 py-4"></th></tr></thead>
        <tbody>@for (i of list(); track i.id) {
          <tr class="border-b border-slate-50 dark:border-slate-800/60 align-top">
            <td class="px-4 py-3 whitespace-nowrap font-black">{{ d(i.date) }}<span class="block text-xs text-slate-400">{{ tt(i.time) }}</span></td>
            <td class="px-4 py-3"><a [routerLink]="['/hr/recruit/candidate', i.candidate_id]" class="font-black hover:text-indigo-500">{{ i.name }}</a><span class="block text-[11px] font-bold text-slate-400">{{ i.job_title }} · {{ i.phone }}</span><span class="px-2 py-0.5 rounded-lg text-[10px] font-black" [class]="sb(i.stage)">{{ sl[i.stage] }}</span></td>
            <td class="px-4 py-3 text-xs font-bold">{{ i.round }}<span class="block text-slate-400">{{ i.venue }}{{ i.panel ? ' · ' + i.panel : '' }}</span></td>
            <td class="px-4 py-3">
              @if (i.edit) {
                <div class="grid grid-cols-2 gap-2 min-w-72">
                  <select class="field !py-2" [attr.aria-label]="'Status of ' + i.name" [(ngModel)]="i.status" [name]="'st' + i.id"><option value="scheduled">Waiting</option><option value="done">Done</option><option value="no_show">Did not come</option><option value="cancelled">Cancelled</option></select>
                  <select class="field !py-2" [attr.aria-label]="'Result of ' + i.name" [(ngModel)]="i.result" [name]="'rs' + i.id"><option [ngValue]="null">No result</option><option value="pass">Passed</option><option value="hold">On hold</option><option value="fail">Failed</option></select>
                  <input type="number" min="0" max="100" class="field !py-2" placeholder="Score /100" [attr.aria-label]="'Score of ' + i.name" [(ngModel)]="i.score" [name]="'sc' + i.id">
                  <input type="time" class="field !py-2" [attr.aria-label]="'Time of ' + i.name" [(ngModel)]="i.time" [name]="'tm' + i.id">
                  <input class="field !py-2 col-span-2" placeholder="Feedback" [attr.aria-label]="'Feedback for ' + i.name" [(ngModel)]="i.feedback" [name]="'fb' + i.id">
                </div>
              } @else { <span class="font-bold capitalize">{{ i.status.replace('_', ' ') }}</span>@if (i.result) { <span class="ml-2 px-2 py-0.5 rounded-lg text-[11px] font-black" [class]="i.result === 'pass' ? 'bg-emerald-500/15 text-emerald-700' : i.result === 'fail' ? 'bg-rose-500/15 text-rose-700' : 'bg-amber-500/15 text-amber-700'">{{ i.result }}</span> }
                @if (i.score !== null) { <span class="ml-2 text-xs font-black">{{ i.score }}/100</span> } @if (i.feedback) { <span class="block text-xs text-slate-500">{{ i.feedback }}</span> } }</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              @if (i.edit) { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10" (click)="save(i)">Save</button> } @else { <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10" (click)="i.edit = true">Record result</button> }
              <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-sky-600 hover:bg-sky-500/10" (click)="openMarks(i)">Marks{{ i.sheets ? ' (' + i.sheets + ')' : '' }}</button>
              <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="remove(i)">Delete</button></td></tr> }</tbody>
      </table>
      @if (!list().length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No interviews. Select candidates under "Candidates &amp; screening" and press "Call for interview".</p> }
    </div>
  </div>
  `
})
export class RecInterviews {
  private api = inject(Api);
  private toast = inject(ToastService);
  d = fmtDate; tt = timeText; sb = stageBadge; sl = STAGE_LABEL;
  list = signal<Iv[]>([]); error = signal(''); date = signal(today()); status = signal(''); remind = signal(false);
  waiting = computed<Person[]>(() => this.list().filter(i => i.status === 'scheduled').map(i => ({ id: i.candidate_id, name: i.name, phone: i.phone, email: i.email, job_title: i.job_title, int_date: i.date, int_time: i.time, int_venue: i.venue })));
  mk = signal<{ iv: Iv; criteria: string[]; max: number; sheets: Sheet[] } | null>(null);
  constructor() { this.load(); }
  openMarks(i: Iv) {
    this.api.get<{ criteria: string[]; max: number; sheets: Sheet[] }>(`/hr/recruit/interviews/${i.id}/marks`).subscribe({
      next: r => {
        const names = (i.panel ?? '').split(',').map(x => x.trim()).filter(Boolean);
        const sheets = r.sheets.length ? r.sheets : (names.length ? names : ['']).map(member => ({ member, scores: {}, remark: '' }));
        this.mk.set({ iv: i, criteria: r.criteria, max: r.max, sheets });
      }, error: e => this.toast.show(errorText(e), 'error')
    });
  }
  addSheet(k: { sheets: Sheet[] }) { k.sheets.push({ member: '', scores: {}, remark: '' }); }
  sum = (k: { criteria: string[] }, sh: Sheet) => k.criteria.reduce((a, c) => a + (Number(sh.scores[c]) || 0), 0);
  avg(k: { criteria: string[]; max: number; sheets: Sheet[] }) { const l = k.sheets.filter(s => s.member.trim()); return l.length ? Math.round(l.reduce((a, s) => a + (this.sum(k, s) / (k.max * k.criteria.length)) * 100, 0) / l.length) : 0; }
  saveMarks(k: { iv: Iv; sheets: Sheet[] }) {
    this.api.put<{ score: number | null }>(`/hr/recruit/interviews/${k.iv.id}/marks`, { sheets: k.sheets }).subscribe({ next: r => { this.toast.show(r.score === null ? 'Saved.' : `Saved. Interview score ${r.score}/100.`); this.mk.set(null); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  load() { this.api.get<Iv[]>('/hr/recruit/interviews', { date: this.date(), status: this.status() }).subscribe({ next: l => this.list.set(l), error: e => this.error.set(errorText(e)) }); }
  save(i: Iv) {
    this.api.put(`/hr/recruit/interviews/${i.id}`, i).subscribe({ next: () => { this.toast.show('Saved.'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  remove(i: Iv) { if (!confirm(`Delete the interview of ${i.name}?`)) return; this.api.delete(`/hr/recruit/interviews/${i.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
