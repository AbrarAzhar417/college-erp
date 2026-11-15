import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';

interface N { id: number; title: string; body: string; target: 'staff' | 'parents' | 'all'; class_id: number | null; class_name: string | null; pinned: number; publish_on: string; expires_on: string | null; sms_sent: number; sms_count: number; reads: number; staff_total: number }
interface Cls { id: number; name: string }
const TARGET: Record<string, string> = { staff: 'Staff', parents: 'Parents', all: 'Staff and parents' };

@Component({
  selector: 'app-notice-board',
  imports: [FormsModule],
  template: `
  <div class="max-w-4xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Notice Board</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Write a notice once. Staff see it on their dashboard until it ends; for parents you can also send an SMS.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <section class="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 space-y-3">
      <div><label class="label" for="nb-t">Title</label><input id="nb-t" class="field" [(ngModel)]="f.title"></div>
      <div><label class="label" for="nb-b">Notice</label><textarea id="nb-b" rows="3" class="field" [(ngModel)]="f.body"></textarea></div>
      <div class="grid sm:grid-cols-4 gap-3">
        <div><label class="label" for="nb-w">For</label><select id="nb-w" class="field" [(ngModel)]="f.target"><option value="staff">Staff</option><option value="parents">Parents</option><option value="all">Staff and parents</option></select></div>
        <div><label class="label" for="nb-c">Parents of</label><select id="nb-c" class="field" [(ngModel)]="f.class_id" [disabled]="f.target === 'staff'"><option [ngValue]="null">All classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="nb-s">Show from</label><input id="nb-s" type="date" class="field" [(ngModel)]="f.publish_on"></div>
        <div><label class="label" for="nb-e">Show until</label><input id="nb-e" type="date" class="field" [(ngModel)]="f.expires_on"></div>
      </div>
      <div class="flex flex-wrap gap-5 items-center">
        <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" [(ngModel)]="f.pinned"> Pin to the top</label>
        @if (f.target !== 'staff') { <label class="flex items-center gap-2 text-sm font-bold"><input type="checkbox" [(ngModel)]="f.send_sms"> Send SMS to parents now</label> }
        <button type="button" class="btn-primary ml-auto" [disabled]="busy()" (click)="save()">{{ editing() ? 'Save changes' : 'Publish' }}</button>
        @if (editing()) { <button type="button" class="btn-ghost" (click)="reset()">Cancel</button> }
      </div>
    </section>
    @for (n of list(); track n.id) {
      <article class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
        <div class="flex flex-wrap items-center gap-2"><b>{{ n.pinned ? '📌 ' : '' }}{{ n.title }}</b>
          <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-indigo-500/10 text-indigo-600">{{ target[n.target] }}{{ n.class_name ? ' · ' + n.class_name : '' }}</span>
          <span class="text-xs font-bold text-slate-400">{{ n.publish_on }}{{ n.expires_on ? ' to ' + n.expires_on : '' }}</span></div>
        <p class="mt-2 text-sm font-bold whitespace-pre-line">{{ n.body }}</p>
        <div class="mt-3 flex flex-wrap gap-2 items-center text-xs font-bold text-slate-500">
          @if (n.target !== 'parents') { <span>Read by {{ n.reads }} of {{ n.staff_total }}</span> }
          @if (n.target !== 'staff') { <span>{{ n.sms_sent ? 'SMS sent to ' + n.sms_count + ' number(s)' : 'No SMS sent' }}</span>
            @if (!n.sms_sent) { <button type="button" class="btn-ghost !py-1 !px-3 text-xs" (click)="sms(n)">Send SMS now</button> } }
          <button type="button" class="btn-ghost !py-1 !px-3 text-xs ml-auto" (click)="edit(n)">Edit</button>
          <button type="button" class="btn-ghost !py-1 !px-3 text-xs text-rose-600" (click)="remove(n)">Delete</button></div>
      </article>
    } @empty { <p class="p-8 text-center font-bold text-slate-400">No notices yet.</p> }
  </div>
  `
})
export class NoticeBoard {
  private api = inject(Api); private toast = inject(ToastService); target = TARGET;
  list = signal<N[]>([]); classes = signal<Cls[]>([]); error = signal(''); busy = signal(false); editing = signal<number | null>(null);
  f = this.blank();
  private blank() { return { title: '', body: '', target: 'staff' as string, class_id: null as number | null, publish_on: new Date().toISOString().slice(0, 10), expires_on: '', pinned: false, send_sms: false }; }
  constructor() { this.load(); this.api.get<Cls[]>('/classes').subscribe({ next: c => this.classes.set(c), error: () => {} }); }
  load() { this.api.get<N[]>('/notices').subscribe({ next: l => { this.list.set(l); this.error.set(''); }, error: e => this.error.set(errorText(e)) }); }
  reset() { this.f = this.blank(); this.editing.set(null); }
  edit(n: N) { this.editing.set(n.id); this.f = { title: n.title, body: n.body, target: n.target, class_id: n.class_id, publish_on: n.publish_on, expires_on: n.expires_on ?? '', pinned: !!n.pinned, send_sms: false }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  save() {
    this.busy.set(true); const id = this.editing(), body = { ...this.f, expires_on: this.f.expires_on || null };
    const req = id ? this.api.put(`/notices/${id}`, body) : this.api.post<{ sms: { sent: number } | null }>('/notices', body);
    (req as any).subscribe({
      next: (r: any) => { this.busy.set(false); this.toast.show(r?.sms ? `Published. SMS sent to ${r.sms.sent} number(s).` : 'Saved.'); this.reset(); this.load(); },
      error: (e: unknown) => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
  sms(n: N) {
    if (!window.confirm('Send this notice as an SMS to the parents now? It can be sent only once.')) return;
    this.api.post<{ sent: number; failed: number; skipped: number }>(`/notices/${n.id}/sms`, {}).subscribe({ next: r => { this.toast.show(`SMS sent: ${r.sent}, failed: ${r.failed}, no number: ${r.skipped}.`, r.sent ? undefined : 'error'); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  remove(n: N) { if (!window.confirm('Delete this notice?')) return; this.api.delete(`/notices/${n.id}`).subscribe({ next: () => this.load(), error: e => this.toast.show(errorText(e), 'error') }); }
}
