import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';
import { ToastService } from '../core/toast';
import { fillTemplate, fmtDate, mailLink, money, normPhone, smsLink, timeText, validPhone, waLink } from './hr';

export interface Person {
  id: number; name: string; phone: string | null; email: string | null; job_title: string | null;
  int_date?: string | null; int_time?: string | null; int_venue?: string | null; offer_salary?: number | null; joining_date?: string | null;
}
const KINDS = [{ key: 'interview', label: 'Interview call' }, { key: 'shortlist', label: 'Shortlisted' }, { key: 'offer', label: 'Job offer' }, { key: 'reject', label: 'Not selected' }, { key: 'general', label: 'General message' }];
const SUBJECT: Record<string, string> = { interview: 'Interview call', shortlist: 'Your application is shortlisted', offer: 'Job offer', reject: 'Your application', general: 'Message from us' };
const CHUNK = 30;

/** Opens WhatsApp / SMS / email on the person's own phone or computer, one click each (or one click for everybody by email). */
@Component({
  selector: 'app-rec-send',
  imports: [FormsModule],
  template: `
  <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border-2 border-indigo-500/30 shadow-enterprise space-y-5">
    <div class="flex items-center justify-between gap-3"><h3 class="text-lg font-black tracking-tight">Message {{ people().length }} candidate{{ people().length === 1 ? '' : 's' }}</h3><button type="button" class="btn-ghost" (click)="closed.emit()">Close</button></div>
    <div class="grid md:grid-cols-3 gap-4">
      <div><label class="label" for="mk">Message</label><select id="mk" class="field" [ngModel]="kind()" (ngModelChange)="setKind($event)">@for (k of kinds; track k.key) { <option [value]="k.key">{{ k.label }}</option> }</select></div>
      <div class="md:col-span-2"><label class="label" for="ms">Email subject</label><input id="ms" class="field" [ngModel]="subject()" (ngModelChange)="subject.set($event)"></div>
      <div class="md:col-span-3"><label class="label" for="mt">Text (the {{ '{name}' }}, {{ '{post}' }}, {{ '{date}' }}, {{ '{time}' }}, {{ '{venue}' }}, {{ '{salary}' }}, {{ '{joining}' }} and {{ '{college}' }} parts are filled in for each person)</label>
        <textarea id="mt" rows="6" class="field" [ngModel]="tpl()" (ngModelChange)="tpl.set($event)"></textarea></div>
    </div>
    <div class="flex flex-wrap items-center gap-3"><button type="button" class="btn-ghost" (click)="saveDefault()">Keep this text for next time</button>
      <span class="text-xs font-bold text-slate-400">WhatsApp and SMS open the app with the text ready; you press send there. SMS goes from the phone's SIM, so open this page on the phone.</span></div>

    <div class="flex flex-wrap gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 items-center">
      <button type="button" class="btn-primary" (click)="next('whatsapp')" [disabled]="!pending('whatsapp')">WhatsApp: next ({{ pending('whatsapp') }} left)</button>
      <button type="button" class="btn-primary" (click)="next('sms')" [disabled]="!pending('sms')">SMS: next ({{ pending('sms') }} left)</button>
      @if (sameText()) {
        @for (c of mailChunks(); track $index) { <a class="btn-primary" [href]="c.href" (click)="logMany(c.ids, 'email')">Email {{ mailChunks().length > 1 ? 'group ' + ($index + 1) + ' (' + c.ids.length + ')' : 'everyone (' + c.ids.length + ')' }}</a> }
        @if (smsGroup(); as g) { <a class="btn-ghost" [href]="g.href" (click)="logMany(g.ids, 'sms')">SMS to all at once</a> }
      } @else { <span class="text-xs font-bold text-amber-600">Each person has a different time or place, so use the buttons on each line (one email to everybody is not possible).</span> }
    </div>
    @if (cfg(); as c) {
      <div class="flex flex-wrap gap-3 p-4 rounded-2xl bg-sky-500/5 border border-sky-500/20 items-center">
        <span class="text-xs font-black uppercase tracking-widest text-sky-700 dark:text-sky-300">Send from the system</span>
        <button type="button" class="btn-primary" [disabled]="sending() || !c.smtp.ready" (click)="sendNow('email')">Email {{ withEmail() }} now</button>
        <button type="button" class="btn-primary" [disabled]="sending() || !c.sms.ready" (click)="sendNow('sms')">SMS {{ withPhone() }} now</button>
        @if (!c.smtp.ready || !c.sms.ready) { <span class="text-xs font-bold text-slate-400">Set up {{ !c.smtp.ready ? 'email' : '' }}{{ !c.smtp.ready && !c.sms.ready ? ' and ' : '' }}{{ !c.sms.ready ? 'SMS' : '' }} under "Email, SMS &amp; marking".</span> }
        @if (outcome()) { <p class="basis-full text-sm font-bold" [class]="outcomeBad() ? 'text-amber-600' : 'text-emerald-600'">{{ outcome() }}</p> }
      </div>
    }
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }

    <div class="overflow-x-auto"><table class="w-full text-left text-sm">
      <tbody>@for (p of people(); track p.id) {
        <tr class="border-b border-slate-100 dark:border-slate-800">
          <td class="py-2.5 pr-3 font-black">{{ p.name }}<span class="block text-[11px] font-bold text-slate-400">{{ p.phone || 'no phone' }} · {{ p.email || 'no email' }}</span>
            @if (kind() === 'interview' && !p.int_date) { <span class="block text-[11px] font-black text-amber-600">No interview is scheduled for this person yet.</span> }</td>
          <td class="py-2.5 text-right whitespace-nowrap">
            @if (ok(p)) { <a class="px-3 py-1.5 rounded-xl text-xs font-black hover:bg-emerald-500/10" [class]="sent('whatsapp', p) ? 'text-slate-400' : 'text-emerald-600'" [href]="wa(p)" target="_blank" rel="noopener" (click)="logMany([p.id], 'whatsapp')">{{ sent('whatsapp', p) ? '✓ ' : '' }}WhatsApp</a>
              <a class="px-3 py-1.5 rounded-xl text-xs font-black hover:bg-indigo-500/10" [class]="sent('sms', p) ? 'text-slate-400' : 'text-indigo-600'" [href]="sm(p)" (click)="logMany([p.id], 'sms')">{{ sent('sms', p) ? '✓ ' : '' }}SMS</a> } @else { <span class="text-[11px] font-bold text-rose-500">Phone number is not valid</span> }
            @if (p.email) { <a class="px-3 py-1.5 rounded-xl text-xs font-black hover:bg-sky-500/10" [class]="sent('email', p) ? 'text-slate-400' : 'text-sky-600'" [href]="em(p)" (click)="logMany([p.id], 'email')">{{ sent('email', p) ? '✓ ' : '' }}Email</a> }</td></tr> }</tbody>
    </table></div>
  </section>
  `
})
export class RecSend {
  private api = inject(Api);
  private toast = inject(ToastService);
  private settings = inject(SettingsService);
  people = input.required<Person[]>();
  initialKind = input<string>('interview');
  closed = output<void>();
  cfg = signal<{ smtp: { ready: boolean }; sms: { ready: boolean } } | null>(null); sending = signal(false); outcome = signal(''); outcomeBad = signal(false);
  withEmail = () => this.people().filter(p => p.email).length;
  withPhone = () => this.people().filter(p => this.ok(p)).length;
  kinds = KINDS;
  kind = signal('interview'); subject = signal(SUBJECT['interview']); tpl = signal(''); error = signal('');
  private templates: Record<string, string> = {};
  private done = signal<Set<string>>(new Set());

  constructor() {
    this.api.get<{ smtp: { ready: boolean }; sms: { ready: boolean } }>('/hr/recruit/notify').subscribe({ next: r => this.cfg.set(r), error: () => { /* the buttons simply stay hidden */ } });
    this.api.get<{ templates: Record<string, string> }>('/hr/recruit/templates').subscribe({
      next: r => { this.templates = r.templates; this.setKind(this.initialKind()); }, error: e => this.error.set(errorText(e))
    });
  }
  setKind(k: string) { this.kind.set(k); this.subject.set(SUBJECT[k] ?? 'Message'); this.tpl.set(this.templates[k] ?? ''); }
  saveDefault() { this.api.put('/hr/recruit/templates', { kind: this.kind(), text: this.tpl() }).subscribe({ next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error') }); }

  text(p: Person, name = p.name) {
    return fillTemplate(this.tpl(), {
      name, post: p.job_title ?? 'the post', college: this.settings.instituteName(), date: p.int_date ? fmtDate(p.int_date) : '(date)', time: timeText(p.int_time ?? null) || '(time)', venue: p.int_venue ?? 'the college',
      salary: p.offer_salary ? money(p.offer_salary) : '(salary)', joining: p.joining_date ? fmtDate(p.joining_date) : '(date)'
    });
  }
  ok = (p: Person) => validPhone(p.phone);
  wa = (p: Person) => waLink(p.phone, this.text(p));
  sm = (p: Person) => smsLink([p.phone], this.text(p));
  em = (p: Person) => mailLink([p.email ?? ''], this.subject(), this.text(p), false);

  sent(ch: string, p: Person) { return this.done().has(ch + p.id); }
  pending(ch: string) { return this.people().filter(p => this.ok(p) && !this.sent(ch, p)).length; }
  next(ch: 'whatsapp' | 'sms') {
    const p = this.people().find(x => this.ok(x) && !this.sent(ch, x)); if (!p) return;
    if (ch === 'whatsapp') window.open(this.wa(p), '_blank', 'noopener'); else window.location.href = this.sm(p);
    this.logMany([p.id], ch);
  }
  /** Sends the filled-in message to every person now, from the server (email) or the SMS phone. */
  sendNow(channel: 'email' | 'sms') {
    const targets = this.people().filter(p => (channel === 'email' ? !!p.email : this.ok(p)));
    if (!targets.length) { this.outcome.set('Nobody here has ' + (channel === 'email' ? 'an email address' : 'a valid phone number') + '.'); this.outcomeBad.set(true); return; }
    if (!confirm(`Send this ${channel === 'email' ? 'email' : 'SMS'} to ${targets.length} ${targets.length === 1 ? 'person' : 'people'} now?`)) return;
    this.sending.set(true); this.outcome.set('Sending…'); this.outcomeBad.set(false);
    this.api.post<{ sent: number; sent_ids: number[]; failed: { name: string; error: string }[] }>('/hr/recruit/messages/send', {
      channel, kind: this.kind(), items: targets.map(p => ({ id: p.id, subject: this.subject(), text: this.text(p) }))
    }).subscribe({
      next: r => {
        this.sending.set(false); this.done.update(s => { const n = new Set(s); for (const id of r.sent_ids) n.add(channel + id); return n; });
        this.outcomeBad.set(r.failed.length > 0);
        this.outcome.set(`${r.sent} sent.` + (r.failed.length ? ` Not sent: ${r.failed.slice(0, 4).map(f => f.name + ' (' + f.error + ')').join(', ')}${r.failed.length > 4 ? '…' : ''}` : ''));
      },
      error: e => { this.sending.set(false); this.outcomeBad.set(true); this.outcome.set(errorText(e)); }
    });
  }
  logMany(ids: number[], channel: string) {
    this.done.update(s => { const n = new Set(s); for (const id of ids) n.add(channel + id); return n; });
    this.api.post('/hr/recruit/messages', { candidate_ids: ids, channel, kind: this.kind(), text: this.tpl() }).subscribe({ error: () => {} });
  }

  /** One email or SMS for everybody is only possible when the text is the same for all. */
  sameText = computed(() => { const t = this.people().map(p => this.text(p, 'Candidate')); return t.length > 1 && t.every(x => x === t[0]); });
  mailChunks = computed(() => {
    const withMail = this.people().filter(p => p.email), out: { href: string; ids: number[] }[] = [];
    for (let i = 0; i < withMail.length; i += CHUNK) {
      const g = withMail.slice(i, i + CHUNK);
      out.push({ href: mailLink(g.map(p => p.email!), this.subject(), this.text(g[0], 'Candidate'), true), ids: g.map(p => p.id) });
    }
    return out;
  });
  smsGroup = computed(() => {
    const g = this.people().filter(p => this.ok(p));
    return g.length > 1 ? { href: smsLink(g.map(p => normPhone(p.phone)), this.text(g[0], 'Candidate')), ids: g.map(p => p.id) } : null;
  });
}
