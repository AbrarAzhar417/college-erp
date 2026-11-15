import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';

interface Item { id: number; code: string | null; name: string; category: string; location: string | null; unit: string; qty_good: number; qty_damaged: number; qty_lost: number; qty_disposed: number; qty_total: number; purchase_date: string | null; cost: number | null; notes: string | null }
interface Ev { id: number; date: string; kind: string; qty: number; note: string | null; by_name: string | null }
interface Rep { items: (Item & { value: number })[]; events: { date: string; kind: string; qty: number; note: string | null; by_name: string | null; name: string; location: string | null }[]; totals: { damaged: number; lost: number; value: number } }
const q = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;

@Component({
  selector: 'app-inventory',
  imports: [FormsModule],
  template: `
  <div class="max-w-6xl mx-auto pb-16 space-y-6">
    <div class="flex flex-wrap items-end gap-3"><div class="flex-1"><h2 class="text-3xl font-black tracking-tighter">Inventory & Lab Equipment</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Furniture and equipment, with what is good, damaged or lost. Every change is kept as an entry.</p></div>
      <div class="no-print flex gap-2"><button type="button" class="btn-ghost" [class.!bg-indigo-600]="tab() === 'stock'" (click)="tab.set('stock')">Stock</button>
        @if (office()) { <button type="button" class="btn-ghost" [class.!bg-indigo-600]="tab() === 'damage'" (click)="tab.set('damage'); loadReport()">Damage report</button> }</div></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (tab() === 'stock') {
      <div class="no-print flex flex-wrap gap-3 items-end">
        <div><label class="label" for="i-cat">Category</label><select id="i-cat" class="field" [ngModel]="cat()" (ngModelChange)="cat.set($event); load()"><option value="">All</option>@for (c of cats(); track c) { <option [value]="c">{{ c }}</option> }</select></div>
        <div><label class="label" for="i-q">Search</label><input id="i-q" class="field" [ngModel]="search()" (ngModelChange)="search.set($event)" (keyup.enter)="load()"></div>
        <label class="flex items-center gap-2 text-sm font-bold pb-2"><input type="checkbox" [ngModel]="problem()" (ngModelChange)="problem.set($event); load()"> Only damaged / lost</label>
        <button type="button" class="btn-ghost" (click)="csv()">Download CSV</button><button type="button" class="btn-ghost" (click)="print()">Print stock sheet</button>
        @if (office()) { <button type="button" class="btn-primary" (click)="adding.set(!adding())">Add item</button> }
      </div>
      @if (adding()) {
        <div class="no-print p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 grid sm:grid-cols-3 gap-3">
          <div><label class="label" for="n-name">Name</label><input id="n-name" class="field" [(ngModel)]="f.name"></div>
          <div><label class="label" for="n-cat">Category</label><select id="n-cat" class="field" [(ngModel)]="f.category">@for (c of cats(); track c) { <option [value]="c">{{ c }}</option> }</select></div>
          <div><label class="label" for="n-loc">Room / location</label><input id="n-loc" class="field" [(ngModel)]="f.location"></div>
          <div><label class="label" for="n-code">Code</label><input id="n-code" class="field" [(ngModel)]="f.code"></div>
          <div><label class="label" for="n-qty">Quantity</label><input id="n-qty" type="number" min="0" class="field" [(ngModel)]="f.qty"></div>
          <div><label class="label" for="n-cost">Cost of one (Rs)</label><input id="n-cost" type="number" min="0" class="field" [(ngModel)]="f.cost"></div>
          <div class="sm:col-span-3"><button type="button" class="btn-primary" (click)="create()">Save item</button></div>
        </div>
      }
      <div class="overflow-x-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800">
        <table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-4 py-3">Item</th><th class="px-3 py-3">Where</th><th class="px-3 py-3">Total</th><th class="px-3 py-3">Good</th><th class="px-3 py-3">Damaged</th><th class="px-3 py-3">Lost</th><th class="px-3 py-3">Written off</th><th class="px-3 py-3 no-print"></th></tr></thead>
        <tbody>@for (i of items(); track i.id) {
          <tr class="border-t border-slate-100 dark:border-slate-800"><td class="px-4 py-3 font-black">{{ i.name }} <span class="text-xs text-slate-400 font-bold">{{ i.code }} {{ i.category }}</span></td><td class="px-3 py-3 font-bold">{{ i.location }}</td>
            <td class="px-3 py-3 font-black">{{ i.qty_total }}</td><td class="px-3 py-3 font-bold">{{ i.qty_good }}</td>
            <td class="px-3 py-3 font-black" [class.text-amber-600]="i.qty_damaged">{{ i.qty_damaged }}</td><td class="px-3 py-3 font-black" [class.text-rose-600]="i.qty_lost">{{ i.qty_lost }}</td><td class="px-3 py-3 font-bold">{{ i.qty_disposed }}</td>
            <td class="px-3 py-3 no-print whitespace-nowrap"><button type="button" class="btn-ghost !py-1 !px-3 text-xs" (click)="select(i)">{{ office() ? 'Update' : 'Report damage' }}</button></td></tr>
          @if (sel()?.id === i.id) {
            <tr class="no-print bg-slate-50 dark:bg-slate-900/60"><td colspan="8" class="px-4 py-4"><div class="flex flex-wrap gap-3 items-end">
              <div><label class="label" for="e-kind">What happened</label><select id="e-kind" class="field" [(ngModel)]="ev.kind">@for (k of eventKinds(); track k[0]) { <option [value]="k[0]">{{ k[1] }}</option> }</select></div>
              <div><label class="label" for="e-qty">How many</label><input id="e-qty" type="number" min="1" class="field !w-24" [(ngModel)]="ev.qty"></div>
              <div class="flex-1 min-w-[14rem]"><label class="label" for="e-note">Note</label><input id="e-note" class="field" [(ngModel)]="ev.note" placeholder="what is damaged, how it happened"></div>
              <button type="button" class="btn-primary" (click)="apply(i)">Save</button></div>
              <div class="mt-3 text-xs font-bold text-slate-500">@for (e of history(); track e.id) { <p>{{ e.date }} · {{ e.kind }} {{ e.qty }}{{ e.note ? ' · ' + e.note : '' }}{{ e.by_name ? ' · ' + e.by_name : '' }}</p> }</div></td></tr>
          }
        } @empty { <tr><td colspan="8" class="p-8 text-center font-bold text-slate-400">Nothing here yet.</td></tr> }</tbody></table>
      </div>
    } @else if (rep(); as r) {
      <div class="flex gap-3 flex-wrap items-center"><span class="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-700 text-xs font-black">{{ r.totals.damaged }} damaged</span><span class="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 text-xs font-black">{{ r.totals.lost }} lost</span>
        <span class="px-3 py-1.5 rounded-xl bg-slate-500/10 text-xs font-black">Value Rs {{ r.totals.value }}</span><button type="button" class="btn-ghost no-print ml-auto" (click)="print()">Print</button></div>
      <div class="overflow-x-auto bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-slate-800"><table class="w-full text-left text-sm"><thead><tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest"><th class="px-4 py-3">Item</th><th class="px-3 py-3">Where</th><th class="px-3 py-3">Damaged</th><th class="px-3 py-3">Lost</th><th class="px-3 py-3">Value (Rs)</th></tr></thead>
        <tbody>@for (i of r.items; track i.id) { <tr class="border-t border-slate-100 dark:border-slate-800"><td class="px-4 py-3 font-black">{{ i.name }}</td><td class="px-3 py-3 font-bold">{{ i.location }}</td><td class="px-3 py-3 font-bold">{{ i.qty_damaged }}</td><td class="px-3 py-3 font-bold">{{ i.qty_lost }}</td><td class="px-3 py-3 font-bold">{{ i.cost == null ? '-' : i.value }}</td></tr>
          } @empty { <tr><td colspan="5" class="p-8 text-center font-bold text-slate-400">Nothing damaged or lost.</td></tr> }</tbody></table></div>
      <h3 class="font-black">Recent entries</h3>
      @for (e of r.events; track $index) { <p class="text-sm font-bold border-t border-slate-100 dark:border-slate-800 py-1.5">{{ e.date }} · {{ e.name }} ({{ e.location }}) · {{ e.kind }} {{ e.qty }}{{ e.note ? ' · ' + e.note : '' }}{{ e.by_name ? ' · ' + e.by_name : '' }}</p> }
    }
  </div>
  `
})
export class Inventory {
  private api = inject(Api); private toast = inject(ToastService); private auth = inject(AuthService);
  tab = signal<'stock' | 'damage'>('stock'); items = signal<Item[]>([]); rep = signal<Rep | null>(null); cats = signal<string[]>([]); error = signal('');
  cat = signal(''); search = signal(''); problem = signal(false); adding = signal(false); sel = signal<Item | null>(null); history = signal<Ev[]>([]);
  f = { name: '', category: 'other', location: '', code: '', qty: 1, cost: null as number | null };
  ev = { kind: 'damaged', qty: 1, note: '' };
  office = computed(() => ['director', 'principal', 'admin'].includes(this.auth.user()?.role ?? ''));
  eventKinds = computed<[string, string][]>(() => this.office() ? [['damaged', 'Damaged'], ['repaired', 'Repaired'], ['lost', 'Lost'], ['disposed', 'Written off (damaged)'], ['added', 'More added']] : [['damaged', 'Damaged']]);
  constructor() { this.api.get<string[]>('/inventory/categories').subscribe({ next: c => this.cats.set(c) }); this.load(); }
  load() { this.api.get<Item[]>('/inventory', { category: this.cat() || undefined, q: this.search() || undefined, problem: this.problem() ? 1 : undefined }).subscribe({ next: i => { this.items.set(i); this.error.set(''); }, error: e => this.error.set(errorText(e)) }); }
  loadReport() { this.api.get<Rep>('/inventory/report/damage').subscribe({ next: r => this.rep.set(r), error: e => this.error.set(errorText(e)) }); }
  select(i: Item) {
    if (this.sel()?.id === i.id) { this.sel.set(null); return; }
    this.sel.set(i); this.ev = { kind: 'damaged', qty: 1, note: '' };
    this.api.get<Ev[]>(`/inventory/${i.id}/events`).subscribe({ next: h => this.history.set(h), error: () => this.history.set([]) });
  }
  create() {
    this.api.post('/inventory', { ...this.f, location: this.f.location || null, code: this.f.code || null }).subscribe({
      next: () => { this.toast.show('Item added.'); this.adding.set(false); this.f = { name: '', category: 'other', location: '', code: '', qty: 1, cost: null }; this.load(); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
  apply(i: Item) {
    this.api.post(`/inventory/${i.id}/event`, this.ev).subscribe({ next: () => { this.toast.show('Saved.'); this.sel.set(null); this.load(); }, error: e => this.toast.show(errorText(e), 'error') });
  }
  print() { window.print(); }
  csv() {
    const lines = [['Code', 'Name', 'Category', 'Location', 'Total', 'Good', 'Damaged', 'Lost', 'Written off', 'Cost each'].map(q).join(',')];
    for (const i of this.items()) lines.push([i.code, i.name, i.category, i.location, i.qty_total, i.qty_good, i.qty_damaged, i.qty_lost, i.qty_disposed, i.cost].map(q).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })); a.download = 'inventory.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
}
