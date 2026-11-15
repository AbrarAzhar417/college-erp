import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AutoFee } from './auto-fee';
import { ClassInfo } from '../core/models';
import { ToastService } from '../core/toast';

interface Item { student_id: number; name: string; class_name: string; phone: string; text: string; wa: string; note?: string }
interface LogRow { id: number; at: string; student_name: string | null; kind: string; phone: string; status: string; error: string | null; text: string }
type Kind = 'absent' | 'fee' | 'custom';

@Component({
  selector: 'app-parent-msg',
  imports: [FormsModule, AutoFee],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Parent Messages</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Send an SMS to parents about absence or unpaid fee. Read the messages first, untick the ones you do not want to send. WhatsApp opens a ready message that you press Send on yourself.</p></div>
    @if (!smsReady()) { <p class="p-4 rounded-2xl bg-amber-500/10 text-amber-700 font-bold text-sm">SMS is not set up yet (HR → Settings → Email and SMS). You can still use the WhatsApp buttons.</p> }
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 items-end bg-white dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-800">
      <div><label class="label" for="pm-kind">Message</label><select id="pm-kind" class="field" [ngModel]="kind()" (ngModelChange)="setKind($event)"><option value="absent">Absent today</option><option value="fee">Fee reminder</option></select></div>
      <div><label class="label" for="pm-class">Class</label><select id="pm-class" class="field" [ngModel]="classId()" (ngModelChange)="classId.set($event); sectionId.set(null)"><option [ngValue]="null">All classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
      <div><label class="label" for="pm-sec">Section</label><select id="pm-sec" class="field" [ngModel]="sectionId()" (ngModelChange)="sectionId.set($event)" [disabled]="!classId()"><option [ngValue]="null">All</option>@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
      @if (kind() === 'absent') { <div><label class="label" for="pm-date">Date</label><input id="pm-date" type="date" class="field" [ngModel]="date()" (ngModelChange)="date.set($event)"></div> }
      @else { <div><label class="label" for="pm-min">Owing more than (Rs)</label><input id="pm-min" type="number" min="0" class="field" [ngModel]="min()" (ngModelChange)="min.set($event)"></div> }
      <div class="col-span-2 md:col-span-4"><label class="label" for="pm-text">Wording (you may change it; {{ '{name} {class} {date} {amount} {school}' }} are filled in for each child)</label><textarea id="pm-text" rows="3" class="field" dir="auto" [ngModel]="text()" (ngModelChange)="text.set($event)"></textarea></div>
      <button type="button" class="btn-primary" [disabled]="busy()" (click)="load()">Show messages</button>
    </div>

    <app-auto-fee />

    @if (items().length) {
      <section class="space-y-3">
        <div class="flex flex-wrap items-center gap-3"><span class="font-black">{{ chosen().length }} of {{ items().length }} selected</span>
          <button type="button" class="btn-ghost" (click)="all(true)">Select all</button><button type="button" class="btn-ghost" (click)="all(false)">Select none</button>
          <button type="button" class="btn-primary" [disabled]="busy() || !smsReady() || !chosen().length" (click)="send()">Send SMS to {{ chosen().length }}</button></div>
        <ul class="space-y-2">
          @for (i of items(); track i.student_id) {
            <li class="flex flex-wrap items-start gap-3 bg-white dark:bg-slate-900/40 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
              <input type="checkbox" class="mt-1" [attr.aria-label]="'Send to ' + i.name" [checked]="!off().has(i.student_id)" [disabled]="!!i.note" (change)="flip(i.student_id)">
              <div class="flex-1 min-w-56"><div class="font-black">{{ i.name }} <span class="text-xs text-slate-400">{{ i.class_name }} · {{ i.phone || 'no number' }}</span></div>
                <p class="text-sm font-bold text-slate-500 mt-1" dir="auto">{{ i.text }}</p>@if (i.note) { <p class="text-xs font-black text-rose-500">{{ i.note }}</p> }</div>
              @if (i.wa) { <a class="btn-ghost" [href]="i.wa" target="_blank" rel="noopener">WhatsApp</a> }
            </li>
          }
        </ul>
      </section>
    } @else if (loaded()) { <p class="p-8 text-center font-bold text-slate-400">No student matches.</p> }

    <section class="space-y-2"><h3 class="text-xl font-black">Recently sent</h3>
      <div class="overflow-x-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800"><table class="w-full text-left text-xs"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-3 py-3">When</th><th class="px-3 py-3">Student</th><th class="px-3 py-3">Kind</th><th class="px-3 py-3">Status</th></tr></thead>
        <tbody>@for (m of log(); track m.id) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="px-3 py-2 whitespace-nowrap">{{ m.at }}</td><td class="px-3 py-2 font-bold">{{ m.student_name || '-' }}</td><td class="px-3 py-2">{{ m.kind }}</td><td class="px-3 py-2 font-black" [class]="m.status === 'sent' ? 'text-emerald-600' : 'text-rose-500'">{{ m.status }} <span class="font-bold text-slate-400">{{ m.error }}</span></td></tr> }
          @empty { <tr><td colspan="4" class="p-6 text-center font-bold text-slate-400">Nothing sent yet.</td></tr> }</tbody></table></div></section>
  </div>
  `
})
export class ParentMsg {
  private api = inject(Api); private toast = inject(ToastService);
  kind = signal<Kind>('absent'); classes = signal<ClassInfo[]>([]); classId = signal<number | null>(null); sectionId = signal<number | null>(null);
  date = signal(new Date().toISOString().slice(0, 10)); min = signal(0); text = signal(''); defaults = signal<Record<string, string>>({});
  items = signal<Item[]>([]); off = signal<Set<number>>(new Set()); log = signal<LogRow[]>([]);
  smsReady = signal(true); busy = signal(false); error = signal(''); loaded = signal(false);
  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  chosen = computed(() => this.items().filter(i => !i.note && !this.off().has(i.student_id)));

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    this.api.get<ClassInfo[]>('/classes').subscribe(c => this.classes.set(c));
    this.api.get<{ sms_ready: boolean; defaults: Record<string, string> }>('/parent-msg/status').subscribe({
      next: r => { this.smsReady.set(r.sms_ready); this.defaults.set(r.defaults); const k = q.get('kind'); if (k === 'fee') this.kind.set('fee'); this.text.set(r.defaults[this.kind()]); if (q.get('classId')) this.classId.set(Number(q.get('classId'))); if (q.get('sectionId')) this.sectionId.set(Number(q.get('sectionId'))); if (q.get('min')) this.min.set(Number(q.get('min'))); if (k) this.load(); },
      error: e => this.error.set(errorText(e))
    });
    this.loadLog();
  }
  setKind(k: Kind) { this.kind.set(k); this.text.set(this.defaults()[k] ?? ''); this.items.set([]); this.loaded.set(false); }
  load() {
    this.busy.set(true); this.error.set('');
    this.api.post<Item[]>('/parent-msg/preview', { kind: this.kind(), classId: this.classId(), sectionId: this.sectionId(), date: this.date(), min: this.min(), text: this.text() }).subscribe({
      next: r => { this.items.set(r); this.off.set(new Set()); this.loaded.set(true); this.busy.set(false); }, error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  flip(id: number) { this.off.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  all(on: boolean) { this.off.set(on ? new Set() : new Set(this.items().map(i => i.student_id))); }
  send() {
    const list = this.chosen();
    if (!confirm(`Send ${list.length} SMS now?`)) return;
    this.busy.set(true);
    this.api.post<{ sent: number; failed: number; skipped: number; errors: string[] }>('/parent-msg/send', { kind: this.kind(), items: list.map(i => ({ student_id: i.student_id, phone: i.phone, text: i.text })) }).subscribe({
      next: r => { this.busy.set(false); this.toast.show(`Sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped}.${r.errors[0] ? ' ' + r.errors[0] : ''}`, r.failed ? 'error' : 'ok'); this.loadLog(); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  loadLog() { this.api.get<LogRow[]>('/parent-msg/log', { limit: 30 }).subscribe(r => this.log.set(r)); }
}
