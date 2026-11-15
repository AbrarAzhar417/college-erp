import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { DOW_LETTER, MySection, SHORT, Stats, cellClass, daysToText, monthLabel, parseDays, pctColor, pctText, today } from './att';

interface Day { date: string; day: number; dow: number; off: boolean; holiday: string | null; working: boolean; future: boolean }
interface Stu { id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; marks: Record<string, string>; stats: Stats; totals: { working_days: number } | null }
interface MonthData { month: string; section: string; workingDays: number; days: Day[]; students: Stu[] }
interface QRow { id: number; absent: string; leave: string; late: string }
interface TRow { id: number; absent: number; leave: number; late: number; hasDaily: boolean }

@Component({
  selector: 'app-att-register',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
      <div><label class="label" for="rm">Month</label><input id="rm" type="month" class="field" [ngModel]="month()" (ngModelChange)="setMonth($event)"></div>
      @if (manager) {
        <div><label class="label" for="rc">Class</label><select id="rc" class="field" [ngModel]="classId()" (ngModelChange)="setClass($event)">@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
        <div><label class="label" for="rs">Section</label><select id="rs" class="field" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">@for (s of sectionOptions(); track s.id) { <option [ngValue]="s.id">Section {{ s.section_name }}</option> }</select></div>
      } @else {
        <div class="col-span-2"><label class="label" for="rs2">My class</label><select id="rs2" class="field" [ngModel]="sectionId()" (ngModelChange)="setSection($event)">@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.class_name }} - Section {{ s.section_name }}</option> }</select></div>
      }
      @if (data()) { <a class="btn-ghost" [routerLink]="['/attendance/register-print']" [queryParams]="{ sectionId: sectionId(), month: month() }">Print register</a> }
    </div>

    <div class="flex flex-wrap gap-2">
      @for (m of modes; track m.key) {
        <button type="button" (click)="setMode(m.key)" class="px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
                [class]="mode() === m.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'">{{ m.label }}</button>
      }
    </div>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (data(); as x) {
      <p class="text-sm font-bold text-slate-400">{{ x.section }} · {{ ml(x.month) }} · {{ x.workingDays }} school days so far (Sundays and holidays are skipped).</p>

      <!-- ============ GRID ============ -->
      @if (mode() === 'grid') {
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="btn-ghost" (click)="fillPresent()">Mark every empty day as present</button>
          @if (edits().size) {
            <button type="button" class="btn-primary" (click)="saveGrid()" [disabled]="busy()">Save {{ edits().size }} change{{ edits().size === 1 ? '' : 's' }}</button>
            <button type="button" class="btn-ghost" (click)="edits.set(emptyMap())">Discard</button>
          }
          <span class="text-xs font-bold text-slate-400">Tap a box to change it, or select it and press P, A, L or T (Delete clears, arrow keys move).</span>
        </div>
        <section class="bg-white dark:bg-slate-900/40 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-x-auto">
          <table class="border-separate border-spacing-0 text-xs" aria-label="Monthly attendance register">
            <thead>
              <tr>
                <th class="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-2 text-left w-10">Roll</th>
                <th class="sticky left-10 z-10 bg-white dark:bg-slate-900 px-3 py-2 text-left min-w-44">Student</th>
                @for (d of x.days; track d.date) {
                  <th class="px-0.5 py-1 text-center min-w-8" [class.opacity-40]="!d.working" [title]="d.holiday ?? ''">
                    <button type="button" class="block w-full text-[10px] font-black text-slate-400 hover:text-indigo-500" [disabled]="!d.working || d.future" (click)="colPresent(d.date)" [attr.aria-label]="'Mark day ' + d.day + ' present for all'">{{ d.day }}<br>{{ letter(d.dow) }}</button>
                  </th>
                }
                <th class="px-2 text-emerald-600">P</th><th class="px-2 text-rose-500">A</th><th class="px-2 text-amber-500">L</th><th class="px-2 text-sky-600">T</th><th class="px-3">%</th>
              </tr>
            </thead>
            <tbody>
              @for (s of x.students; track s.id; let ri = $index) {
                @let st = rowStats(s);
                <tr>
                  <td class="sticky left-0 bg-white dark:bg-slate-900 px-3 py-1 font-black text-slate-400">{{ s.roll_no ?? '-' }}</td>
                  <td class="sticky left-10 bg-white dark:bg-slate-900 px-3 py-1 font-black whitespace-nowrap">{{ s.name }}</td>
                  @for (d of x.days; track d.date; let ci = $index) {
                    <td class="p-0.5">
                      @if (d.working && !d.future) {
                        @let v = eff(s, d.date);
                        <button type="button" [attr.data-cell]="ri + '-' + ci" (click)="cycle(s, d.date)" (keydown)="onKey($event, ri, ci, s, d.date)" [attr.aria-label]="s.name + ' day ' + d.day + ': ' + (v ?? 'empty')"
                                class="w-7 h-7 rounded-lg font-black transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500" [class]="cls(v)" [class.ring-2]="edits().has(s.id + '|' + d.date)" [class.ring-indigo-400]="edits().has(s.id + '|' + d.date)">{{ short(v) }}</button>
                      } @else { <div class="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-black bg-slate-100 dark:bg-slate-800/40 text-slate-400" [title]="d.holiday ?? ''">{{ d.holiday ? 'H' : d.off ? '' : '·' }}</div> }
                    </td>
                  }
                  <td class="px-2 text-center font-black text-emerald-600">{{ st.present }}</td><td class="px-2 text-center font-black text-rose-500">{{ st.absent }}</td>
                  <td class="px-2 text-center font-black text-amber-500">{{ st.leave }}</td><td class="px-2 text-center font-black text-sky-600">{{ st.late }}</td>
                  <td class="px-3 text-center font-black" [class]="pc(st.pct)">{{ pt(st.pct) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      <!-- ============ QUICK ENTRY ============ -->
      @if (mode() === 'quick') {
        <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
          <div>
            <h3 class="text-xl font-black tracking-tight">Quick entry from the paper register</h3>
            <p class="text-sm font-bold text-slate-500 mt-2">For each student type only the <b>absent</b>, <b>leave</b> and <b>late</b> dates, like <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">3, 7, 12-14</span>. Every other school day is marked present automatically.</p>
            <p class="text-xs font-bold text-slate-400 mt-2">School days counted: {{ workingNumbers().join(' ') || 'none yet' }}</p>
          </div>
          <div class="space-y-2">
            @for (q of qrows(); track q.id; let i = $index) {
              @let p = qPreview(q);
              <div class="grid grid-cols-12 gap-3 items-start p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
                <div class="col-span-12 md:col-span-3"><p class="text-sm font-black">{{ nameOf(q.id) }}</p><p class="text-[11px] font-bold text-slate-400">Roll {{ rollOf(q.id) ?? '-' }}</p></div>
                <input class="field col-span-4 md:col-span-2 !py-2.5 !text-xs" placeholder="Absent days" [attr.aria-label]="'Absent days of ' + nameOf(q.id)" [ngModel]="q.absent" (ngModelChange)="setQ(i, 'absent', $event)">
                <input class="field col-span-4 md:col-span-2 !py-2.5 !text-xs" placeholder="Leave days" [attr.aria-label]="'Leave days of ' + nameOf(q.id)" [ngModel]="q.leave" (ngModelChange)="setQ(i, 'leave', $event)">
                <input class="field col-span-4 md:col-span-2 !py-2.5 !text-xs" placeholder="Late days" [attr.aria-label]="'Late days of ' + nameOf(q.id)" [ngModel]="q.late" (ngModelChange)="setQ(i, 'late', $event)">
                <p class="col-span-12 md:col-span-3 text-xs font-black pt-2.5" [class]="p.problem ? 'text-rose-500' : 'text-slate-500'">
                  @if (p.problem) { {{ p.problem }} } @else { <span class="text-emerald-600">{{ p.present }} present</span> · <span class="text-rose-500">{{ p.absent }} absent</span> · <span class="text-amber-500">{{ p.leave }} leave</span> · <span class="text-sky-600">{{ p.late }} late</span> }
                </p>
              </div>
            }
          </div>
          <button type="button" class="btn-primary" (click)="saveQuick()" [disabled]="busy() || !workingNumbers().length">Save the whole section</button>
        </section>
      }

      <!-- ============ TOTALS ONLY ============ -->
      @if (mode() === 'totals') {
        <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
          <div>
            <h3 class="text-xl font-black tracking-tight">Month totals only</h3>
            <p class="text-sm font-bold text-slate-500 mt-2">Use this when you only have the totals from the register and not the dates. Type absent, leave and late days per student. Present is worked out for you.</p>
          </div>
          <div class="max-w-xs"><label class="label" for="twd">Working days in the register</label><input id="twd" type="number" min="1" max="31" class="field" [ngModel]="twd()" (ngModelChange)="twd.set($event)"></div>
          <div class="space-y-2">
            @for (t of trows(); track t.id; let i = $index) {
              <div class="grid grid-cols-12 gap-3 items-center p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
                <div class="col-span-12 md:col-span-4"><p class="text-sm font-black">{{ nameOf(t.id) }}</p><p class="text-[11px] font-bold text-slate-400">Roll {{ rollOf(t.id) ?? '-' }}{{ t.hasDaily ? ' · has day by day records, they are used instead' : '' }}</p></div>
                <div class="col-span-3 md:col-span-2"><label class="label !ml-0" [for]="'ta' + i">Absent</label><input [id]="'ta' + i" type="number" min="0" class="field !py-2.5" [ngModel]="t.absent" (ngModelChange)="setT(i, 'absent', $event)"></div>
                <div class="col-span-3 md:col-span-2"><label class="label !ml-0" [for]="'tl' + i">Leave</label><input [id]="'tl' + i" type="number" min="0" class="field !py-2.5" [ngModel]="t.leave" (ngModelChange)="setT(i, 'leave', $event)"></div>
                <div class="col-span-3 md:col-span-2"><label class="label !ml-0" [for]="'tt' + i">Late</label><input [id]="'tt' + i" type="number" min="0" class="field !py-2.5" [ngModel]="t.late" (ngModelChange)="setT(i, 'late', $event)"></div>
                <p class="col-span-3 md:col-span-2 text-center"><span class="block text-[11px] font-black text-slate-400 uppercase">Present</span><span class="text-lg font-black" [class]="presentOf(t) < 0 ? 'text-rose-500' : 'text-emerald-600'">{{ presentOf(t) }}</span></p>
              </div>
            }
          </div>
          <button type="button" class="btn-primary" (click)="saveTotals()" [disabled]="busy()">Save totals</button>
        </section>
      }
    }
  </div>
  `
})
export class AttRegister {
  private api = inject(Api);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  manager = this.auth.canWriteStudents();
  ml = monthLabel; letter = (n: number) => DOW_LETTER[n]; short = (s: string | null) => (s ? SHORT[s] : ''); cls = (s: string | null) => cellClass(s);
  modes = [{ key: 'grid', label: 'Register grid' }, { key: 'quick', label: 'Quick entry' }, { key: 'totals', label: 'Totals only' }] as const;
  pt = pctText; pc = (p: number | null) => pctColor(p, this.low);
  low = 75;

  month = signal(today().slice(0, 7));
  sections = signal<MySection[]>([]);
  classId = signal<number | null>(null); sectionId = signal<number | null>(null);
  mode = signal<'grid' | 'quick' | 'totals'>('grid');
  data = signal<MonthData | null>(null);
  edits = signal<Map<string, string | null>>(new Map());
  qrows = signal<QRow[]>([]); trows = signal<TRow[]>([]); twd = signal(0);
  busy = signal(false); error = signal('');
  emptyMap = () => new Map<string, string | null>();

  classes = computed(() => { const m = new Map<number, { id: number; name: string }>(); for (const s of this.sections()) m.set(s.class_id, { id: s.class_id, name: s.class_name }); return [...m.values()]; });
  sectionOptions = computed(() => this.sections().filter(s => s.class_id === this.classId()));
  workingNumbers = computed(() => (this.data()?.days ?? []).filter(d => d.working && !d.future).map(d => d.day));

  constructor() {
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    if (qp.get('month')) this.month.set(qp.get('month')!);
    this.api.get<{ low_pct: number }>('/attendance/config').subscribe(c => this.low = c.low_pct);
    this.api.get<MySection[]>('/attendance/my-sections').subscribe({
      next: list => {
        this.sections.set(list);
        const pick = list.find(s => s.id === Number(qp.get('sectionId'))) ?? list[0];
        if (pick) { this.classId.set(pick.class_id); this.sectionId.set(pick.id); this.load(); }
      },
      error: e => this.error.set(errorText(e))
    });
  }

  setMonth(v: string) { if (v) { this.month.set(v); this.load(); } }
  setClass(id: number) { this.classId.set(id); this.sectionId.set(this.sections().find(s => s.class_id === id)?.id ?? null); this.load(); }
  setSection(id: number) { this.sectionId.set(id); this.load(); }
  setMode(m: 'grid' | 'quick' | 'totals') { this.mode.set(m); this.buildForms(); }

  load() {
    const id = this.sectionId(); if (!id) return;
    if (this.edits().size && !confirm('You have unsaved changes. Leave them?')) return;
    this.error.set(''); this.edits.set(this.emptyMap());
    this.api.get<MonthData>('/attendance/month', { sectionId: id, month: this.month() }).subscribe({
      next: d => { this.data.set(d); this.buildForms(); },
      error: e => { this.data.set(null); this.error.set(errorText(e)); }
    });
  }

  private buildForms() {
    const x = this.data(); if (!x) return;
    this.qrows.set(x.students.map(s => {
      const pick = (st: string) => daysToText(x.days.filter(d => s.marks[d.date] === st).map(d => d.day));
      return { id: s.id, absent: pick('A'), leave: pick('L'), late: pick('LT') };
    }));
    this.twd.set(x.students.find(s => s.totals)?.totals?.working_days ?? x.workingDays);
    this.trows.set(x.students.map(s => ({ id: s.id, absent: s.stats.absent, leave: s.stats.leave, late: s.stats.late, hasDaily: s.stats.source === 'daily' })));
  }

  // ---- grid ----
  eff(s: Stu, date: string): string | null { const k = `${s.id}|${date}`; return this.edits().has(k) ? this.edits().get(k)! : (s.marks[date] ?? null); }
  private setCell(s: Stu, date: string, v: string | null) {
    const m = new Map(this.edits()), k = `${s.id}|${date}`, orig = s.marks[date] ?? null;
    if (v === orig) m.delete(k); else m.set(k, v);
    this.edits.set(m);
  }
  cycle(s: Stu, date: string) { const c = this.eff(s, date); this.setCell(s, date, c === null ? 'P' : c === 'P' ? 'A' : c === 'A' ? 'L' : c === 'L' ? 'LT' : 'P'); }
  onKey(ev: KeyboardEvent, ri: number, ci: number, s: Stu, date: string) {
    const k = ev.key.toLowerCase();
    const map: Record<string, string | null> = { p: 'P', a: 'A', l: 'L', t: 'LT', delete: null, backspace: null };
    if (k in map) { ev.preventDefault(); this.setCell(s, date, map[k]); return; }
    const move: Record<string, [number, number]> = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: [-1, 0], arrowdown: [1, 0] };
    if (k in move) {
      ev.preventDefault();
      let r = ri + move[k][0], c = ci + move[k][1];
      for (let n = 0; n < 40; n++) { const el = document.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`); if (el) { el.focus(); return; } if (move[k][1] === 0) return; c += move[k][1]; }
    }
  }
  colPresent(date: string) { for (const s of this.data()!.students) if (this.eff(s, date) === null) this.setCell(s, date, 'P'); }
  fillPresent() { for (const d of this.data()!.days) if (d.working && !d.future) this.colPresent(d.date); }
  rowStats(s: Stu) {
    const x = this.data()!; let present = 0, absent = 0, leave = 0, late = 0;
    for (const d of x.days) { if (!d.working || d.future) continue; const v = this.eff(s, d.date); if (v === 'P') present++; else if (v === 'A') absent++; else if (v === 'L') leave++; else if (v === 'LT') late++; }
    const rec = present + absent + leave + late;
    return { present, absent, leave, late, pct: rec ? Math.round(((present + late) / rec) * 1000) / 10 : null };
  }
  saveGrid() {
    const changes = [...this.edits()].map(([k, status]) => { const [sid, date] = k.split('|'); return { student_id: Number(sid), date, status }; });
    this.busy.set(true);
    this.api.post<{ changed: number }>('/attendance/month/cells', { section_id: this.sectionId(), month: this.month(), changes }).subscribe({
      next: r => { this.busy.set(false); this.edits.set(this.emptyMap()); this.toast.show(`${r.changed} changes saved.`); this.load(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }

  // ---- quick entry ----
  nameOf(id: number) { return this.data()?.students.find(s => s.id === id)?.name ?? ''; }
  rollOf(id: number) { return this.data()?.students.find(s => s.id === id)?.roll_no ?? null; }
  setQ(i: number, k: 'absent' | 'leave' | 'late', v: string) { this.qrows.set(this.qrows().map((q, x) => (x === i ? { ...q, [k]: v } : q))); }
  private parseQ(q: QRow) {
    const wd = new Set(this.workingNumbers());
    const a = parseDays(q.absent), l = parseDays(q.leave), t = parseDays(q.late);
    const A = new Set(a.days.filter(d => wd.has(d))), L = new Set(l.days.filter(d => wd.has(d) && !A.has(d))), T = new Set(t.days.filter(d => wd.has(d) && !A.has(d) && !L.has(d)));
    const off = [...a.days, ...l.days, ...t.days].filter(d => !wd.has(d));
    return { A, L, T, bad: [...a.bad, ...l.bad, ...t.bad], off };
  }
  qPreview(q: QRow) {
    const p = this.parseQ(q), n = this.workingNumbers().length;
    const problem = p.bad.length ? `Cannot read: ${p.bad.join(', ')}` : p.off.length ? `Not school days: ${[...new Set(p.off)].join(', ')}` : '';
    return { problem, absent: p.A.size, leave: p.L.size, late: p.T.size, present: n - p.A.size - p.L.size - p.T.size };
  }
  saveQuick() {
    const rows = this.qrows(), bad = rows.find(q => this.qPreview(q).problem);
    if (bad) { this.toast.show(`${this.nameOf(bad.id)}: ${this.qPreview(bad).problem}`, 'error'); return; }
    if (!confirm(`Save attendance for ${rows.length} students? It replaces everything already marked for this month in this section.`)) return;
    this.busy.set(true);
    this.api.post<{ students: number; days: number }>('/attendance/month/quick', {
      section_id: this.sectionId(), month: this.month(),
      rows: rows.map(q => { const p = this.parseQ(q); return { student_id: q.id, absent: [...p.A], leave: [...p.L], late: [...p.T] }; })
    }).subscribe({
      next: r => { this.busy.set(false); this.toast.show(`Saved ${r.students} students for ${r.days} school days.`); this.setMode('grid'); this.load(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }

  // ---- totals only ----
  setT(i: number, k: 'absent' | 'leave' | 'late', v: number) { this.trows.set(this.trows().map((t, x) => (x === i ? { ...t, [k]: Math.max(0, Math.floor(Number(v) || 0)) } : t))); }
  presentOf(t: TRow) { return Number(this.twd()) - t.absent - t.leave - t.late; }
  saveTotals() {
    const wd = Number(this.twd());
    if (!(wd >= 1 && wd <= 31)) { this.toast.show('Enter the working days (1 to 31).', 'error'); return; }
    const neg = this.trows().find(t => this.presentOf(t) < 0);
    if (neg) { this.toast.show(`${this.nameOf(neg.id)}: absent + leave + late is more than the working days.`, 'error'); return; }
    this.busy.set(true);
    this.api.post<{ saved: number }>('/attendance/month/totals', {
      section_id: this.sectionId(), month: this.month(),
      rows: this.trows().map(t => ({ student_id: t.id, working_days: wd, present: this.presentOf(t), absent: t.absent, leave: t.leave, late: t.late }))
    }).subscribe({
      next: r => { this.busy.set(false); this.toast.show(`Totals saved for ${r.saved} students.`); this.load(); },
      error: e => { this.busy.set(false); this.toast.show(errorText(e), 'error'); }
    });
  }
}
