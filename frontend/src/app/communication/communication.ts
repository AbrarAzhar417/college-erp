import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { AUDIENCE_LABEL, KIND_LABEL, Kind, Notice, niceDate } from './comm-types';

interface Ack { applies: boolean; users: { id: number; name: string; role: string; read_at: string | null }[] }
interface PClass { section_id: number; label: string; students: number; sent: number }
interface Recipient { student_id: number; name: string; father_name: string; roll_no: number | null; phone: string | null; sent: boolean; message: string }

@Component({
  selector: 'app-communication',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-6">
    <div class="flex flex-wrap items-end gap-4">
      <div class="flex-1 min-w-64"><h2 class="text-3xl font-black tracking-tighter">Communication</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">Circulars, meeting points, orders, date sheets and result notifications for staff and parents.</p></div>
      @if (office()) { <a routerLink="/communication/new" class="btn-primary">New notice</a> }
    </div>
    <div class="flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
      <button type="button" (click)="kind.set('')" class="px-4 py-2 rounded-xl text-xs font-black border border-slate-200 dark:border-slate-800" [class]="kind() === '' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900/40 text-slate-500'">All</button>
      @for (k of kinds; track k.key) { <button type="button" (click)="kind.set(k.key)" class="px-4 py-2 rounded-xl text-xs font-black border border-slate-200 dark:border-slate-800" [class]="kind() === k.key ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900/40 text-slate-500'">{{ k.label }}</button> }
    </div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="space-y-3">
      @for (n of shown(); track n.id) {
        <article class="bg-white dark:bg-slate-900/40 rounded-[1.75rem] border shadow-enterprise overflow-hidden" [class]="n.needs_ack ? 'border-indigo-500' : 'border-slate-200 dark:border-slate-800'">
          <button type="button" class="w-full flex flex-wrap items-center gap-3 p-5 text-left" (click)="toggle(n)" [attr.aria-expanded]="openId() === n.id">
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">{{ label[n.kind] }}</span>
            @if (n.priority === 'urgent') { <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-rose-500/15 text-rose-600">Urgent</span> }
            @if (n.status !== 'published') { <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-amber-500/15 text-amber-700">{{ n.status }}</span> }
            <span class="font-black flex-1 min-w-48">{{ n.title }}</span>
            <span class="text-xs font-bold text-slate-400">{{ n.ref_no ?? 'not issued' }} · {{ nice(n.issue_date) }} · {{ audience[n.audience] }}</span>
            @if (n.needs_ack) { <span class="text-[11px] font-black text-indigo-600">NEW</span> }
          </button>
          @if (openId() === n.id) {
            <div class="p-5 border-t border-slate-100 dark:border-slate-800 space-y-4">
              @if (n.body) { <p class="text-sm whitespace-pre-line">{{ n.body }}</p> }
              @if (n.kind === 'meeting') {
                <p class="text-xs font-black text-slate-400">{{ n.data.meeting_date ? nice(n.data.meeting_date) : '' }} {{ n.data.time }} {{ n.data.venue ? '· ' + n.data.venue : '' }}{{ n.data.attendees ? ' · Present: ' + n.data.attendees : '' }}</p>
                <ol class="list-decimal pl-5 space-y-1 text-sm font-bold">@for (p of n.data.points ?? []; track $index) { <li>{{ p.text }}@if (p.assignee) { <span class="text-indigo-600"> → {{ p.assignee }}</span> }@if (p.due) { <span class="text-rose-500"> by {{ nice(p.due) }}</span> }</li> }</ol>
              }
              @if (n.kind === 'datesheet') {
                <div class="overflow-x-auto"><table class="w-full text-sm"><caption class="sr-only">Date sheet</caption><thead><tr class="text-left text-[11px] font-black uppercase tracking-widest text-slate-400"><th scope="col">Class</th><th scope="col">Date</th><th scope="col">Subject</th><th scope="col">Time</th></tr></thead>
                  <tbody>@for (r of n.data.rows ?? []; track $index) { <tr class="border-t border-slate-100 dark:border-slate-800 font-bold"><td class="py-1">{{ r.class_label }}</td><td>{{ nice(r.date) }}</td><td>{{ r.subject }}</td><td>{{ r.time }}</td></tr> }</tbody></table></div>
              }
              @if (n.kind === 'result' && n.data.lines?.length) {
                <div class="overflow-x-auto"><table class="w-full text-sm"><caption class="sr-only">Results</caption><thead><tr class="text-left text-[11px] font-black uppercase tracking-widest text-slate-400"><th scope="col">Class</th><th scope="col">Passed %</th><th scope="col">Average %</th><th scope="col">Top</th></tr></thead>
                  <tbody>@for (l of n.data.lines ?? []; track $index) { <tr class="border-t border-slate-100 dark:border-slate-800 font-bold"><td class="py-1">{{ l.class_label }}</td><td>{{ l.pass_pct ?? '-' }}</td><td>{{ l.avg ?? '-' }}</td><td>{{ l.top }}</td></tr> }</tbody></table></div>
              }
              <p class="text-xs font-bold text-slate-400">Signed: {{ n.signed_by }}</p>
              <div class="flex flex-wrap gap-2">
                @if (n.status === 'published') { <a class="btn-ghost" [routerLink]="['/communication', n.id, 'print']">Print</a> }
                @if (n.needs_ack) { <button type="button" class="btn-primary" (click)="ack(n)">I have read this</button> }
                @if ((office() && n.status === 'draft') || approver()) { <a class="btn-ghost" [routerLink]="['/communication', n.id, 'edit']">Edit</a><button type="button" class="btn-ghost" (click)="remove(n)">Delete draft</button> }
                @if (approver() && n.status === 'draft') { <button type="button" class="btn-primary" (click)="publish(n)">Publish</button> }
                @if (approver() && n.status === 'published') { <button type="button" class="btn-ghost" (click)="withdraw(n)">Withdraw</button> }
                @if (office() && n.status === 'published') { <button type="button" class="btn-ghost" (click)="loadAcks(n)">Who has read it</button>@if (n.audience === 'parents' || n.audience === 'all') { <button type="button" class="btn-ghost" (click)="loadParents(n)">Send to parents</button> } }
              </div>
              @if (acks(); as a) { @if (a.applies) {
                <div class="rounded-xl border border-slate-200 dark:border-slate-800 p-3"><p class="text-xs font-black text-slate-400 mb-2">{{ readCount() }} of {{ a.users.length }} have read it</p>
                  @for (u of a.users; track u.id) { <p class="text-sm font-bold py-0.5" [class.text-rose-500]="!u.read_at">{{ u.name }} <span class="text-xs text-slate-400">({{ u.role }})</span> {{ u.read_at ? '✓' : 'not yet' }}</p> }</div>
              } }
              @if (pclasses().length) {
                <div class="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                  <div class="flex flex-wrap gap-2">@for (c of pclasses(); track c.section_id) { <button type="button" class="btn-ghost" (click)="loadRecipients(n, c.section_id)">{{ c.label }} · {{ c.sent }}/{{ c.students }} sent</button> }</div>
                  @for (r of recips(); track r.student_id) {
                    <div class="flex flex-wrap items-center gap-3 text-sm font-bold"><span class="flex-1 min-w-40">{{ r.roll_no ?? '-' }}. {{ r.name }} <span class="text-slate-400">({{ r.father_name }})</span></span>
                      @if (r.phone) { <a class="text-emerald-600 font-black" target="_blank" rel="noopener" [href]="'https://wa.me/' + r.phone + '?text=' + enc(r.message)" (click)="sent(n, r)">WhatsApp</a><a class="text-indigo-600 font-black" [href]="'sms:+' + r.phone + '?body=' + enc(r.message)" (click)="sent(n, r)">SMS</a> } @else { <span class="text-xs text-rose-500">No valid phone</span> }
                      @if (r.sent) { <span class="text-xs text-emerald-600">sent</span> }</div>
                  }
                </div>
              }
            </div>
          }
        </article>
      } @empty { <p class="p-10 text-center text-sm font-bold text-slate-400">Nothing here yet.</p> }
    </div>
  </div>
  `
})
export class Communication {
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  nice = niceDate; enc = encodeURIComponent; label = KIND_LABEL; audience = AUDIENCE_LABEL;
  kinds = (Object.keys(KIND_LABEL) as Kind[]).map(key => ({ key, label: KIND_LABEL[key] }));
  office = computed(() => this.auth.canWriteStudents()); approver = computed(() => this.auth.isLeadership());
  all = signal<Notice[]>([]); kind = signal(''); error = signal(''); openId = signal(0);
  shown = computed(() => this.all().filter(n => !this.kind() || n.kind === this.kind()));
  acks = signal<Ack | null>(null); readCount = computed(() => this.acks()?.users.filter(u => u.read_at).length ?? 0);
  pclasses = signal<PClass[]>([]); recips = signal<Recipient[]>([]);
  private fail = (e: unknown) => this.toast.show(errorText(e), 'error');
  constructor() { this.load(); }
  load() { this.api.get<Notice[]>('/communication').subscribe({ next: r => this.all.set(r), error: e => this.error.set(errorText(e)) }); }
  toggle(n: Notice) { this.acks.set(null); this.pclasses.set([]); this.recips.set([]); this.openId.set(this.openId() === n.id ? 0 : n.id); }
  ack(n: Notice) { this.api.post(`/communication/${n.id}/read`, {}).subscribe({ next: () => { this.toast.show('Marked as read.'); this.load(); }, error: this.fail }); }
  publish(n: Notice) { if (confirm('Publish this notice? It gets its reference number and can no longer be edited.')) this.api.put<{ ref_no: string }>(`/communication/${n.id}/publish`, {}).subscribe({ next: r => { this.toast.show(`Published as ${r.ref_no}`); this.load(); }, error: this.fail }); }
  withdraw(n: Notice) { if (confirm('Withdraw this notice? It stays on record, marked as withdrawn.')) this.api.put(`/communication/${n.id}/withdraw`, {}).subscribe({ next: () => this.load(), error: this.fail }); }
  remove(n: Notice) { if (confirm('Delete this draft?')) this.api.delete(`/communication/${n.id}`).subscribe({ next: () => this.load(), error: this.fail }); }
  loadAcks(n: Notice) { this.api.get<Ack>(`/communication/${n.id}/acks`).subscribe({ next: r => this.acks.set(r), error: this.fail }); }
  loadParents(n: Notice) { this.recips.set([]); this.api.get<PClass[]>(`/communication/${n.id}/parent-classes`).subscribe({ next: r => this.pclasses.set(r), error: this.fail }); }
  loadRecipients(n: Notice, sid: number) { this.api.get<Recipient[]>(`/communication/${n.id}/recipients`, { section_id: sid }).subscribe({ next: r => this.recips.set(r), error: this.fail }); }
  sent(n: Notice, r: Recipient) { this.api.put(`/communication/${n.id}/students/${r.student_id}/sent`, {}).subscribe({ next: () => this.recips.update(l => l.map(x => x.student_id === r.student_id ? { ...x, sent: true } : x)) }); }
}
