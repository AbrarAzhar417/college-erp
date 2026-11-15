import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../core/api';

interface Res { valid: boolean; institute?: string; receipt_no?: string; paid_on?: string; amount?: number; mode?: string; name?: string; class?: string; cancelled?: boolean; message?: string }

/** Open to everyone: reached by scanning the QR code on a fee receipt. */
@Component({
  selector: 'app-verify-receipt',
  template: `
  <main class="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 flex justify-center">
    <div class="w-full max-w-md space-y-5 py-8 text-center">
      <img src="/api/settings/logo" alt="" class="h-20 w-auto mx-auto mb-3" onerror="this.remove()">
      <h1 class="text-2xl font-black tracking-tight">Fee receipt check</h1>
      @if (loading()) { <p class="font-bold text-slate-400">Checking…</p> }
      @else if (r(); as v) {
        @if (v.valid && !v.cancelled) {
          <div class="p-6 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 space-y-1" role="status"><p class="text-3xl font-black text-emerald-700 dark:text-emerald-400">Genuine receipt</p><p class="text-sm font-bold">{{ v.institute }}</p></div>
        } @else if (v.valid && v.cancelled) {
          <div class="p-6 rounded-3xl bg-rose-500/10 border border-rose-500/30" role="alert"><p class="text-3xl font-black text-rose-700 dark:text-rose-400">Cancelled receipt</p><p class="text-sm font-bold">This receipt was issued by the college but later cancelled. It is not a valid payment.</p></div>
        } @else {
          <div class="p-6 rounded-3xl bg-rose-500/10 border border-rose-500/30" role="alert"><p class="text-3xl font-black text-rose-700 dark:text-rose-400">Not verified</p><p class="text-sm font-bold">{{ v.message }}</p></div>
        }
        @if (v.valid) {
          <dl class="text-left bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-2 text-sm font-bold">
            <div class="flex justify-between"><dt class="text-slate-400">Receipt no.</dt><dd>{{ v.receipt_no }}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Student</dt><dd>{{ v.name }}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Class</dt><dd>{{ v.class }}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Amount</dt><dd>Rs {{ v.amount }}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Date</dt><dd>{{ v.paid_on }}</dd></div>
          </dl>
        }
      }
    </div>
  </main>
  `
})
export class VerifyReceipt {
  r = signal<Res | null>(null);
  loading = signal(true);
  constructor() {
    const code = inject(ActivatedRoute).snapshot.paramMap.get('code') ?? '';
    inject(Api).get<Res>(`/public/receipt/${encodeURIComponent(code)}`).subscribe({
      next: r => { this.r.set(r); this.loading.set(false); },
      error: e => { this.r.set({ valid: false, message: e?.error?.message ?? 'This receipt could not be verified.' }); this.loading.set(false); }
    });
  }
}
