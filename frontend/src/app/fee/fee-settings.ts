import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { ToastService } from '../core/toast';
import { FeeSettings } from './fee';

@Component({
  selector: 'app-fee-settings',
  imports: [FormsModule],
  template: `
  <form (ngSubmit)="save()" class="max-w-3xl bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
    <div><h3 class="text-xl font-black tracking-tight">Voucher settings</h3>
      <p class="text-sm font-bold text-slate-400 mt-1">These are printed on every voucher. The college name, address and logo are set in My Profile.</p></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div><label class="label" for="bn">Bank name</label><input id="bn" name="bn" class="field" [(ngModel)]="f.bank_name"></div>
      <div><label class="label" for="bb">Branch</label><input id="bb" name="bb" class="field" [(ngModel)]="f.bank_branch"></div>
      <div><label class="label" for="at">Account title</label><input id="at" name="at" class="field" [(ngModel)]="f.account_title"></div>
      <div><label class="label" for="an">Account number</label><input id="an" name="an" class="field" [(ngModel)]="f.account_no"></div>
      <div class="md:col-span-2"><label class="label" for="ib">IBAN (optional)</label><input id="ib" name="ib" class="field" [(ngModel)]="f.iban"></div>
      <div><label class="label" for="lf">Late fine after due date (Rs)</label><input id="lf" name="lf" type="number" min="0" class="field" [(ngModel)]="f.late_fine"></div>
      <div><label class="label" for="dd">Usual due day of the month</label><input id="dd" name="dd" type="number" min="1" max="28" class="field" [(ngModel)]="f.due_day"></div>
    </div>
    <div><label class="label" for="nt">Instructions on the voucher (one per line)</label><textarea id="nt" name="nt" rows="5" class="field" [(ngModel)]="f.voucher_notes"></textarea></div>
    @if (error()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ error() }}</p> }
    <button class="btn-primary" type="submit">Save settings</button>
  </form>
  `
})
export class FeeSettingsPage {
  private api = inject(Api);
  private toast = inject(ToastService);
  error = signal('');
  f: FeeSettings = { bank_name: '', bank_branch: '', account_title: '', account_no: '', iban: '', late_fine: 100, due_day: 10, voucher_notes: '' };
  constructor() { this.api.get<FeeSettings>('/fee/settings').subscribe(s => this.f = s); }
  save() {
    this.error.set('');
    this.api.put<FeeSettings>('/fee/settings', this.f).subscribe({ next: s => { this.f = s; this.toast.show('Settings saved.'); }, error: e => this.error.set(errorText(e)) });
  }
}
