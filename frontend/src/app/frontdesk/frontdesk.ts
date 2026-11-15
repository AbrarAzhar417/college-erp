import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { StudentPage } from '../core/models';

interface Visitor { id: number; date: string; name: string; phone: string | null; purpose: string; meeting_with: string | null; badge_no: string | null; time_in: string; time_out: string | null }
interface Enquiry { id: number; date: string; child_name: string; parent_name: string; phone: string; grade: number | null; source: string | null; category: string | null; status: string; follow_up: string | null; notes: string }
interface Pass { id: number; date: string; student: string; reg_no: string; grade: number; section: string; reason: string; taken_by: string; relation: string; status: 'pending' | 'approved' | 'rejected'; left_at: string | null }
interface EnqList { summary: Record<string, number>; due: Enquiry[]; items: Enquiry[] }
type Tab = 'visitors' | 'enquiries' | 'passes';
const STATUSES = ['new', 'contacted', 'visited', 'admitted', 'lost'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const PASS_COLOR: Record<string, string> = { pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', rejected: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' };

@Component({
  selector: 'app-frontdesk',
  imports: [FormsModule],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Front Desk</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Who came to school, who asked about admission, and which students left early.</p></div>
    <nav class="flex gap-2 overflow-x-auto" aria-label="Front desk sections">
      @for (t of tabs; track t.key) { <button type="button" (click)="go(t.key)" class="shrink-0 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest border border-slate-200 dark:border-slate-800" [class]="tab() === t.key ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-white dark:bg-slate-900/40 text-slate-500'">{{ t.label }}</button> }
    </nav>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @switch (tab()) {
      @case ('visitors') {
        <form (ngSubmit)="addVisitor()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
          <h3 class="col-span-2 md:col-span-4 font-black">New visitor</h3>
          <div><label class="label" for="v-name">Name</label><input id="v-name" name="name" class="field" required maxlength="80" [(ngModel)]="vf.name"></div>
          <div><label class="label" for="v-phone">Phone</label><input id="v-phone" name="phone" class="field" inputmode="tel" [(ngModel)]="vf.phone"></div>
          <div class="col-span-2"><label class="label" for="v-purpose">Purpose</label><input id="v-purpose" name="purpose" class="field" required maxlength="200" [(ngModel)]="vf.purpose"></div>
          <div><label class="label" for="v-with">Meeting with</label><input id="v-with" name="with" class="field" [(ngModel)]="vf.meeting_with"></div>
          <div><label class="label" for="v-badge">Badge no</label><input id="v-badge" name="badge" class="field" [(ngModel)]="vf.badge_no"></div>
          <div class="col-span-2 flex items-end"><button class="btn-primary" type="submit">Sign in</button></div>
        </form>
        <div class="flex items-center gap-3"><label class="label !mb-0" for="v-date">Day</label><input id="v-date" name="vdate" type="date" class="field !w-auto" [ngModel]="vDate()" (ngModelChange)="vDate.set($event); loadVisitors()"><span class="text-xs font-black text-slate-400">{{ inside() }} still inside</span></div>
        <div class="space-y-2">
          @for (v of visitors(); track v.id) {
            <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
              <span class="font-black min-w-40">{{ v.name }}</span><span class="text-sm font-bold text-slate-500 flex-1 min-w-48">{{ v.purpose }}{{ v.meeting_with ? ' · ' + v.meeting_with : '' }}{{ v.phone ? ' · ' + v.phone : '' }}</span>
              <span class="text-xs font-black text-slate-400">{{ v.time_in }} - {{ v.time_out ?? '...' }}</span>
              @if (!v.time_out) { <button type="button" class="text-xs font-black text-indigo-600" (click)="out(v)">Sign out</button> }
            </div>
          } @empty { <p class="p-8 text-center text-sm font-bold text-slate-400">No visitors on this day.</p> }
        </div>
      }

      @case ('enquiries') {
        @if (enq(); as e) {
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">@for (s of statuses; track s) { <button type="button" (click)="setFilter(s)" class="p-4 rounded-2xl border text-left" [class]="filter() === s ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40'"><div class="text-2xl font-black">{{ e.summary[s] ?? 0 }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">{{ s }}</div></button> }</div>
          @if (e.due.length) {
            <div class="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30"><h4 class="font-black text-amber-700 dark:text-amber-300 mb-2">Call back today or overdue ({{ e.due.length }})</h4>
              @for (d of e.due; track d.id) { <p class="text-sm font-bold py-1">{{ d.parent_name }} ({{ d.child_name }}) · {{ d.phone }} · due {{ d.follow_up }}</p> }</div>
          }
        }
        <form (ngSubmit)="saveEnquiry()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
          <h3 class="col-span-2 md:col-span-4 font-black">{{ ef.id ? 'Change enquiry' : 'New enquiry' }}</h3>
          <div><label class="label" for="q-child">Child name</label><input id="q-child" name="child" class="field" required [(ngModel)]="ef.child_name"></div>
          <div><label class="label" for="q-parent">Parent name</label><input id="q-parent" name="parent" class="field" required [(ngModel)]="ef.parent_name"></div>
          <div><label class="label" for="q-phone">Phone</label><input id="q-phone" name="phone" class="field" required inputmode="tel" [(ngModel)]="ef.phone"></div>
          <div><label class="label" for="q-grade">Class (grade)</label><input id="q-grade" name="grade" type="number" min="1" class="field" [(ngModel)]="ef.grade"></div>
          <div><label class="label" for="q-cat">Category</label><select id="q-cat" name="cat" class="field" [(ngModel)]="ef.category"><option [ngValue]="null">Not known</option><option value="A">A - father in KRL</option><option value="B">B - retired from KRL</option><option value="C">C - private job</option></select></div>
          <div><label class="label" for="q-src">How did they hear</label><input id="q-src" name="src" class="field" [(ngModel)]="ef.source"></div>
          <div><label class="label" for="q-status">Status</label><select id="q-status" name="status" class="field" [(ngModel)]="ef.status">@for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select></div>
          <div><label class="label" for="q-fu">Call back on</label><input id="q-fu" name="fu" type="date" class="field" [(ngModel)]="ef.follow_up"></div>
          <div class="col-span-2 md:col-span-4"><label class="label" for="q-notes">Notes</label><input id="q-notes" name="notes" class="field" maxlength="1000" [(ngModel)]="ef.notes"></div>
          <div class="col-span-2 md:col-span-4 flex gap-3"><button class="btn-primary" type="submit">{{ ef.id ? 'Save' : 'Add enquiry' }}</button>@if (ef.id) { <button type="button" class="btn-ghost" (click)="resetEnq()">Cancel</button> }</div>
        </form>
        <div class="space-y-2">
          @for (q of enq()?.items ?? []; track q.id) {
            @if (!filter() || q.status === filter()) {
              <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                <span class="font-black min-w-40">{{ q.child_name }}</span><span class="text-sm font-bold text-slate-500 flex-1 min-w-48">{{ q.parent_name }} · {{ q.phone }}{{ q.grade ? ' · Class ' + q.grade : '' }}{{ q.category ? ' · Cat ' + q.category : '' }}</span>
                <span class="px-2 py-0.5 rounded-lg text-[11px] font-black bg-slate-100 dark:bg-slate-800">{{ q.status }}</span>
                <button type="button" class="text-xs font-black text-indigo-600" (click)="editEnq(q)">Edit</button>
              </div>
            }
          } @empty { <p class="p-8 text-center text-sm font-bold text-slate-400">No enquiries yet.</p> }
        </div>
      }

      @case ('passes') {
        <form (ngSubmit)="addPass()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
          <h3 class="col-span-2 md:col-span-4 font-black">Early leave request</h3>
          <div class="col-span-2"><label class="label" for="p-find">Find student (name or reg no)</label><input id="p-find" name="find" class="field" [ngModel]="find()" (ngModelChange)="search($event)" autocomplete="off">
            @if (found().length) { <ul class="mt-1 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">@for (s of found(); track s.id) { <li><button type="button" class="w-full text-left px-3 py-2 text-sm font-bold hover:bg-indigo-500/10" (click)="pick(s)">{{ s.name }} · {{ s.reg_no }}</button></li> }</ul> }
            @if (pf.name) { <p class="text-xs font-black text-emerald-600 mt-1">Selected: {{ pf.name }}</p> }</div>
          <div class="col-span-2"><label class="label" for="p-reason">Reason</label><input id="p-reason" name="reason" class="field" required maxlength="200" [(ngModel)]="pf.reason"></div>
          <div><label class="label" for="p-by">Taken by</label><input id="p-by" name="by" class="field" required [(ngModel)]="pf.taken_by"></div>
          <div><label class="label" for="p-rel">Relation</label><input id="p-rel" name="rel" class="field" [(ngModel)]="pf.relation"></div>
          <div class="col-span-2 flex items-end"><button class="btn-primary" type="submit">Request pass</button></div>
        </form>
        <div class="flex items-center gap-3"><label class="label !mb-0" for="g-date">Day</label><input id="g-date" name="gdate" type="date" class="field !w-auto" [ngModel]="gDate()" (ngModelChange)="gDate.set($event); loadPasses()"></div>
        <div class="space-y-2">
          @for (p of passes(); track p.id) {
            <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
              <span class="font-black min-w-44">{{ p.student }} <span class="text-slate-400 text-xs">{{ p.grade }}-{{ p.section }}</span></span>
              <span class="text-sm font-bold text-slate-500 flex-1 min-w-48">{{ p.reason }} · with {{ p.taken_by }}{{ p.relation ? ' (' + p.relation + ')' : '' }}</span>
              <span class="px-2 py-0.5 rounded-lg text-[11px] font-black" [class]="passColor[p.status]">{{ p.left_at ? 'left ' + p.left_at : p.status }}</span>
              @if (p.status === 'pending' && approver()) { <button type="button" class="text-xs font-black text-emerald-600" (click)="decide(p, true)">Approve</button><button type="button" class="text-xs font-black text-rose-500" (click)="decide(p, false)">Reject</button> }
              @if (p.status === 'pending') { <button type="button" class="text-xs font-black text-indigo-600" (click)="editPass(p)">Change</button> }
              @if (approver()) { <button type="button" class="text-xs font-black text-rose-500" (click)="delPass(p)">Delete</button> }
              @if (p.status === 'approved' && !p.left_at) { <button type="button" class="text-xs font-black text-indigo-600" (click)="left(p)">Student left</button> }
            </div>
          } @empty { <p class="p-8 text-center text-sm font-bold text-slate-400">No passes on this day.</p> }
        </div>
      }
    }
  </div>
  `
})
export class Frontdesk {
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  statuses = STATUSES; passColor = PASS_COLOR;
  tabs: { key: Tab; label: string }[] = [{ key: 'visitors', label: 'Visitors' }, { key: 'enquiries', label: 'Admission enquiries' }, { key: 'passes', label: 'Gate passes' }];
  tab = signal<Tab>('visitors'); error = signal('');
  approver = computed(() => this.auth.isLeadership());
  private fail = (e: unknown) => this.toast.show(errorText(e), 'error');

  vDate = signal(today()); visitors = signal<Visitor[]>([]); inside = computed(() => this.visitors().filter(v => !v.time_out).length);
  vf = { name: '', phone: '', purpose: '', meeting_with: '', badge_no: '' };
  enq = signal<EnqList | null>(null); filter = signal(''); ef = this.blankEnq();
  gDate = signal(today()); passes = signal<Pass[]>([]); find = signal(''); found = signal<{ id: number; name: string; reg_no: string }[]>([]);
  pf = { student_id: 0, name: '', reason: '', taken_by: '', relation: '' };

  constructor() { this.loadVisitors(); }
  go(t: Tab) { this.tab.set(t); this.error.set(''); if (t === 'visitors') this.loadVisitors(); if (t === 'enquiries') this.loadEnq(); if (t === 'passes') this.loadPasses(); }

  loadVisitors() { this.api.get<Visitor[]>('/frontdesk/visitors', { date: this.vDate() }).subscribe({ next: r => this.visitors.set(r), error: e => this.error.set(errorText(e)) }); }
  addVisitor() { this.api.post('/frontdesk/visitors', { ...this.vf, date: today() }).subscribe({ next: () => { this.toast.show('Visitor signed in.'); this.vf = { name: '', phone: '', purpose: '', meeting_with: '', badge_no: '' }; this.vDate.set(today()); this.loadVisitors(); }, error: this.fail }); }
  out(v: Visitor) { this.api.put(`/frontdesk/visitors/${v.id}/out`, {}).subscribe({ next: () => this.loadVisitors(), error: this.fail }); }

  private blankEnq(): Partial<Enquiry> & { status: string } { return { child_name: '', parent_name: '', phone: '', grade: null, source: '', category: null, status: 'new', follow_up: '', notes: '' }; }
  loadEnq() { this.api.get<EnqList>('/frontdesk/enquiries').subscribe({ next: r => this.enq.set(r), error: e => this.error.set(errorText(e)) }); }
  setFilter(s: string) { this.filter.set(this.filter() === s ? '' : s); }
  resetEnq() { this.ef = this.blankEnq(); }
  editEnq(q: Enquiry) { this.ef = { ...q, follow_up: q.follow_up ?? '' }; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  saveEnquiry() {
    const b = { ...this.ef, follow_up: this.ef.follow_up || null };
    (this.ef.id ? this.api.put(`/frontdesk/enquiries/${this.ef.id}`, b) : this.api.post('/frontdesk/enquiries', b)).subscribe({ next: () => { this.toast.show('Saved.'); this.resetEnq(); this.loadEnq(); }, error: this.fail });
  }

  loadPasses() { this.api.get<Pass[]>('/frontdesk/passes', { date: this.gDate() }).subscribe({ next: r => this.passes.set(r), error: e => this.error.set(errorText(e)) }); }
  search(q: string) { this.find.set(q); this.pf.student_id = 0; this.pf.name = ''; if (q.trim().length < 2) { this.found.set([]); return; } this.api.get<StudentPage>('/students', { q: q.trim(), limit: 6 }).subscribe({ next: r => this.found.set(r.items), error: this.fail }); }
  pick(s: { id: number; name: string }) { this.pf.student_id = s.id; this.pf.name = s.name; this.found.set([]); this.find.set(s.name); }
  addPass() {
    if (!this.pf.student_id) { this.toast.show('Choose a student from the list first.', 'error'); return; }
    this.api.post('/frontdesk/passes', { ...this.pf, date: today() }).subscribe({ next: () => { this.toast.show('Pass requested.'); this.pf = { student_id: 0, name: '', reason: '', taken_by: '', relation: '' }; this.find.set(''); this.gDate.set(today()); this.loadPasses(); }, error: this.fail });
  }
  decide(p: Pass, approve: boolean) { this.api.put(`/frontdesk/passes/${p.id}/decision`, { approve }).subscribe({ next: () => this.loadPasses(), error: this.fail }); }
  editPass(p: Pass) {
    const reason = prompt('Reason for leaving', p.reason); if (reason === null) return;
    const taken_by = prompt('Who is taking the student', p.taken_by); if (taken_by === null) return;
    this.api.put(`/frontdesk/passes/${p.id}`, { date: p.date, reason, taken_by, relation: p.relation }).subscribe({ next: () => { this.toast.show('Pass changed.'); this.loadPasses(); }, error: this.fail });
  }
  delPass(p: Pass) { if (confirm(`Delete the gate pass of ${p.student}? This is written in the log.`)) this.api.delete(`/frontdesk/passes/${p.id}`).subscribe({ next: () => this.loadPasses(), error: this.fail }); }
  left(p: Pass) { this.api.put(`/frontdesk/passes/${p.id}/left`, {}).subscribe({ next: () => this.loadPasses(), error: this.fail }); }
}
