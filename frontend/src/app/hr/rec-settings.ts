import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';

interface Smtp { host: string; port: number; secure: 'ssl' | 'starttls' | 'none'; user: string; pass: string; from_name: string; from_email: string; pass_set?: boolean; ready?: boolean }
interface Sms { url: string; user: string; pass: string; path: string; pass_set?: boolean; ready?: boolean }

@Component({
  selector: 'app-rec-settings',
  imports: [FormsModule],
  template: `
  <div class="space-y-6">
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div class="flex items-center justify-between gap-3"><h3 class="text-lg font-black tracking-tight">Email (sent from the system)</h3>
        <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="smtp.ready ? 'bg-emerald-500/15 text-emerald-700' : 'bg-slate-500/10 text-slate-500'">{{ smtp.ready ? 'Ready' : 'Not set up' }}</span></div>
      <form (ngSubmit)="saveSmtp()" class="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div class="col-span-2"><label class="label" for="eh">Mail server</label><input id="eh" name="eh" class="field" placeholder="smtp.gmail.com" [(ngModel)]="smtp.host"></div>
        <div><label class="label" for="ep">Port</label><input id="ep" name="ep" type="number" class="field" [(ngModel)]="smtp.port"></div>
        <div><label class="label" for="es">Security</label><select id="es" name="es" class="field" [(ngModel)]="smtp.secure"><option value="ssl">SSL (port 465)</option><option value="starttls">STARTTLS (port 587)</option><option value="none">None (local server only)</option></select></div>
        <div class="col-span-2"><label class="label" for="eu">Email address (user name)</label><input id="eu" name="eu" class="field" placeholder="college@gmail.com" autocomplete="off" [(ngModel)]="smtp.user"></div>
        <div class="col-span-2"><label class="label" for="ew">App password {{ smtp.pass_set ? '(saved - leave empty to keep it)' : '' }}</label><input id="ew" name="ew" type="password" class="field" autocomplete="new-password" [(ngModel)]="smtp.pass"></div>
        <div class="col-span-2"><label class="label" for="en">Sender name</label><input id="en" name="en" class="field" placeholder="Our College HR" [(ngModel)]="smtp.from_name"></div>
        <div class="col-span-2"><label class="label" for="ef">Sender email (if different)</label><input id="ef" name="ef" class="field" [(ngModel)]="smtp.from_email"></div>
        <button class="btn-primary col-span-2 md:col-span-1" type="submit">Save</button>
      </form>
      <div class="flex flex-wrap items-end gap-3"><div><label class="label" for="et">Send a test email to</label><input id="et" class="field" type="email" placeholder="your@email.com" [(ngModel)]="testMail"></div><button type="button" class="btn-ghost" [disabled]="!testMail" (click)="test('email', testMail)">Send test email</button></div>
      <p class="text-xs font-bold text-slate-400">Gmail: turn on 2-step verification, then make an "App password" (Google Account, Security) and paste it above. Use smtp.gmail.com, SSL, port 465. Your normal Gmail password will not work.</p>
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
      <div class="flex items-center justify-between gap-3"><h3 class="text-lg font-black tracking-tight">SMS (through an Android phone)</h3>
        <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="sms.ready ? 'bg-emerald-500/15 text-emerald-700' : 'bg-slate-500/10 text-slate-500'">{{ sms.ready ? 'Ready' : 'Not set up' }}</span></div>
      <form (ngSubmit)="saveSms()" class="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div class="col-span-2"><label class="label" for="sa">Phone address</label><input id="sa" name="sa" class="field" placeholder="http://192.168.1.50:8080" [(ngModel)]="sms.url"></div>
        <div><label class="label" for="sp">Path</label><input id="sp" name="sp" class="field" placeholder="/message" [(ngModel)]="sms.path"></div>
        <div></div>
        <div><label class="label" for="su">User name</label><input id="su" name="su" class="field" autocomplete="off" [(ngModel)]="sms.user"></div>
        <div><label class="label" for="sw">Password {{ sms.pass_set ? '(saved)' : '' }}</label><input id="sw" name="sw" type="password" class="field" autocomplete="new-password" [(ngModel)]="sms.pass"></div>
        <button class="btn-primary" type="submit">Save</button>
      </form>
      <div class="flex flex-wrap items-end gap-3"><div><label class="label" for="st">Send a test SMS to</label><input id="st" class="field" placeholder="0300 1234567" [(ngModel)]="testSms"></div><button type="button" class="btn-ghost" [disabled]="!testSms" (click)="test('sms', testSms)">Send test SMS</button></div>
      <p class="text-xs font-bold text-slate-400">Put a SIM with an SMS bundle in an Android phone, connect it to the same WiFi as the computer that runs this system, install the free "SMS Gateway for Android" app, start its local server, and type the address, user name and password it shows. The messages leave from that SIM. Internet is not needed.</p>
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
      <h3 class="text-lg font-black tracking-tight">WhatsApp</h3>
      <p class="text-sm font-bold text-slate-500">WhatsApp does not allow a free program to send messages by itself. Every chat opens with the message ready and you press Send. "WhatsApp: next" opens the chats one after another.</p>
    </section>

    <div class="grid md:grid-cols-2 gap-6">
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
        <h3 class="text-lg font-black tracking-tight">Interview marking points</h3>
        <label class="label" for="ic">One point per line</label><textarea id="ic" rows="5" class="field" [(ngModel)]="crit"></textarea>
        <div><label class="label" for="im">Marks for each point</label><input id="im" type="number" min="1" max="100" class="field" [(ngModel)]="critMax"></div>
        <button type="button" class="btn-primary" (click)="saveCrit()">Save</button>
        <p class="text-xs font-bold text-slate-400">Each panel member fills one sheet; the average of all sheets becomes the interview score out of 100.</p>
      </section>
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
        <h3 class="text-lg font-black tracking-tight">Papers a new staff member must bring</h3>
        <label class="label" for="ck">One item per line</label><textarea id="ck" rows="7" class="field" [(ngModel)]="checks"></textarea>
        <button type="button" class="btn-primary" (click)="saveChecks()">Save</button>
      </section>
    </div>
  </div>
  `
})
export class RecSettings {
  private api = inject(Api);
  private toast = inject(ToastService);
  smtp: Smtp = { host: '', port: 465, secure: 'ssl', user: '', pass: '', from_name: '', from_email: '' };
  sms: Sms = { url: '', user: '', pass: '', path: '/message' };
  testMail = ''; testSms = ''; crit = ''; critMax = 10; checks = ''; error = signal('');
  constructor() {
    this.load();
    this.api.get<{ criteria: string[]; max: number }>('/hr/recruit/interview-criteria').subscribe({ next: r => { this.crit = r.criteria.join('\n'); this.critMax = r.max; }, error: e => this.error.set(errorText(e)) });
    this.api.get<string[]>('/hr/recruit/checklist-items').subscribe({ next: r => (this.checks = r.join('\n')), error: e => this.error.set(errorText(e)) });
  }
  load() { this.api.get<{ smtp: Smtp; sms: Sms }>('/hr/recruit/notify').subscribe({ next: r => { this.smtp = r.smtp; this.sms = r.sms; }, error: e => this.error.set(errorText(e)) }); }
  private ok = (msg: string) => ({ next: () => { this.toast.show(msg); this.load(); }, error: (e: unknown) => this.toast.show(errorText(e), 'error') });
  saveSmtp() { this.api.put('/hr/recruit/notify', { smtp: this.smtp }).subscribe(this.ok('Email settings saved.')); }
  saveSms() { this.api.put('/hr/recruit/notify', { sms: this.sms }).subscribe(this.ok('SMS settings saved.')); }
  test(channel: 'email' | 'sms', to: string) { this.api.post('/hr/recruit/notify/test', { channel, to }).subscribe({ next: () => this.toast.show('Test sent. Check the ' + (channel === 'email' ? 'inbox' : 'phone') + '.'), error: e => this.toast.show(errorText(e), 'error') }); }
  saveCrit() { this.api.put('/hr/recruit/interview-criteria', { criteria: this.crit.split('\n'), max: this.critMax }).subscribe({ next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error') }); }
  saveChecks() { this.api.put('/hr/recruit/checklist-items', { items: this.checks.split('\n') }).subscribe({ next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error') }); }
}
