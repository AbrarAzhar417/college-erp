import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';

interface Auto { enabled: boolean; day: number; min: number; last: string; sms_ready: boolean; report: { at: string; sent: number; failed: number; skipped: number; note?: string } | null }

@Component({
  selector: 'app-auto-fee',
  imports: [FormsModule],
  template: `
  @if (auth.canSystem() && a(); as v) {
    <section class="bg-white dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-4" aria-label="Automatic fee reminders">
      <div class="flex flex-wrap items-center gap-3 justify-between">
        <div><h3 class="font-black">Automatic monthly fee reminders</h3>
          <p class="text-xs font-bold text-slate-400">The server sends one SMS a month to every parent who owes fee, on or after the chosen day, between 10 am and 6 pm. Never twice in a month. Every message appears in the log below.</p></div>
        <label class="flex items-center gap-3 text-sm font-black"><input type="checkbox" class="w-5 h-5 accent-indigo-600" [ngModel]="v.enabled" (ngModelChange)="v.enabled = $event; save()"> {{ v.enabled ? 'On' : 'Off' }}</label>
      </div>
      @if (!v.sms_ready) { <p class="p-3 rounded-2xl bg-amber-500/10 text-amber-700 font-bold text-sm">SMS is not set up (HR → Settings → Email and SMS). Nothing will be sent until it is.</p> }
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div><label class="label" for="af-day">Day of the month (1-28)</label><input id="af-day" type="number" min="1" max="28" class="field" [(ngModel)]="v.day"></div>
        <div><label class="label" for="af-min">Only if owing more than (Rs)</label><input id="af-min" type="number" min="0" class="field" [(ngModel)]="v.min"></div>
        <button type="button" class="btn-ghost" (click)="save()">Save</button>
        <button type="button" class="btn-primary" [disabled]="busy()" (click)="runNow()">Send this month's now</button>
      </div>
      <p class="text-xs font-bold text-slate-400">
        Last sent for: {{ v.last || 'never' }}.
        @if (v.report) { Last run: {{ v.report.sent }} sent, {{ v.report.failed }} failed, {{ v.report.skipped }} skipped{{ v.report.note ? ' — ' + v.report.note : '' }}. }
      </p>
    </section>
  }
  `
})
export class AutoFee {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  a = signal<Auto | null>(null);
  busy = signal(false);

  constructor() { if (this.auth.canSystem()) this.load(); }
  load() { this.api.get<Auto>('/parent-msg/auto').subscribe({ next: r => this.a.set(r), error: e => this.toast.show(errorText(e), 'error') }); }
  save() {
    const v = this.a(); if (!v) return;
    this.api.put<Auto>('/parent-msg/auto', { enabled: v.enabled, day: Number(v.day), min: Number(v.min) }).subscribe({
      next: r => { this.a.set(r); this.toast.show('Saved.'); }, error: e => { this.toast.show(errorText(e), 'error'); this.load(); } });
  }
  runNow() {
    if (!confirm('Send this month\'s fee reminders to every parent who owes fee, now?')) return;
    this.busy.set(true);
    this.api.post<{ ran: boolean; reason?: string; sent?: number; failed?: number }>('/parent-msg/auto/run', {}).subscribe({
      next: r => { this.busy.set(false); this.toast.show(r.ran ? `Sent ${r.sent}, failed ${r.failed}.` : `Not sent: ${r.reason}.`, r.ran ? 'ok' : 'error'); this.load(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); } });
  }
}
