import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';

interface Subj { subject: string; max: number; marks: number | null; status: string; pass: boolean | null }
interface Res { exam: string; session: string; class: string; subjects: Subj[]; total: number; max: number; pct: number | null; grade: string | null; result: string; position: number | null }
interface Out { student: { name: string; father_name: string; reg_no: string; roll_no: number | null }; results: Res[] }

/** Open to everyone: a parent types the registration number and the father's CNIC. */
@Component({
  selector: 'app-public-result',
  imports: [FormsModule],
  template: `
  <main class="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 flex justify-center">
    <div class="w-full max-w-xl space-y-5 py-6">
      <header class="text-center"><h1 class="text-2xl font-black tracking-tight">{{ name() }}</h1><p class="text-sm font-bold text-slate-500">Check result</p></header>
      @if (!enabled()) { <p class="p-5 rounded-2xl bg-slate-500/10 font-bold text-center">Online result lookup is not available right now. Please contact the college office.</p> }
      @else {
        <form class="bg-white dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-4" (ngSubmit)="go()">
          <div><label class="label" for="pr-reg">Registration number (as on the admission form)</label><input id="pr-reg" class="field" autocomplete="off" [ngModel]="reg()" (ngModelChange)="reg.set($event)" name="reg" required></div>
          <div><label class="label" for="pr-cnic">Father's CNIC (13 digits)</label><input id="pr-cnic" class="field" inputmode="numeric" autocomplete="off" placeholder="35202-1234567-1" [ngModel]="cnic()" (ngModelChange)="cnic.set($event)" name="cnic" required></div>
          <button class="btn-primary w-full" type="submit" [disabled]="busy()">Show result</button>
          @if (error()) { <p role="alert" class="text-rose-600 font-bold text-sm">{{ error() }}</p> }
        </form>
        @if (out(); as o) {
          <section class="space-y-4">
            <div class="p-4 rounded-2xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800"><div class="font-black text-lg">{{ o.student.name }}</div><div class="text-sm font-bold text-slate-500">S/O {{ o.student.father_name }} · Reg {{ o.student.reg_no }} @if (o.student.roll_no) { · Roll {{ o.student.roll_no }} }</div></div>
            @for (r of o.results; track $index) {
              <article class="p-4 rounded-2xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-3">
                <div class="flex flex-wrap justify-between gap-2"><h2 class="font-black">{{ r.exam }} <span class="text-xs text-slate-400">{{ r.session }} · {{ r.class }}</span></h2><span class="font-black" [class]="r.result === 'PASS' ? 'text-emerald-600' : 'text-rose-500'">{{ r.result }}</span></div>
                <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr class="text-[11px] font-black text-slate-400 uppercase"><th class="py-1">Subject</th><th class="py-1 text-right">Marks</th><th class="py-1 text-right">Out of</th></tr></thead>
                  <tbody>@for (s of r.subjects; track s.subject) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-1 font-bold">{{ s.subject }}</td><td class="py-1 text-right font-black" [class]="s.pass === false ? 'text-rose-500' : ''">{{ s.status === 'A' ? 'Absent' : s.status === 'L' ? 'Leave' : s.marks }}</td><td class="py-1 text-right">{{ s.max }}</td></tr> }</tbody></table></div>
                <p class="text-sm font-black">Total {{ r.total }} / {{ r.max }} · {{ r.pct ?? '-' }}% · Grade {{ r.grade || '-' }}@if (r.position) { · Position {{ r.position }} }</p>
              </article>
            } @empty { <p class="p-5 rounded-2xl bg-slate-500/10 font-bold text-center">No result has been published yet.</p> }
          </section>
        }
      }
    </div>
  </main>
  `
})
export class PublicResult {
  private api = inject(Api);
  enabled = signal(true); name = signal('Result'); reg = signal(''); cnic = signal(''); busy = signal(false); error = signal(''); out = signal<Out | null>(null);
  constructor() { this.api.get<{ enabled: boolean; name: string }>('/public/result-info').subscribe({ next: r => { this.enabled.set(r.enabled); this.name.set(r.name || 'Result'); }, error: () => this.enabled.set(false) }); }
  go() {
    this.busy.set(true); this.error.set(''); this.out.set(null);
    this.api.post<Out>('/public/result', { reg_no: this.reg(), cnic: this.cnic() }).subscribe({ next: r => { this.busy.set(false); this.out.set(r); }, error: e => { this.busy.set(false); this.error.set(errorText(e)); } });
  }
}
