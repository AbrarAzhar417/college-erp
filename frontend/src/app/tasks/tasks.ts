import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';

interface Task { id: number; title: string; description: string; assigned_to: number; assigned_by: number; assignee: string; assigner: string; priority: 'low' | 'normal' | 'high'; due_date: string | null; status: 'open' | 'in_progress' | 'done' | 'cancelled'; overdue: boolean; can_edit: boolean; mine: boolean }
interface Detail extends Task { events: { id: number; kind: string; text: string; user_name: string; created_at: string }[] }
interface Person { id: number; name: string; role: string }
interface Load { id: number; name: string; role: string; open: number; overdue: number; done: number }
interface Sum { open: number; overdue: number; dueToday: number; done: number }
type Scope = 'mine' | 'assigned' | 'all' | 'load';
const STATUS_LABEL: Record<string, string> = { open: 'To do', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };
const PRIO_COLOR: Record<string, string> = { high: 'bg-rose-500/15 text-rose-600', normal: 'bg-slate-500/10 text-slate-500', low: 'bg-sky-500/10 text-sky-600' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

@Component({
  selector: 'app-tasks',
  imports: [FormsModule],
  template: `
  <div class="max-w-5xl mx-auto pb-16 space-y-6">
    <div><h2 class="text-3xl font-black tracking-tighter">Tasks</h2><p class="text-sm font-bold text-slate-400 mt-2">Give work to staff, see what is late, and follow it up until it is done.</p></div>
    @if (sum(); as s) { <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ s.open }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">My open</div></div>
      <div class="p-4 rounded-2xl" [class]="s.overdue ? 'bg-rose-500/10' : 'bg-slate-500/5'"><div class="text-2xl font-black" [class.text-rose-600]="s.overdue">{{ s.overdue }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Overdue</div></div>
      <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ s.dueToday }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Due today</div></div>
      <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ s.done }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Done</div></div></div> }
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <form (ngSubmit)="create()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4">
      <h3 class="col-span-2 md:col-span-4 font-black">{{ office() ? 'Give a task' : 'Add a task for myself' }}</h3>
      <div class="col-span-2"><label class="label" for="t-title">What has to be done</label><input id="t-title" name="title" class="field" required maxlength="150" [(ngModel)]="nf.title"></div>
      @if (office()) { <div><label class="label" for="t-who">Give to</label><select id="t-who" name="who" class="field" [(ngModel)]="nf.assigned_to">@for (p of people(); track p.id) { <option [ngValue]="p.id">{{ p.name }} ({{ p.role }})</option> }</select></div> }
      <div><label class="label" for="t-due">Due date</label><input id="t-due" name="due" type="date" class="field" [min]="todayStr" [(ngModel)]="nf.due_date"></div>
      <div><label class="label" for="t-pri">Priority</label><select id="t-pri" name="pri" class="field" [(ngModel)]="nf.priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></div>
      <div class="col-span-2 md:col-span-3"><label class="label" for="t-desc">Details (optional)</label><input id="t-desc" name="desc" class="field" maxlength="2000" [(ngModel)]="nf.description"></div>
      <div class="col-span-2 md:col-span-4"><button class="btn-primary" type="submit">Add task</button></div>
    </form>

    <nav class="flex flex-wrap gap-2" aria-label="Task lists">
      @for (t of tabs(); track t.key) { <button type="button" (click)="go(t.key)" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest border border-slate-200 dark:border-slate-800" [class]="scope() === t.key ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900/40 text-slate-500'">{{ t.label }}</button> }
      @if (scope() !== 'load') { <select class="field !w-auto" aria-label="Status filter" [ngModel]="status()" (ngModelChange)="status.set($event); load()" name="st"><option value="active">Open and in progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option><option value="">Everything</option></select> }
    </nav>

    @if (scope() === 'load') {
      <div class="space-y-2">@for (w of workload(); track w.id) { <div class="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800"><span class="font-black flex-1 min-w-40">{{ w.name }} <span class="text-xs text-slate-400">({{ w.role }})</span></span><span class="text-sm font-bold">{{ w.open }} open</span><span class="text-sm font-bold" [class.text-rose-600]="w.overdue">{{ w.overdue }} overdue</span><span class="text-sm font-bold text-emerald-600">{{ w.done }} done</span></div> }</div>
    } @else {
      <div class="space-y-3">
        @for (t of tasks(); track t.id) {
          <article class="bg-white dark:bg-slate-900/40 rounded-[1.5rem] border overflow-hidden" [class]="t.overdue ? 'border-rose-500/50' : 'border-slate-200 dark:border-slate-800'">
            <button type="button" class="w-full flex flex-wrap items-center gap-3 p-4 text-left" (click)="open(t)" [attr.aria-expanded]="detail()?.id === t.id">
              <span class="font-black flex-1 min-w-48" [class.line-through]="t.status === 'done' || t.status === 'cancelled'">{{ t.title }}</span>
              <span class="px-2 py-0.5 rounded-lg text-[11px] font-black" [class]="prio[t.priority]">{{ t.priority }}</span>
              <span class="text-xs font-bold text-slate-400">{{ scope() === 'mine' ? 'from ' + t.assigner : 'to ' + t.assignee }}</span>
              @if (t.due_date) { <span class="text-xs font-black" [class]="t.overdue ? 'text-rose-600' : 'text-slate-400'">{{ t.overdue ? 'Overdue · ' : 'Due ' }}{{ t.due_date }}</span> }
              <span class="text-[11px] font-black uppercase tracking-widest text-indigo-600">{{ label[t.status] }}</span>
            </button>
            @if (detail(); as d) { @if (d.id === t.id) {
              <div class="p-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                @if (d.description) { <p class="text-sm whitespace-pre-line">{{ d.description }}</p> }
                <div class="flex flex-wrap gap-2">
                  @if (d.status === 'open') { <button type="button" class="btn-ghost" (click)="set(d, 'in_progress')">Start</button> }
                  @if (d.status === 'open' || d.status === 'in_progress') { <button type="button" class="btn-primary" (click)="set(d, 'done')">Mark done</button> }
                  @if (d.can_edit && (d.status === 'open' || d.status === 'in_progress')) { <button type="button" class="btn-ghost" (click)="set(d, 'cancelled')">Cancel task</button> }
                  @if (d.can_edit && (d.status === 'done' || d.status === 'cancelled')) { <button type="button" class="btn-ghost" (click)="set(d, 'open')">Reopen</button> }
                  @if (d.can_edit) { <button type="button" class="text-xs font-black text-rose-500" (click)="remove(d)">Delete</button> }
                </div>
                <ul class="space-y-1">@for (e of d.events; track e.id) { <li class="text-xs font-bold" [class]="e.kind === 'comment' ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'"><span class="text-slate-400">{{ e.created_at.slice(0, 16) }}</span> · {{ e.user_name }}: {{ e.text }}</li> }</ul>
                <form (ngSubmit)="comment(d)" class="flex gap-2"><label class="sr-only" for="t-com">Comment</label><input id="t-com" name="com" class="field flex-1" maxlength="1000" placeholder="Write an update or question" [(ngModel)]="com"><button class="btn-ghost" type="submit">Send</button></form>
              </div>
            } }
          </article>
        } @empty { <p class="p-10 text-center text-sm font-bold text-slate-400">No tasks here.</p> }
      </div>
    }
  </div>
  `
})
export class Tasks {
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  label = STATUS_LABEL; prio = PRIO_COLOR; todayStr = today();
  office = computed(() => this.auth.canWriteStudents());
  tabs = computed(() => { const t: { key: Scope; label: string }[] = [{ key: 'mine', label: 'My tasks' }, { key: 'assigned', label: 'Given by me' }]; return this.office() ? [...t, { key: 'all' as Scope, label: 'Everyone' }, { key: 'load' as Scope, label: 'Workload' }] : t; });
  scope = signal<Scope>('mine'); status = signal('active'); tasks = signal<Task[]>([]); detail = signal<Detail | null>(null); sum = signal<Sum | null>(null);
  people = signal<Person[]>([]); workload = signal<Load[]>([]); error = signal(''); com = '';
  nf: { title: string; description: string; assigned_to: number; due_date: string; priority: string } = { title: '', description: '', assigned_to: this.auth.user()?.id ?? 0, due_date: '', priority: 'normal' };
  private fail = (e: unknown) => this.toast.show(errorText(e), 'error');
  constructor() { this.api.get<Person[]>('/tasks/people').subscribe({ next: p => { this.people.set(p); if (!p.some(x => x.id === this.nf.assigned_to) && p[0]) this.nf.assigned_to = p[0].id; } }); this.reload(); }
  reload() { this.load(); this.api.get<Sum>('/tasks/summary').subscribe({ next: s => this.sum.set(s) }); }
  go(s: Scope) { this.scope.set(s); this.detail.set(null); this.load(); }
  load() {
    if (this.scope() === 'load') { this.api.get<Load[]>('/tasks/workload').subscribe({ next: r => this.workload.set(r), error: e => this.error.set(errorText(e)) }); return; }
    this.api.get<Task[]>('/tasks', { scope: this.scope(), status: this.status() }).subscribe({ next: r => this.tasks.set(r), error: e => this.error.set(errorText(e)) });
  }
  open(t: Task) { if (this.detail()?.id === t.id) { this.detail.set(null); return; } this.api.get<Detail>(`/tasks/${t.id}`).subscribe({ next: d => this.detail.set(d), error: this.fail }); }
  private refresh(id: number) { this.reload(); this.api.get<Detail>(`/tasks/${id}`).subscribe({ next: d => this.detail.set(d), error: () => this.detail.set(null) }); }
  create() {
    this.api.post('/tasks', { ...this.nf, due_date: this.nf.due_date || null }).subscribe({ next: () => { this.toast.show('Task added.'); this.nf = { ...this.nf, title: '', description: '', due_date: '' }; this.reload(); }, error: this.fail });
  }
  set(d: Detail, status: string) {
    const note = status === 'done' ? (prompt('A short note (optional)') ?? '') : '';
    this.api.put(`/tasks/${d.id}/status`, { status, note }).subscribe({ next: () => this.refresh(d.id), error: this.fail });
  }
  comment(d: Detail) { if (!this.com.trim()) return; this.api.post(`/tasks/${d.id}/comments`, { text: this.com }).subscribe({ next: () => { this.com = ''; this.refresh(d.id); }, error: this.fail }); }
  remove(d: Detail) { if (confirm('Delete this task and its history?')) this.api.delete(`/tasks/${d.id}`).subscribe({ next: () => { this.detail.set(null); this.reload(); }, error: this.fail }); }
}
