import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, Printer, ArrowLeft } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { FeePrintService, Institute, VoucherPrint } from './fee';
import { FeeVoucher } from './fee-voucher';

@Component({
  selector: 'app-fee-print',
  imports: [FeeVoucher, LucideAngularModule],
  template: `
  <div class="no-print flex flex-wrap items-center gap-4 mb-6">
    <button type="button" class="btn-ghost" (click)="back()"><lucide-icon [img]="backIcon" [size]="16" /> Back</button>
    <button type="button" class="btn-primary" (click)="print()" [disabled]="!vouchers().length"><lucide-icon [img]="printIcon" [size]="16" /> Print {{ vouchers().length }} voucher{{ vouchers().length === 1 ? '' : 's' }}</button>
    <p class="text-sm font-bold text-slate-400 basis-full md:basis-auto">In the print window choose paper A4, Landscape, and turn on "Background graphics". Each student gets one page with three copies.</p>
  </div>
  @if (error()) { <p role="alert" class="no-print p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
  @if (loaded() && !vouchers().length && !error()) { <p class="no-print text-sm font-bold text-slate-400">There is nothing to print. Open a voucher from the list and press Print.</p> }

  <div class="print-area overflow-x-auto">
    @if (inst(); as i) {
      @for (v of vouchers(); track v.id; let last = $last) {
        <div class="mb-6 print:mb-0 w-fit shadow-enterprise print:shadow-none"><app-fee-voucher [v]="v" [inst]="i" [class.last]="last" /></div>
      }
    }
  </div>
  `
})
export class FeePrint {
  private api = inject(Api);
  private router = inject(Router);
  private store = inject(FeePrintService);
  printIcon = Printer; backIcon = ArrowLeft;
  vouchers = signal<VoucherPrint[]>([]);
  inst = signal<Institute | null>(null);
  error = signal('');
  loaded = signal(false);

  constructor() {
    const ids = this.store.get();
    if (!ids.length) { this.loaded.set(true); return; }
    this.api.post<{ vouchers: VoucherPrint[]; institute: Institute }>('/fee/vouchers/print-data', { ids }).subscribe({
      next: r => { this.vouchers.set(r.vouchers); this.inst.set(r.institute); this.loaded.set(true); },
      error: e => { this.error.set(errorText(e)); this.loaded.set(true); }
    });
  }
  print() { window.print(); }
  back() { history.length > 1 ? history.back() : this.router.navigateByUrl('/fee/vouchers'); }
}
