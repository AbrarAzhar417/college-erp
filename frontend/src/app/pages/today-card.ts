import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { AuthService } from '../core/auth';

interface Today {
  date: string; holiday?: string | null;
  fee: { receipts: { n: number; total: number }; owing: { n: number; total: number }; overdueVouchers: number; dueToday: number };
  teachers?: { absent: { id: number; name: string; why: string; lessons: number; covered: number; uncovered: number }[]; uncovered: number };
  leaves?: { staffPending: number; studentPending: number };
  summonsPending?: number;
  attendanceMissing?: string[]; studentsAbsent?: number;
  exams?: { id: number; name: string; start_date: string; end_date: string | null; status: string }[];
}

/** "Aaj ka kaam": what needs attention today, each line opens the page where it is dealt with. */
@Component({
  selector: 'app-today-card',
  imports: [RouterLink],
  template: `
  @if (t(); as v) {
    <section class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-5" aria-label="Today">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <h3 class="text-xl font-black tracking-tight">Aaj ka kaam <span class="text-sm font-bold text-slate-400">{{ v.date }}{{ v.holiday ? ' · ' + v.holiday : '' }}</span></h3>
      </div>
      <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        @if (v.teachers) {
          <a routerLink="/timetable/subs" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors" [class.!border-rose-400]="v.teachers.uncovered > 0">
            <p class="text-3xl font-black" [class.text-rose-600]="v.teachers.uncovered > 0">{{ v.teachers.uncovered }}</p>
            <p class="text-xs font-black">Lessons without a replacement</p>
            <p class="text-[11px] font-bold text-slate-400 mt-1">{{ v.teachers.absent.length ? v.teachers.absent.length + ' teacher(s) away: ' + names(v) : 'No teacher is away today.' }}</p>
          </a>
        }
        @if (v.summonsPending) {
          <a routerLink="/discipline" class="p-4 rounded-2xl border border-amber-400 hover:border-indigo-400 transition-colors">
            <p class="text-3xl font-black text-amber-600">{{ v.summonsPending }}</p>
            <p class="text-xs font-black">Parent summons waiting</p>
            <p class="text-[11px] font-bold text-slate-400 mt-1">Open discipline records</p>
          </a>
        }
        @if (v.leaves) {
          <a routerLink="/hr/leaves" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors" [class.!border-amber-400]="v.leaves.staffPending > 0">
            <p class="text-3xl font-black" [class.text-amber-600]="v.leaves.staffPending > 0">{{ v.leaves.staffPending }}</p>
            <p class="text-xs font-black">Staff leave requests waiting</p>
            <p class="text-[11px] font-bold text-slate-400 mt-1">Open the staff leaves page</p>
          </a>
          <a routerLink="/attendance/leaves" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors" [class.!border-amber-400]="v.leaves.studentPending > 0">
            <p class="text-3xl font-black" [class.text-amber-600]="v.leaves.studentPending > 0">{{ v.leaves.studentPending }}</p>
            <p class="text-xs font-black">Student leave requests waiting</p>
            <p class="text-[11px] font-bold text-slate-400 mt-1">Open the student leaves page</p>
          </a>
        }
        @if (v.attendanceMissing) {
          <a routerLink="/attendance" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors" [class.!border-amber-400]="v.attendanceMissing.length > 0">
            <p class="text-3xl font-black" [class.text-amber-600]="v.attendanceMissing.length > 0">{{ v.attendanceMissing.length }}</p>
            <p class="text-xs font-black">Sections whose attendance is not taken yet</p>
            <p class="text-[11px] font-bold text-slate-400 mt-1">{{ v.attendanceMissing.length ? v.attendanceMissing.slice(0, 6).join(', ') + (v.attendanceMissing.length > 6 ? '…' : '') : 'All done.' }} · {{ v.studentsAbsent }} student(s) absent</p>
          </a>
        }
        <a routerLink="/fee/defaulters" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors">
          <p class="text-3xl font-black">{{ v.fee.owing.n }}</p>
          <p class="text-xs font-black">Students owing fee</p>
          <p class="text-[11px] font-bold text-slate-400 mt-1">Rs {{ v.fee.owing.total }} in all · {{ v.fee.overdueVouchers }} overdue voucher(s), {{ v.fee.dueToday }} due today</p>
        </a>
        <a routerLink="/fee" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors">
          <p class="text-3xl font-black">Rs {{ v.fee.receipts.total }}</p>
          <p class="text-xs font-black">Fee received today</p>
          <p class="text-[11px] font-bold text-slate-400 mt-1">{{ v.fee.receipts.n }} receipt(s)</p>
        </a>
        @if (v.exams) {
          <a routerLink="/exam" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition-colors">
            <p class="text-3xl font-black">{{ v.exams.length }}</p>
            <p class="text-xs font-black">Exams on or within 2 weeks</p>
            <p class="text-[11px] font-bold text-slate-400 mt-1">{{ examLine(v) }}</p>
          </a>
        }
      </div>
    </section>
  }
  `
})
export class TodayCard {
  private api = inject(Api);
  private auth = inject(AuthService);
  t = signal<Today | null>(null);
  constructor() {
    const role = this.auth.user()?.role;
    if (role && ['director', 'principal', 'admin', 'accountant'].includes(role)) this.api.get<Today>('/today').subscribe({ next: r => this.t.set(r), error: () => { /* the dashboard still works without it */ } });
  }
  names(v: Today) { return (v.teachers?.absent ?? []).slice(0, 4).map(a => `${a.name} (${a.uncovered} left)`).join(', '); }
  examLine(v: Today) { return (v.exams ?? []).slice(0, 3).map(e => `${e.name} ${e.start_date}`).join(' · ') || 'Nothing scheduled.'; }
}
