import { StudentAvatar } from '../pages/student-avatar';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ClassReport, Invite, MeetingInfo, StudentReport } from './ptm-types';

@Component({
  selector: 'app-ptm-meeting',
  imports: [FormsModule, RouterLink, StudentAvatar],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <a routerLink="/ptm" class="text-xs font-black text-indigo-600">&larr; All meetings</a>
    @if (m(); as mt) {
      <div><h2 class="text-3xl font-black tracking-tighter">{{ mt.title }}</h2>
        @if (office()) { <button type="button" class="text-xs font-black text-indigo-600 mt-1" (click)="editMeeting(mt)">Change title, date or venue</button> }
        <p class="text-sm font-bold text-slate-400 mt-2">{{ mt.date }} · from {{ mt.start_time }} · {{ mt.slot_minutes }} min each{{ mt.venue ? ' · ' + mt.venue : '' }} · {{ mt.exam_name ?? 'attendance only' }} · attendance {{ mt.att_from }} to {{ mt.att_to }}</p></div>
      <nav class="flex gap-2 overflow-x-auto" aria-label="Classes">
        @for (s of mt.sections; track s.id) { <button type="button" (click)="pick(s.id)" class="shrink-0 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest border border-slate-200 dark:border-slate-800" [class]="sec() === s.id ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900/40 text-slate-500'">{{ s.label }} · {{ s.attended }}/{{ s.total }}</button> }
      </nav>
      @if (!mt.sections.length) { <p class="p-6 rounded-2xl bg-slate-500/5 text-sm font-bold text-slate-500">You are not the class teacher of any class in this meeting.</p> }
    }
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (rep(); as r) {
      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <div class="flex flex-wrap items-center gap-3"><h3 class="text-xl font-black flex-1">Class {{ r.section.label }} summary</h3>
          <a class="btn-ghost" [routerLink]="['/ptm', id, 'print']" [queryParams]="{ section_id: r.section.id, mode: 'class' }">Print class report</a>
          <a class="btn-ghost" [routerLink]="['/ptm', id, 'print']" [queryParams]="{ section_id: r.section.id, mode: 'students' }">Print all parent sheets</a></div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          @if (r.result; as x) {
            <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ x.passPct ?? '-' }}%</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Passed ({{ x.pass }}/{{ x.complete }})</div></div>
            <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ x.avg ?? '-' }}%</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Class average</div></div>
            <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ x.highest ?? '-' }}% / {{ x.lowest ?? '-' }}%</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Highest / lowest</div></div>
          }
          <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ r.attendance.avgPct ?? '-' }}%</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Average attendance</div></div>
          <div class="p-4 rounded-2xl bg-slate-500/5"><div class="text-2xl font-black">{{ r.attendance.lowCount }}</div><div class="text-[11px] font-black uppercase tracking-widest text-slate-400">Below {{ r.attendance.lowLimit }}%</div></div>
        </div>
        @if (r.result && r.result.incomplete) { <p class="text-xs font-black text-amber-600">{{ r.result.incomplete }} student(s) have missing marks, so their result is incomplete.</p> }
        @if (r.result) {
          <div class="overflow-x-auto"><table class="w-full text-sm"><caption class="sr-only">Subject results of the class</caption>
            <thead><tr class="text-left text-[11px] font-black uppercase tracking-widest text-slate-400"><th scope="col" class="py-2">Subject</th><th scope="col">Teacher</th><th scope="col">Average</th><th scope="col">Highest</th><th scope="col">Passed</th><th scope="col">Failed</th></tr></thead>
            <tbody>@for (s of r.result.subjects; track s.subject) { <tr class="border-t border-slate-100 dark:border-slate-800 font-bold"><td class="py-2">{{ s.subject }}</td><td>{{ s.teacher ?? '-' }}</td><td>{{ s.avgPct ?? '-' }}%</td><td>{{ s.highest ?? '-' }}</td><td>{{ s.passPct ?? '-' }}%</td><td>{{ s.failed }}</td></tr> }</tbody></table></div>
        }
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-ghost" (click)="loadInvites()">{{ invites().length ? 'Hide invitations' : 'Invitation messages' }}</button>
          @if (office()) { <button type="button" class="btn-ghost" (click)="addLate()">Add students who joined later</button> }
        </div>
        @if (invites().length) {
          <div class="space-y-2">@for (i of invites(); track i.slot_id) {
            <div class="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-bold">
              <span class="w-14">{{ i.time }}</span><span class="flex-1 min-w-40">{{ i.student }} <span class="text-slate-400">({{ i.father }})</span></span>
              @if (i.phone) { <a class="text-emerald-600 font-black" target="_blank" rel="noopener" [href]="wa(i)" (click)="notified(i)">WhatsApp</a><a class="text-indigo-600 font-black" [href]="'sms:+' + i.phone + '?body=' + enc(i.message)" (click)="notified(i)">SMS</a> } @else { <span class="text-rose-500 text-xs">No valid phone</span> }
              @if (i.notified) { <span class="text-xs text-emerald-600">sent</span> }
            </div>
          }</div>
        }
      </section>

      <section class="space-y-2" aria-label="Schedule">
        @for (s of r.students; track s.student_id) {
          <div class="bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <button type="button" class="w-full flex flex-wrap items-center gap-3 p-4 text-left" (click)="open(s.student_id)" [attr.aria-expanded]="openId() === s.student_id">
              <span class="font-black w-14">{{ s.time }}</span>
              <span class="font-black flex-1 min-w-44">{{ s.roll_no ?? '-' }}. {{ s.name }} <span class="text-slate-400 text-xs font-bold">{{ s.father_name }}</span></span>
              @if (s.result) { <span class="text-xs font-black px-2 py-1 rounded-lg" [class]="s.result === 'FAIL' ? 'bg-rose-500/15 text-rose-600' : s.result === 'PASS' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-slate-500/10 text-slate-500'">{{ s.result === 'INCOMPLETE' ? 'incomplete' : s.pct + '% · #' + s.rank }}</span> }
              <span class="text-xs font-black px-2 py-1 rounded-lg" [class]="s.lowAtt ? 'bg-rose-500/15 text-rose-600' : 'bg-slate-500/10 text-slate-500'">Att {{ s.att_pct ?? '-' }}%</span>
              @if (s.trend === 'down') { <span class="text-xs font-black text-rose-500">&darr; {{ s.delta }}</span> } @if (s.trend === 'up') { <span class="text-xs font-black text-emerald-600">&uarr; +{{ s.delta }}</span> }
              <span class="text-[11px] font-black uppercase tracking-widest" [class]="s.status === 'attended' ? 'text-emerald-600' : s.status === 'no_show' ? 'text-rose-500' : 'text-slate-400'">{{ s.status === 'no_show' ? 'did not come' : s.status === 'scheduled' ? 'waiting' : 'met' }}</span>
            </button>
            @if (openId() === s.student_id && sr(); as d) {
              <div class="p-5 border-t border-slate-100 dark:border-slate-800 space-y-4">
                <div class="flex items-center gap-3"><app-student-avatar [id]="d.student.id" [name]="d.student.name" [has]="true" [gender]="d.student.gender" size="lg" /><div><p class="text-xl font-black">{{ d.student.name }}</p><p class="text-xs font-bold text-slate-400">S/O {{ d.student.father_name }} · {{ d.student.section }}</p></div></div>
                @if (d.points.length) { <ul class="space-y-1">@for (p of d.points; track p.text) { <li class="text-sm font-bold" [class]="p.kind === 'good' ? 'text-emerald-600' : 'text-rose-600'">{{ p.kind === 'good' ? '+' : '!' }} {{ p.text }}</li> }</ul> }
                @if (d.result) {
                  <div class="overflow-x-auto"><table class="w-full text-sm"><caption class="sr-only">Subject marks</caption><thead><tr class="text-left text-[11px] font-black uppercase tracking-widest text-slate-400"><th scope="col" class="py-1">Subject</th><th scope="col">Marks</th><th scope="col">%</th><th scope="col">Class avg</th></tr></thead>
                    <tbody>@for (x of d.result.subjects; track x.subject) { <tr class="border-t border-slate-100 dark:border-slate-800 font-bold" [class.text-rose-600]="x.pass === false"><td class="py-1">{{ x.subject }}</td><td>{{ x.status === 'A' ? 'Absent' : x.status === 'L' ? 'Leave' : x.marks === null ? '-' : x.marks + '/' + x.max }}</td><td>{{ x.pct ?? '-' }}</td><td>{{ x.classAvg ?? '-' }}</td></tr> }</tbody></table></div>
                }
                <p class="text-sm font-bold text-slate-500">Attendance: {{ d.attendance.present + d.attendance.late }} present, {{ d.attendance.absent }} absent, {{ d.attendance.leave }} leave, {{ d.attendance.late }} late.</p>
                <div class="flex gap-2 flex-wrap"><a class="btn-ghost" [routerLink]="['/ptm', id, 'print']" [queryParams]="{ section_id: sec(), student_id: s.student_id, mode: 'students' }">Print parent sheet</a></div>
                <form (ngSubmit)="saveSlot(d)" class="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><label class="label" [for]="'ab' + s.student_id">Who came</label><input [id]="'ab' + s.student_id" name="ab" class="field" placeholder="Father, mother..." [(ngModel)]="nf.attended_by"></div>
                  <div class="col-span-2"><label class="label" [for]="'ds' + s.student_id">What was discussed</label><input [id]="'ds' + s.student_id" name="ds" class="field" maxlength="1500" [(ngModel)]="nf.discussed"></div>
                  <div><label class="label" [for]="'fu' + s.student_id">Follow up on</label><input [id]="'fu' + s.student_id" name="fu" type="date" class="field" [(ngModel)]="nf.follow_up"></div>
                  <div class="col-span-2"><label class="label" [for]="'pr' + s.student_id">Parent's remarks</label><input [id]="'pr' + s.student_id" name="pr" class="field" maxlength="1000" [(ngModel)]="nf.parent_remarks"></div>
                  <div class="col-span-2"><label class="label" [for]="'ap' + s.student_id">Agreed action</label><input [id]="'ap' + s.student_id" name="ap" class="field" maxlength="1000" [(ngModel)]="nf.action_points"></div>
                  <div class="col-span-2 md:col-span-4 flex flex-wrap gap-2">
                    <button class="btn-primary" type="submit">Save as met</button>
                    <button type="button" class="btn-ghost" (click)="noShow(d)">Did not come</button>
                  </div>
                </form>
              </div>
            }
          </div>
        }
      </section>
    }
  </div>
  `
})
export class PtmMeeting {
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  office = computed(() => ['director', 'principal', 'admin'].includes(this.auth.user()?.role ?? ''));
  m = signal<MeetingInfo | null>(null); sec = signal(0); rep = signal<ClassReport | null>(null); error = signal('');
  openId = signal(0); sr = signal<StudentReport | null>(null); invites = signal<Invite[]>([]);
  nf = { attended_by: '', discussed: '', follow_up: '', parent_remarks: '', action_points: '' };
  enc = encodeURIComponent;
  constructor() {
    this.api.get<MeetingInfo>(`/ptm/${this.id}`).subscribe({ next: r => { this.m.set(r); if (r.sections.length) this.pick(r.sections[0].id); }, error: e => this.error.set(errorText(e)) });
  }
  editMeeting(mt: MeetingInfo) {
    const title = prompt('Meeting title', mt.title); if (title === null) return;
    const date = prompt('Meeting date (YYYY-MM-DD)', mt.date); if (date === null) return;
    const venue = prompt('Venue', mt.venue ?? ''); if (venue === null) return;
    this.api.put(`/ptm/${this.id}`, { title, date, venue }).subscribe({ next: () => { this.toast.show('Meeting changed.'); this.m.set({ ...mt, title, date, venue: venue || null }); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  pick(s: number) { this.sec.set(s); this.openId.set(0); this.sr.set(null); this.invites.set([]); this.reload(); }
  reload() { this.api.get<ClassReport>(`/ptm/${this.id}/sections/${this.sec()}/report`).subscribe({ next: r => this.rep.set(r), error: e => this.error.set(errorText(e)) }); }
  open(sid: number) {
    if (this.openId() === sid) { this.openId.set(0); return; }
    this.openId.set(sid); this.sr.set(null);
    this.api.get<StudentReport>(`/ptm/${this.id}/students/${sid}/report`).subscribe({ next: r => { this.sr.set(r); this.nf = { attended_by: r.slot.attended_by ?? '', discussed: r.slot.discussed, follow_up: r.slot.follow_up ?? '', parent_remarks: r.slot.parent_remarks, action_points: r.slot.action_points }; }, error: e => this.toast.show(errorText(e), 'error') });
  }
  saveSlot(d: StudentReport) { this.api.put(`/ptm/slots/${d.slot.id}`, { ...this.nf, follow_up: this.nf.follow_up || null, status: 'attended' }).subscribe({ next: () => { this.toast.show('Saved.'); this.reload(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  noShow(d: StudentReport) { this.api.put(`/ptm/slots/${d.slot.id}`, { status: 'no_show', follow_up: this.nf.follow_up || null }).subscribe({ next: () => { this.toast.show('Marked as not come.'); this.reload(); }, error: e => this.toast.show(errorText(e), 'error') }); }
  loadInvites() { if (this.invites().length) { this.invites.set([]); return; } this.api.get<Invite[]>(`/ptm/${this.id}/sections/${this.sec()}/invites`).subscribe({ next: r => this.invites.set(r), error: e => this.toast.show(errorText(e), 'error') }); }
  wa(i: Invite) { return `https://wa.me/${i.phone}?text=${encodeURIComponent(i.message)}`; }
  notified(i: Invite) { this.api.put(`/ptm/slots/${i.slot_id}/notified`, {}).subscribe({ next: () => this.invites.update(l => l.map(x => x.slot_id === i.slot_id ? { ...x, notified: true } : x)) }); }
  addLate() { this.api.post<{ added: number }>(`/ptm/${this.id}/add-late`, {}).subscribe({ next: r => { this.toast.show(r.added ? `${r.added} student(s) added.` : 'Nobody new to add.'); this.reload(); }, error: e => this.toast.show(errorText(e), 'error') }); }
}
