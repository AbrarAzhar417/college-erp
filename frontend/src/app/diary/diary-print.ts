import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, Printer } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { SettingsService } from '../core/settings';

interface Entry { id: number; subject: string | null; kind: string; title: string; body: string; due_date: string | null; posted_by: string }
const nice = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One day of one class, on one page, to hand out or pin up. The parent signs at the bottom. */
@Component({
  selector: 'app-diary-print',
  imports: [LucideAngularModule],
  styles: [`
    @media print { @page { size: A4 portrait; margin: 12mm; } }
    .page { max-width: 190mm; margin: 0 auto; background: #fff; color: #111; padding: 10mm; font-size: 11pt; }
    h1 { font-size: 16pt; margin: 0; } .sub { color: #555; margin: 1mm 0 4mm; }
    .row { border-top: .3mm solid #999; padding: 2.5mm 0; } .row b { display: inline-block; min-width: 28mm; }
    .tag { font-size: 8.5pt; border: .3mm solid #666; border-radius: 2mm; padding: 0 1.5mm; margin-left: 2mm; text-transform: uppercase; }
    .due { font-size: 9pt; color: #b00; } .sign { display: flex; justify-content: space-between; margin-top: 18mm; font-size: 9pt; } .sign div { border-top: .3mm solid #000; padding-top: 1mm; width: 60mm; text-align: center; }
  `],
  template: `
  <div class="no-print flex gap-3 mb-4"><button type="button" class="btn-primary inline-flex items-center gap-2" (click)="print()"><lucide-icon [img]="printIcon" [size]="16" /> Print</button></div>
  @if (error()) { <p role="alert" class="text-rose-600 font-bold">{{ error() }}</p> }
  <section class="page">
    @if (cfg.logoUrl()) { <img [src]="cfg.logoUrl()" alt="" style="height:14mm;width:auto;display:block;margin:0 auto 2mm"> }
    <h1>{{ cfg.instituteName() }} - Daily Diary</h1>
    <p class="sub">{{ label() }} · {{ date() ? nice(date()) : '' }}</p>
    @for (e of entries(); track e.id) {
      <div class="row"><b>{{ e.subject || 'General' }}</b><span class="tag">{{ e.kind }}</span><div><strong>{{ e.title }}</strong>@if (e.body) { <div style="white-space:pre-line">{{ e.body }}</div> }@if (e.due_date) { <div class="due">Due {{ nice(e.due_date) }}</div> }</div></div>
    } @empty { <p class="row">No entries for this day.</p> }
    <div class="sign"><div>Class teacher</div><div>Parent / guardian signature</div></div>
  </section>
  `
})
export class DiaryPrint {
  private api = inject(Api); cfg = inject(SettingsService); nice = nice; printIcon = Printer;
  entries = signal<Entry[]>([]); date = signal(''); label = signal(''); error = signal('');
  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap, section = Number(q.get('section_id')), date = q.get('date') ?? '';
    this.date.set(date);
    this.api.get<{ today: string; sections: { id: number; label: string }[] }>('/diary/scope').subscribe({ next: s => this.label.set(s.sections.find(x => x.id === section)?.label ?? '') });
    this.api.get<Entry[]>('/diary/class', { section_id: section, date }).subscribe({ next: r => this.entries.set(r), error: e => this.error.set(errorText(e)) });
  }
  print() { window.print(); }
}
