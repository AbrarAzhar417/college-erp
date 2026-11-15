import { avatarOf } from '../core/avatar';
import { StudentAvatar } from './student-avatar';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { Student } from '../core/models';
import { ExamResult, StudentResults, allSubjects, catClass, deltaText, markText, ordinal, pctClass, resultClass } from '../exam/exam';
import { fmtDate } from '../fee/fee';
import { initials } from '../hr/hr';
import { Sibling } from './students';
import { ToastService } from '../core/toast';
import { HttpClient } from '@angular/common/http';
import { DisciplinePanel } from '../discipline/discipline-panel';

interface DocList { category: string | null; missing: string[]; unverified: string[]; list: { key: string; label: string; uploaded: boolean; verified: boolean; files: { id: number; filename: string; size: number; verified: number }[] }[] }

type FamilyMember = Omit<Sibling, 'photo'> & { family_id: number | null };
interface Family { family_id: number | null; order: number; linked: FamilyMember[]; strong: FamilyMember[]; possible: (FamilyMember & { similarity: number })[] }

type Tab = 'overview' | 'results' | 'analysis' | 'behaviour';
type Full = Student & { class_teacher: string | null; bus_route: string | null; status: string };
interface Pt { x: number; y: number; ya: number; label: string; pct: number | null }

const W = 640, H = 220, PX = 36, PY = 16;
const KIND_LABEL: Record<string, string> = { test: 'Test', terminal: 'Terminal', sendup: 'Send-up', preboard: 'Pre-board', annual: 'Annual', board: 'Board' };

@Component({
  selector: 'app-student-profile',
  imports: [FormsModule, RouterLink, DisciplinePanel, StudentAvatar],
  template: `
  <div class="space-y-8 pb-16 max-w-6xl mx-auto">
    <a routerLink="/students" class="text-xs font-black text-slate-400 hover:text-indigo-500">&larr; All students</a>

    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-sm">{{ error() }}</p> }

    @if (st(); as s) {
      <div class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-col md:flex-row gap-6 md:items-center">
        <img [src]="s.photo || avatar(s.gender)" alt="" class="w-28 h-28 rounded-3xl object-cover border border-slate-200 dark:border-slate-700">
        <div class="flex-1 min-w-0">
          <h2 class="text-3xl font-black tracking-tighter">{{ s.name }}</h2>
          <p class="text-sm font-bold text-slate-400 mt-1">S/O {{ s.father_name }} &middot; {{ s.class_name }}-{{ s.section_name }} &middot; Roll {{ s.roll_no ?? '-' }} &middot; Adm. {{ s.reg_no }}</p>
          <div class="flex flex-wrap gap-2 mt-3">
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="s.gender === 'male' ? 'bg-sky-500/10 text-sky-600' : 'bg-pink-500/10 text-pink-600'">{{ s.gender === 'male' ? 'Boy' : 'Girl' }}</span>
            @if (s.category) { <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="cc(s.category)">Category {{ s.category }}</span> }
            @if (s.status !== 'active') { <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-500/15 text-slate-500">Left school</span> }
            @if (s.bus_route) { <span class="px-2.5 py-1 rounded-lg text-[11px] font-black bg-amber-500/15 text-amber-700 dark:text-amber-300">Bus: {{ s.bus_route }}</span> }
          </div>
        </div>
        <div class="flex flex-wrap gap-2 md:justify-end">
          @if (auth.canWriteStudents()) { <a [routerLink]="['/attendance/student', s.id]" class="btn-ghost">Attendance</a> }
          @if (auth.canFee()) { <a [routerLink]="['/fee/student', s.id]" class="btn-ghost">Fee</a> }
          @if (auth.canWriteStudents()) { <a [routerLink]="['/students/form', s.id]" class="btn-ghost">Admission form</a> }
          @if (res()) { <a [routerLink]="['/exams/print/progress']" [queryParams]="{ studentId: s.id, session: session() || undefined }" class="btn-primary">Print progress report</a> }
        </div>
      </div>

      <div class="flex gap-2 border-b border-slate-200 dark:border-slate-800" role="tablist">
        @for (t of tabs; track t.key) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.key" (click)="tab.set(t.key)"
                  class="px-5 py-3 text-sm font-black border-b-2 -mb-px transition-colors"
                  [class]="tab() === t.key ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'">{{ t.label }}</button>
        }
      </div>

      @switch (tab()) {
        @case ('overview') {
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="kpi"><p class="kl">Attendance</p><p class="kv" [class]="res()?.attendance == null ? 'text-slate-400' : pctClass(res()!.attendance, 75)">{{ res()?.attendance ?? '-' }}{{ res()?.attendance == null ? '' : '%' }}</p></div>
            <div class="kpi"><p class="kl">Latest result</p><p class="kv" [class]="pctClass(latest()?.row?.pct ?? null)">{{ latest()?.row?.pct ?? '-' }}{{ latest()?.row?.pct == null ? '' : '%' }}</p><p class="ks">{{ latest()?.exam?.name ?? 'No exam yet' }}</p></div>
            <div class="kpi"><p class="kl">Average of all exams</p><p class="kv" [class]="pctClass(avgPct())">{{ avgPct() ?? '-' }}{{ avgPct() == null ? '' : '%' }}</p><p class="ks">{{ done().length }} exams</p></div>
            <div class="kpi"><p class="kl">Latest position</p><p class="kv">{{ latest()?.row?.rank ? ord(latest()!.row.rank!) : '-' }}</p><p class="ks">{{ latest() ? 'of ' + latest()!.classSize : '' }}</p></div>
          </div>
          <div class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
            <h3 class="text-lg font-black mb-4">Details</h3>
            <dl class="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4 text-sm">
              @for (r of details(); track r[0]) { <div><dt class="label !ml-0">{{ r[0] }}</dt><dd class="font-bold">{{ r[1] || '-' }}</dd></div> }
            </dl>
          </div>
          <div class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
            <h3 class="text-lg font-black mb-1">Family ({{ fam()?.linked?.length ?? 0 }} linked brother{{ (fam()?.linked?.length ?? 0) === 1 ? '' : 's' }} / sister{{ (fam()?.linked?.length ?? 0) === 1 ? '' : 's' }})</h3>
            @if (fam(); as f) {
              @if (f.linked.length) { <p class="text-xs font-bold text-slate-400 mb-3">This child is number {{ f.order }} in the family (oldest first). Sibling discount follows this order.</p> }
              @for (b of f.linked; track b.id) {
                <div class="flex items-center gap-3 py-2 border-t border-slate-100 dark:border-slate-800">
                  <app-student-avatar [id]="b.id" [name]="b.name" [has]="true" [gender]="b.gender ?? 'male'" />
                  <a [routerLink]="['/students', b.id]" class="flex-1 font-black hover:text-indigo-600">{{ b.name }}</a>
                  <span class="text-xs font-bold text-slate-400">{{ b.class_name }}-{{ b.section_name }} · Adm. {{ b.reg_no }}</span>
                </div>
              }
              @if (f.linked.length && auth.canWriteStudents()) { <button type="button" class="btn-ghost mt-3" (click)="unlink()">Remove this child from the family</button> }
              @if (!f.linked.length && !f.strong.length && !f.possible.length) { <p class="text-sm font-bold text-slate-400">No brother or sister found (checked father CNIC, phone numbers, father name and address).</p> }

              @if (f.strong.length) {
                <h4 class="text-sm font-black mt-5 mb-1 text-amber-700 dark:text-amber-300">Same father CNIC or phone - not linked yet</h4>
                @for (b of f.strong; track b.id) {
                  <div class="flex items-center gap-3 py-2 border-t border-slate-100 dark:border-slate-800">
                    <a [routerLink]="['/students', b.id]" class="flex-1 font-black hover:text-indigo-600">{{ b.name }}</a>
                    <span class="text-xs font-bold text-slate-400">{{ b.class_name }}-{{ b.section_name }}</span>
                    @if (auth.canWriteStudents()) { <button type="button" class="text-xs font-black text-indigo-600" (click)="link(b.id)">Link</button> }
                  </div>
                }
                @if (auth.canWriteStudents()) { <button type="button" class="btn-primary mt-3" (click)="acceptAll()">Link all of them</button> }
              }
              @if (f.possible.length) {
                <h4 class="text-sm font-black mt-5 mb-1 text-slate-500">Possible brother or sister - please confirm</h4>
                <p class="text-xs font-bold text-slate-400 mb-1">Same father name and a similar address. Nothing is linked until you confirm.</p>
                @for (b of f.possible; track b.id) {
                  <div class="flex items-center gap-3 py-2 border-t border-slate-100 dark:border-slate-800">
                    <a [routerLink]="['/students', b.id]" class="flex-1 font-black hover:text-indigo-600">{{ b.name }}</a>
                    <span class="text-xs font-bold text-slate-400">{{ b.class_name }}-{{ b.section_name }} · address {{ b.similarity }}% alike</span>
                    @if (auth.canWriteStudents()) { <button type="button" class="text-xs font-black text-indigo-600" (click)="link(b.id)">Yes, link</button> }
                  </div>
                }
              }
            }
          </div>

          <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
            <h3 class="text-lg font-black mb-1">Documents</h3>
            @if (docs(); as d) {
              @if (d.missing.length) { <p class="p-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm font-black mb-3">Missing: {{ d.missing.join(', ') }}</p> }
              @else if (d.unverified.length) { <p class="p-3 rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300 text-sm font-black mb-3">All uploaded. Not yet verified: {{ d.unverified.join(', ') }}</p> }
              @else { <p class="p-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-sm font-black mb-3">All documents uploaded and verified.</p> }
              @for (x of d.list; track x.key) {
                <div class="py-2 border-t border-slate-100 dark:border-slate-800">
                  <div class="flex flex-wrap items-center gap-3">
                    <span class="font-black flex-1 min-w-40">{{ x.label }}</span>
                    <span class="text-xs font-black" [class]="x.verified ? 'text-emerald-600' : x.uploaded ? 'text-sky-600' : 'text-amber-600'">{{ x.verified ? 'Verified' : x.uploaded ? 'Uploaded' : 'Missing' }}</span>
                    @if (auth.canWriteStudents()) { <label class="btn-ghost cursor-pointer !py-1.5 !px-3 text-xs">Upload<input type="file" class="hidden" accept="image/jpeg,image/png,application/pdf" (change)="upload(x.key, $event)"></label> }
                  </div>
                  @for (f of x.files; track f.id) {
                    <div class="flex items-center gap-3 mt-1 ml-3 text-xs font-bold text-slate-500">
                      <button type="button" class="underline decoration-dotted hover:text-indigo-600" (click)="openDoc(f.id)">{{ f.filename }}</button>
                      <span>{{ (f.size / 1024).toFixed(0) }} KB</span>
                      @if (auth.canWriteStudents()) {
                        <button type="button" class="text-emerald-600 font-black" (click)="verify(f.id, !f.verified)">{{ f.verified ? 'Un-verify' : 'Mark verified' }}</button>
                        <button type="button" class="text-rose-500 font-black" (click)="removeDoc(f.id)">Delete</button>
                      }
                    </div>
                  }
                </div>
              }
              <p class="text-[11px] font-bold text-slate-400 mt-2">JPG, PNG or PDF, up to 4 MB each.</p>
            }
          </div>

          @if (catLog().length) {
            <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
              <h3 class="text-lg font-black mb-3">Category history</h3>
              @for (l of catLog(); track l.id) {
                <div class="flex flex-wrap gap-x-4 py-1.5 border-t border-slate-100 dark:border-slate-800 text-sm">
                  <span class="font-black">{{ l.old_category || 'none' }} &rarr; {{ l.new_category || 'none' }}</span>
                  <span class="text-slate-500 font-bold">{{ l.changed_at }}{{ l.changed_by ? ' · ' + l.changed_by : '' }}{{ l.reason ? ' · ' + l.reason : '' }}</span>
                </div>
              }
            </div>
          }
        }

        @case ('results') {
          @if (!res()) { <p class="p-6 rounded-2xl bg-slate-500/5 text-sm font-bold text-slate-500">{{ resError() || 'Loading results...' }}</p> }
          @else {
            <div class="flex flex-wrap items-center gap-3">
              <label class="label !ml-0" for="sess">Session</label>
              <select id="sess" class="field !w-auto" [ngModel]="session()" (ngModelChange)="setSession($event)">
                <option value="">All sessions</option>
                @for (x of res()!.sessions; track x) { <option [value]="x">{{ x }}</option> }
              </select>
              <span class="text-xs font-bold text-slate-400">{{ res()!.exams.length }} exams</span>
            </div>
            @if (!res()!.exams.length) { <p class="p-8 text-center text-sm font-bold text-slate-400">No marks have been entered for this student yet.</p> }
            @for (e of newest(); track e.exam.id) {
              <section class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-hidden">
                <div class="p-6 flex flex-wrap items-center gap-4 border-b border-slate-100 dark:border-slate-800">
                  <div class="flex-1 min-w-[12rem]">
                    <h3 class="text-lg font-black">{{ e.exam.name }}</h3>
                    <p class="text-xs font-bold text-slate-400">{{ kl(e.exam.kind) }} · {{ e.exam.session }}{{ e.exam.start_date ? ' · ' + d(e.exam.start_date) : '' }} · {{ e.class_name }}-{{ e.section_name }}</p>
                  </div>
                  <span class="text-2xl font-black" [class]="pctClass(e.row.pct, e.exam.pass_percent)">{{ e.row.pct ?? '-' }}{{ e.row.pct == null ? '' : '%' }}</span>
                  <span class="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-500/10">{{ e.row.grade ?? '-' }}</span>
                  <span class="px-2.5 py-1 rounded-lg text-xs font-black" [class]="rc(e.row.result)">{{ e.row.result === 'PASS' ? 'Pass' : e.row.result === 'FAIL' ? 'Fail' : 'Pending' }}</span>
                  @if (e.row.rank) { <span class="text-xs font-black text-slate-500">{{ ord(e.row.rank) }} of {{ e.classSize }}</span> }
                  @if (e.row.delta !== null) { <span class="text-xs font-black" [class]="e.row.trend === 'down' ? 'text-rose-500' : e.row.trend === 'up' ? 'text-emerald-600' : 'text-slate-400'">{{ e.row.trend === 'up' ? '▲' : e.row.trend === 'down' ? '▼' : '=' }} {{ dt(e.row.delta) }} pts</span> }
                  <a [routerLink]="['/exams/print/cards']" [queryParams]="{ examId: e.exam.id, sectionId: e.section_id, studentId: s.id }" class="btn-ghost !py-2">Print result card</a>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-sm text-left">
                    <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-6 py-3">Subject</th><th class="px-4 py-3 text-center">Max</th><th class="px-4 py-3 text-center">Obtained</th><th class="px-4 py-3 text-center">%</th><th class="px-4 py-3 text-center">Section avg</th><th class="px-4 py-3 text-center">Result</th></tr></thead>
                    <tbody>
                      @for (p of e.papers; track p.subject_id) {
                        @let m = e.row.marks[p.subject_id];
                        <tr class="border-t border-slate-50 dark:border-slate-800/60">
                          <td class="px-6 py-3 font-black">{{ p.subject }}</td>
                          <td class="px-4 py-3 text-center text-slate-400 font-bold">{{ p.max_marks }}</td>
                          <td class="px-4 py-3 text-center font-black" [class]="m?.pass === false ? 'text-rose-500' : ''">{{ mt(e, p.subject_id) }}</td>
                          <td class="px-4 py-3 text-center font-bold">{{ m?.marks != null ? pc(m!.marks!, p.max_marks) : '-' }}</td>
                          <td class="px-4 py-3 text-center font-bold text-slate-400">{{ e.subjectAvg[p.subject_id] ?? '-' }}</td>
                          <td class="px-4 py-3 text-center text-xs font-black" [class]="m?.pass === false ? 'text-rose-500' : m?.pass ? 'text-emerald-600' : 'text-slate-400'">{{ m?.pass === false ? 'Fail' : m?.pass ? 'Pass' : '-' }}</td>
                        </tr>
                      }
                      <tr class="border-t-2 border-slate-200 dark:border-slate-700"><td class="px-6 py-3 font-black">Total</td><td class="px-4 py-3 text-center font-black">{{ e.row.max }}</td><td class="px-4 py-3 text-center font-black">{{ e.row.total }}</td><td class="px-4 py-3 text-center font-black">{{ e.row.pct ?? '-' }}</td><td class="px-4 py-3 text-center font-bold text-slate-400">{{ e.sectionAvg ?? '-' }}%</td><td></td></tr>
                    </tbody>
                  </table>
                </div>
              </section>
            }
          }
        }

        @case ('behaviour') { <app-discipline-panel [studentId]="sid" /> }

        @case ('analysis') {
          @if (!res()) { <p class="p-6 rounded-2xl bg-slate-500/5 text-sm font-bold text-slate-500">{{ resError() || 'Loading results...' }}</p> }
          @else if (done().length < 1) { <p class="p-8 text-center text-sm font-bold text-slate-400">Analysis appears once at least one exam has marks.</p> }
          @else {
            <div class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
              <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 class="text-lg font-black">Percentage over time</h3>
                <p class="text-xs font-bold text-slate-400"><span class="inline-block w-3 h-1 bg-indigo-500 rounded mr-1 align-middle"></span>Student <span class="inline-block w-3 h-1 bg-slate-400 rounded ml-3 mr-1 align-middle"></span>Section average</p>
              </div>
              <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="w-full h-auto" role="img" aria-label="Percentage in every exam compared with the section average">
                @for (g of [0, 25, 50, 75, 100]; track g) {
                  <line [attr.x1]="PX" [attr.x2]="W - 8" [attr.y1]="yv(g)" [attr.y2]="yv(g)" stroke="currentColor" class="text-slate-200 dark:text-slate-800" stroke-width="1" />
                  <text [attr.x]="PX - 6" [attr.y]="yv(g) + 3" text-anchor="end" font-size="9" fill="currentColor" class="text-slate-400">{{ g }}</text>
                }
                <polyline [attr.points]="line('ya')" fill="none" stroke="currentColor" class="text-slate-400" stroke-width="2" stroke-dasharray="5 4" />
                <polyline [attr.points]="line('y')" fill="none" stroke="currentColor" class="text-indigo-500" stroke-width="2.5" />
                @for (p of pts(); track $index) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" fill="currentColor" class="text-indigo-500" />
                  <text [attr.x]="p.x" [attr.y]="p.y - 9" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">{{ p.pct }}</text>
                  <text [attr.x]="p.x" [attr.y]="H - 2" text-anchor="middle" font-size="8.5" fill="currentColor" class="text-slate-400">{{ p.label }}</text>
                }
              </svg>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              @for (i of insights(); track $index) {
                <div class="p-5 rounded-2xl border text-sm font-bold" [class]="i.kind === 'good' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300' : i.kind === 'bad' ? 'border-rose-500/30 bg-rose-500/5 text-rose-800 dark:text-rose-300' : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'">{{ i.text }}</div>
              }
            </div>

            <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-hidden">
              <h3 class="text-lg font-black p-6 pb-2">Subject by exam (percentage)</h3>
              <div class="overflow-x-auto">
                <table class="w-full text-sm text-center">
                  <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-6 py-3 text-left">Subject</th>@for (e of res()!.exams; track e.exam.id) { <th class="px-3 py-3 whitespace-nowrap">{{ e.exam.name }}</th> }<th class="px-4 py-3">Average</th><th class="px-4 py-3">Change</th></tr></thead>
                  <tbody>
                    @for (r of subjectRows(); track r.id) {
                      <tr class="border-t border-slate-50 dark:border-slate-800/60">
                        <td class="px-6 py-3 text-left font-black">{{ r.name }}</td>
                        @for (c of r.cells; track $index) { <td class="px-3 py-3 font-bold"><span class="inline-block min-w-[2.6rem] px-2 py-1 rounded-lg" [class]="heat(c)">{{ c ?? '-' }}</span></td> }
                        <td class="px-4 py-3 font-black">{{ r.avg ?? '-' }}</td>
                        <td class="px-4 py-3 text-xs font-black" [class]="r.change === null ? 'text-slate-400' : r.change < 0 ? 'text-rose-500' : 'text-emerald-600'">{{ r.change === null ? '-' : dt(r.change) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        }
      }
    }
  </div>
  `,
  styles: [`
    .kpi { padding: 1.25rem 1.5rem; border-radius: 1.75rem; border: 1px solid rgb(226 232 240 / .9); background: rgb(255 255 255 / .6); }
    :host-context(.dark) .kpi { border-color: rgb(30 41 59); background: rgb(15 23 42 / .4); }
    .kl { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; color: rgb(148 163 184); }
    .kv { font-size: 1.85rem; font-weight: 900; margin-top: .25rem; letter-spacing: -.03em; } .ks { font-size: 11px; font-weight: 700; color: rgb(148 163 184); margin-top: .15rem; }
  `]
})
export class StudentProfile {
  avatar = avatarOf;
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  auth = inject(AuthService);
  private toast = inject(ToastService);
  private http = inject(HttpClient);

  readonly W = W; readonly H = H; readonly PX = PX;
  tabs: { key: Tab; label: string }[] = [{ key: 'overview', label: 'Overview' }, { key: 'results', label: 'Results' }, { key: 'analysis', label: 'Analysis' }, { key: 'behaviour', label: 'Behaviour' }];
  tab = signal<Tab>('overview');
  st = signal<Full | null>(null);
  res = signal<StudentResults | null>(null);
  fam = signal<Family | null>(null);
  session = signal('');
  error = signal('');
  resError = signal('');
  private id = Number(this.route.snapshot.paramMap.get('id'));
  sid = this.id;

  ini = initials; mt = markText; d = fmtDate; dt = deltaText; ord = ordinal; pctClass = pctClass; rc = resultClass; cc = catClass;
  kl = (k: string) => KIND_LABEL[k] ?? k;
  pc = (m: number, max: number) => (max ? Math.round((m / max) * 1000) / 10 : 0);

  /** Exams with a percentage (an exam with marks still missing does not count). */
  done = computed(() => (this.res()?.exams ?? []).filter(e => e.row.pct !== null));
  newest = computed(() => [...(this.res()?.exams ?? [])].reverse());
  latest = computed<ExamResult | null>(() => { const l = this.done(); return l.length ? l[l.length - 1] : null; });
  avgPct = computed(() => { const l = this.done(); return l.length ? Math.round((l.reduce((a, e) => a + (e.row.pct ?? 0), 0) / l.length) * 10) / 10 : null; });

  details = computed<[string, string | null][]>(() => {
    const s = this.st(); if (!s) return [];
    return [
      ['Date of birth', s.dob ? fmtDate(s.dob) : null], ['Gender', s.gender === 'male' ? 'Boy' : 'Girl'], ['Admission date', s.admission_date ? fmtDate(s.admission_date.slice(0, 10)) : null],
      ['Class teacher', s.class_teacher], ["Father's CNIC", s.father_cnic], ['P number', s.p_number],
      ["Father's phone", s.father_phone], ["Mother's phone", s.mother_phone], ['Student phone', s.phone],
      ['Address', s.address], ['School bus', s.bus_route], ['Status', s.status === 'active' ? 'Studying' : 'Left']
    ];
  });

  pts = computed<Pt[]>(() => {
    const l = this.done(), n = l.length, step = n > 1 ? (W - PX - 20) / (n - 1) : 0;
    return l.map((e, i) => ({ x: n > 1 ? PX + 6 + i * step : (W + PX) / 2, y: this.yv(e.row.pct ?? 0), ya: this.yv(e.sectionAvg ?? 0), label: e.exam.name.length > 12 ? e.exam.name.slice(0, 11) + '…' : e.exam.name, pct: e.row.pct }));
  });
  yv = (v: number) => H - 22 - (v / 100) * (H - 22 - PY);
  line(k: 'y' | 'ya') { return this.pts().map(p => `${p.x},${p[k]}`).join(' '); }

  subjectRows = computed(() => {
    const exams = this.res()?.exams ?? [];
    return allSubjects(exams).map(s => {
      const cells = exams.map(e => { const p = e.papers.find(x => x.subject_id === s.id), m = e.row.marks[s.id]; return p && m && m.marks !== null ? Math.round((m.marks / p.max_marks) * 1000) / 10 : null; });
      const v = cells.filter((c): c is number => c !== null);
      return { id: s.id, name: s.name, cells, avg: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null, change: v.length > 1 ? Math.round((v[v.length - 1] - v[0]) * 10) / 10 : null };
    });
  });
  heat = (c: number | null) => (c === null ? 'text-slate-300' : c < 33 ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300' : c < 50 ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : c < 70 ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300');

  insights = computed<{ kind: 'good' | 'bad' | 'info'; text: string }[]>(() => {
    const out: { kind: 'good' | 'bad' | 'info'; text: string }[] = [], l = this.done(), rows = this.subjectRows().filter(r => r.avg !== null);
    if (!l.length) return out;
    const best = [...rows].sort((a, b) => b.avg! - a.avg!)[0], worst = [...rows].sort((a, b) => a.avg! - b.avg!)[0];
    if (best) out.push({ kind: 'good', text: `Strongest subject: ${best.name} (${best.avg}% average).` });
    if (worst && worst !== best) out.push({ kind: worst.avg! < 50 ? 'bad' : 'info', text: `Needs most attention: ${worst.name} (${worst.avg}% average).` });
    if (l.length > 1) {
      const first = l[0].row.pct!, last = l[l.length - 1].row.pct!, diff = Math.round((last - first) * 10) / 10;
      out.push({ kind: diff > 2 ? 'good' : diff < -2 ? 'bad' : 'info', text: diff > 2 ? `Overall up ${diff} points from ${l[0].exam.name} to ${l[l.length - 1].exam.name}.` : diff < -2 ? `Overall down ${Math.abs(diff)} points from ${l[0].exam.name} to ${l[l.length - 1].exam.name}.` : 'Overall performance is steady across the exams.' });
    }
    const above = l.filter(e => e.sectionAvg !== null && e.row.pct! >= e.sectionAvg).length;
    out.push({ kind: above * 2 >= l.length ? 'good' : 'info', text: `Above the section average in ${above} of ${l.length} exams.` });
    const failed = rows.filter(r => r.cells.some(c => c !== null && c < 33));
    if (failed.length) out.push({ kind: 'bad', text: `Below 33% at least once in: ${failed.map(r => r.name).join(', ')}.` });
    const declining = rows.filter(r => r.change !== null && r.change <= -10);
    if (declining.length) out.push({ kind: 'bad', text: `Falling by 10+ points since the first exam: ${declining.map(r => r.name).join(', ')}.` });
    const rising = rows.filter(r => r.change !== null && r.change >= 10);
    if (rising.length) out.push({ kind: 'good', text: `Improving by 10+ points since the first exam: ${rising.map(r => r.name).join(', ')}.` });
    return out;
  });

  docs = signal<DocList | null>(null); catLog = signal<{ id: number; old_category: string | null; new_category: string | null; changed_at: string; changed_by: string | null; reason: string | null }[]>([]);
  loadDocs() { this.api.get<DocList>(`/students/${this.id}/documents`).subscribe({ next: r => this.docs.set(r), error: () => { /* optional */ } }); this.api.get<any[]>(`/students/${this.id}/category-log`).subscribe({ next: r => this.catLog.set(r), error: () => { /* optional */ } }); }
  async upload(type: string, ev: Event) {
    const input = ev.target as HTMLInputElement, f = input.files?.[0]; if (!f) return;
    this.http.post(`/api/students/${this.id}/documents?type=${type}&name=${encodeURIComponent(f.name)}`, f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }).subscribe({ next: () => { this.toast.show('Uploaded.'); input.value = ''; this.loadDocs(); }, error: e => { input.value = ''; this.toast.show(errorText(e), 'error'); } });
  }
  openDoc(docId: number) {
    this.api.get<{ filename: string; mime: string; base64: string }>(`/students/${this.id}/documents/${docId}/file`).subscribe({
      next: r => { const bin = atob(r.base64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); window.open(URL.createObjectURL(new Blob([arr], { type: r.mime })), '_blank', 'noopener'); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
  verify(docId: number, v: boolean) { this.api.put(`/students/${this.id}/documents/${docId}/verify`, { verified: v }).subscribe({ next: () => this.loadDocs(), error: e => this.toast.show(errorText(e), 'error') }); }
  removeDoc(docId: number) { if (!confirm('Delete this document?')) return; this.api.delete(`/students/${this.id}/documents/${docId}`).subscribe({ next: () => this.loadDocs(), error: e => this.toast.show(errorText(e), 'error') }); }
  loadFamily() { this.api.get<Family>(`/students/${this.id}/family`).subscribe({ next: r => this.fam.set(r), error: () => { /* optional */ } }); }
  private familyDone = (msg: string) => () => { this.toast.show(msg); this.loadFamily(); };
  link(sib: number) { this.api.post(`/students/${this.id}/family/link`, { sibling_id: sib }).subscribe({ next: this.familyDone('Linked. Sibling fees were updated.'), error: e => this.toast.show(errorText(e), 'error') }); }
  acceptAll() { this.api.post(`/students/${this.id}/family/accept`, {}).subscribe({ next: this.familyDone('Linked. Sibling fees were updated.'), error: e => this.toast.show(errorText(e), 'error') }); }
  unlink() { if (!confirm('Remove this child from the family? Sibling discounts will be recalculated.')) return; this.api.delete(`/students/${this.id}/family`).subscribe({ next: this.familyDone('Removed from the family.'), error: e => this.toast.show(errorText(e), 'error') }); }

  constructor() {
    this.api.get<Full>(`/students/${this.id}`).subscribe({ next: s => this.st.set(s), error: e => this.error.set(errorText(e)) });
    this.loadFamily(); this.loadDocs();
    this.loadResults();
  }

  setSession(v: string) { this.session.set(v); this.loadResults(); }
  private loadResults() {
    this.api.get<StudentResults>(`/exam/students/${this.id}/results`, { session: this.session() || undefined }).subscribe({
      next: r => { this.res.set(r); this.resError.set(''); },
      error: e => { this.res.set(null); this.resError.set(errorText(e)); }
    });
  }
}
