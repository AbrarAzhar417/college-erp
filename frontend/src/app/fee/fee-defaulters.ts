import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { ClassInfo } from '../core/models';
import { fmtDate, money } from './fee';

interface Row { student_id: number; name: string; father_name: string; phone: string | null; roll_no: number | null; reg_no: string; class_name: string; section_name: string; balance: number; pending_vouchers: number; oldest_due: string | null }

@Component({
  selector: 'app-fee-defaulters',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <div class="no-print bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
      <select class="field" aria-label="Class" [ngModel]="classId()" (ngModelChange)="setClass($event)"><option [ngValue]="null">All classes</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
      <select class="field" aria-label="Section" [ngModel]="sectionId()" (ngModelChange)="sectionId.set($event); load()" [disabled]="!classId()"><option [ngValue]="null">All sections</option>@for (s of sections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }</select>
      <div><label class="label" for="mn">Owing more than (Rs)</label><input id="mn" type="number" min="0" class="field" [ngModel]="min()" (ngModelChange)="min.set($event); load()"></div>
      <div class="flex gap-3"><button type="button" class="btn-ghost" (click)="csv()">Download CSV</button><button type="button" class="btn-ghost" (click)="print()">Print</button><a class="btn-ghost" routerLink="/parent-messages" [queryParams]="{ kind: 'fee', classId: classId() ?? undefined, sectionId: sectionId() ?? undefined, min: min() || undefined }">Send reminders</a></div>
    </div>
    @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    <section class="print-area bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-hidden">
      <div class="p-6 pb-2"><h3 class="text-xl font-black tracking-tight">Fee defaulters</h3>
        <p class="text-sm font-bold text-slate-500 mt-1">{{ rows().length }} students owe Rs {{ m(total()) }} in total</p></div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
            <th class="px-6 py-4">Student</th><th class="px-6 py-4">Class</th><th class="px-6 py-4">Contact</th><th class="px-6 py-4 text-right">Vouchers pending</th><th class="px-6 py-4">Oldest due</th><th class="px-6 py-4 text-right">Owes</th></tr></thead>
          <tbody>
            @for (r of rows(); track r.student_id) {
              <tr class="border-b border-slate-50 dark:border-slate-800/60">
                <td class="px-6 py-3 whitespace-nowrap"><a [routerLink]="['/fee/student', r.student_id]" class="font-black hover:text-indigo-500">{{ r.name }}</a><p class="text-[11px] font-bold text-slate-400">S/O {{ r.father_name }} · Roll {{ r.roll_no ?? '-' }}</p></td>
                <td class="px-6 py-3 font-black whitespace-nowrap">{{ r.class_name }}-{{ r.section_name }}</td>
                <td class="px-6 py-3 font-bold text-slate-500 whitespace-nowrap">{{ r.phone || '-' }}</td>
                <td class="px-6 py-3 text-right font-bold">{{ r.pending_vouchers }}</td>
                <td class="px-6 py-3 whitespace-nowrap">{{ r.oldest_due ? d(r.oldest_due) : '-' }}</td>
                <td class="px-6 py-3 text-right font-black text-rose-500 whitespace-nowrap">Rs {{ m(r.balance) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (!rows().length) { <p class="p-10 text-center text-sm font-bold text-slate-400">No student has unpaid fee.</p> }
    </section>
  </div>
  `
})
export class FeeDefaulters {
  private api = inject(Api);
  m = money; d = fmtDate;
  classes = signal<ClassInfo[]>([]);
  classId = signal<number | null>(null); sectionId = signal<number | null>(null); min = signal(0);
  rows = signal<Row[]>([]); error = signal('');
  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  total = computed(() => this.rows().reduce((a, r) => a + r.balance, 0));

  constructor() { this.api.get<ClassInfo[]>('/classes').subscribe(c => this.classes.set(c)); this.load(); }
  setClass(id: number | null) { this.classId.set(id); this.sectionId.set(null); this.load(); }
  load() {
    this.api.get<Row[]>('/fee/defaulters', { classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined, min: this.min() || undefined })
      .subscribe({ next: r => { this.rows.set(r); this.error.set(''); }, error: e => this.error.set(errorText(e)) });
  }
  print() { window.print(); }
  csv() {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Father', 'Class', 'Section', 'Roll no', 'Admission no', 'Contact', 'Vouchers pending', 'Oldest due', 'Owes'].join(',')]
      .concat(this.rows().map(r => [r.name, r.father_name, r.class_name, r.section_name, r.roll_no, r.reg_no, r.phone, r.pending_vouchers, r.oldest_due, r.balance].map(q).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'fee-defaulters.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
}
