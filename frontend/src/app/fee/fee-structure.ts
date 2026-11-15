import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { FREQ_LABEL, Head } from './fee';

@Component({
  selector: 'app-fee-structure',
  imports: [FormsModule],
  template: `
  <div class="space-y-8">
    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div><h3 class="text-xl font-black tracking-tight">Kinds of fee</h3>
        <p class="text-sm font-bold text-slate-400 mt-1">Add every fee your college charges. "Extra" fees (transport, hostel) are only charged to students you assign them to.</p></div>
      <div class="space-y-3">
        @for (h of heads(); track h.id) {
          <div class="grid grid-cols-12 gap-3 items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <input class="field col-span-12 md:col-span-4 !py-2.5" [(ngModel)]="h.name" [name]="'n' + h.id" [attr.aria-label]="'Name of ' + h.name">
            <select class="field col-span-6 md:col-span-3 !py-2.5" [(ngModel)]="h.frequency" [name]="'f' + h.id" aria-label="How often"><option value="monthly">Every month</option><option value="annual">Once a year</option><option value="one_time">One time</option></select>
            <label class="col-span-6 md:col-span-2 flex items-center gap-2 text-xs font-bold"><input type="checkbox" class="w-4 h-4 accent-indigo-600" [ngModel]="!!h.optional" (ngModelChange)="h.optional = $event ? 1 : 0" [name]="'o' + h.id"> Extra fee</label>
            <label class="col-span-6 md:col-span-1 flex items-center gap-2 text-xs font-bold" title="Concessions without a chosen fee apply here"><input type="checkbox" class="w-4 h-4 accent-indigo-600" [ngModel]="!!h.concessionable" (ngModelChange)="h.concessionable = $event ? 1 : 0" [name]="'c' + h.id"> Discountable</label>
            <div class="col-span-6 md:col-span-2 flex justify-end gap-2">
              <button type="button" class="btn-ghost !py-2 !px-4" (click)="saveHead(h)">Save</button>
              <button type="button" class="btn-ghost !py-2 !px-4 !text-rose-500" (click)="removeHead(h)">Delete</button>
            </div>
          </div>
        }
      </div>
      <form (ngSubmit)="addHead()" class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div class="md:col-span-2"><label class="label" for="nh">New fee</label><input id="nh" name="nh" class="field" required [(ngModel)]="nh.name" placeholder="e.g. Hostel Fee"></div>
        <div><label class="label" for="nf">How often</label><select id="nf" name="nf" class="field" [(ngModel)]="nh.frequency"><option value="monthly">Every month</option><option value="annual">Once a year</option><option value="one_time">One time</option></select></div>
        <button class="btn-primary" type="submit">Add fee</button>
      </form>
      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    </section>

    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h3 class="text-xl font-black tracking-tight">Amount for each class (Rs)</h3><p class="text-sm font-bold text-slate-400 mt-1">Leave empty or 0 when a class does not pay that fee.</p></div>
        <button type="button" class="btn-primary" (click)="saveAmounts()">Save all amounts</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm min-w-[640px]">
          <thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="py-3 pr-4">Fee</th>@for (c of classes(); track c.id) { <th class="py-3 px-1">{{ c.name }}</th> }</tr></thead>
          <tbody>
            @for (h of heads(); track h.id) {
              <tr class="border-t border-slate-100 dark:border-slate-800">
                <td class="py-2 pr-4 font-black whitespace-nowrap">{{ h.name }}<span class="block text-[11px] font-bold text-slate-400">{{ freq(h.frequency) }}{{ h.optional ? ' · default for extra fee' : '' }}</span></td>
                @for (c of classes(); track c.id) {
                  <td class="py-2 px-1"><input type="number" min="0" class="field !py-2.5 !px-3 !text-xs min-w-24" [ngModel]="amounts[c.id + '-' + h.id]" (ngModelChange)="amounts[c.id + '-' + h.id] = $event" [name]="'a' + c.id + '-' + h.id" [attr.aria-label]="h.name + ' ' + c.name"></td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  </div>
  `
})
export class FeeStructure {
  private api = inject(Api);
  private toast = inject(ToastService);
  heads = signal<Head[]>([]);
  classes = signal<{ id: number; name: string }[]>([]);
  amounts: Record<string, number | null> = {};
  error = signal('');
  nh = { name: '', frequency: 'monthly' };
  freq = (f: string) => FREQ_LABEL[f as keyof typeof FREQ_LABEL];

  constructor() { this.load(); }
  load() {
    this.api.get<{ classes: { id: number; name: string }[]; heads: Head[]; amounts: { class_id: number; head_id: number; amount: number }[] }>('/fee/structure').subscribe({
      next: d => { this.classes.set(d.classes); this.heads.set(d.heads); this.amounts = {}; for (const a of d.amounts) this.amounts[`${a.class_id}-${a.head_id}`] = a.amount; },
      error: e => this.error.set(errorText(e))
    });
  }
  addHead() { this.error.set(''); this.api.post('/fee/heads', this.nh).subscribe({ next: () => { this.nh = { name: '', frequency: 'monthly' }; this.load(); this.toast.show('Fee added.'); }, error: e => this.error.set(errorText(e)) }); }
  saveHead(h: Head) { this.api.put(`/fee/heads/${h.id}`, h).subscribe({ next: () => this.toast.show('Saved.'), error: e => this.toast.show(errorText(e), 'error') }); }
  removeHead(h: Head) {
    if (!confirm(`Delete "${h.name}"? If vouchers already use it, it is only hidden.`)) return;
    this.api.delete(`/fee/heads/${h.id}`).subscribe({ next: () => { this.load(); this.toast.show('Deleted.'); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  saveAmounts() {
    const entries = this.classes().flatMap(c => this.heads().map(h => ({ class_id: c.id, head_id: h.id, amount: Number(this.amounts[`${c.id}-${h.id}`]) || 0 })));
    this.api.put('/fee/structure', { entries }).subscribe({ next: () => this.toast.show('Amounts saved.'), error: e => this.toast.show(errorText(e), 'error') });
  }
}
