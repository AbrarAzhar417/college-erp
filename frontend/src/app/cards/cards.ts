import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Api, errorText } from '../core/api';
import { ClassInfo } from '../core/models';
import { qrSvg } from '../core/qr';
import { SettingsService } from '../core/settings';
import { avatarOf } from '../core/avatar';

interface Card {
  id: number; photo: string | null; name: string; father_name: string; reg_no: string; roll_no: number | null; dob: string | null; gender: string; class_name: string; section_name: string;
  phone: string | null; father_phone: string | null; address: string | null;
  route: string | null; stop: string | null; mode: string | null; bus: string | null; driver: string | null; driver_phone: string | null; morning: string | null; afternoon: string | null; pickup: string | null; drop_at: string | null;
}
interface Data { institute: string; short: string; address: string; phone: string; principal: string; session: string; hasLogo: boolean; cards: Card[] }
interface Found { id: number; name: string; reg_no: string; class_name: string; section_name: string }
type Kind = 'id' | 'transport';
const MODE: Record<string, string> = { both: 'Pick & Drop', pickup: 'Pick up only', drop: 'Drop only' };

/** Student ID cards and transport (TPT) cards, credit-card size, ten to an A4 page. The principal checks and signs each one. */
@Component({
  selector: 'app-cards',
  imports: [FormsModule],
  styles: [`
    @media print { @page { size: A4 portrait; margin: 0; } .sheetp { margin: 0 !important; box-shadow: none !important; } }
    * { box-sizing: border-box; }
    .sheetp { width: 210mm; max-width: 100%; margin: 0 auto 6mm; padding: 13mm 19mm; background: #fff; display: grid; grid-template-columns: repeat(2, 85.6mm); grid-auto-rows: 54mm; justify-content: center; box-shadow: 0 1px 6px #0003; break-after: page; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow: hidden; }
    .sheetp:last-child { break-after: auto; }
    .card { position: relative; width: 85.6mm; height: 54mm; border: .2mm dashed #aaa; overflow: hidden; font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; display: flex; flex-direction: column; }
    .band { display: flex; align-items: center; gap: 2mm; padding: 1.2mm 2.5mm; color: #fff; background: #1e1b4b; } .tpt .band { background: #b45309; }
    .band img { width: 7mm; height: 7mm; object-fit: contain; background: #fff; border-radius: 50%; } .band .ini { width: 7mm; height: 7mm; border-radius: 50%; background: #fff; color: #1e1b4b; font-weight: 800; font-size: 8pt; display: grid; place-items: center; }
    .band b { display: block; font-size: 7.6pt; line-height: 1.1; text-transform: uppercase; } .band small { font-size: 5.8pt; opacity: .9; }
    .tag { margin-left: auto; text-align: center; background: #fff; color: #b45309; font-weight: 900; font-size: 10pt; padding: .4mm 2mm; border-radius: 1mm; letter-spacing: .08em; } .id .tag { color: #1e1b4b; font-size: 6.5pt; }
    .body { flex: 1; display: flex; gap: 2.5mm; padding: 2mm 2.5mm 0; min-height: 0; }
    .ph { width: 21mm; height: 26mm; border: .25mm solid #555; flex: none; background: #eee; display: grid; place-items: center; font-size: 14pt; font-weight: 800; color: #888; overflow: hidden; } .ph img { width: 100%; height: 100%; object-fit: cover; }
    dl { margin: 0; font-size: 6.6pt; line-height: 1.35; flex: 1; min-width: 0; } dl div { display: flex; gap: 1mm; } dt { width: 11mm; color: #555; flex: none; } dd { margin: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    dl .nm { font-size: 8.6pt; font-weight: 800; white-space: normal; line-height: 1.15; margin-bottom: .8mm; display: block; }
    .qr { width: 15mm; height: 15mm; flex: none; align-self: flex-start; margin-left: auto; } .qr svg { width: 100%; height: 100%; display: block; }
    .foot { display: flex; justify-content: space-between; align-items: flex-end; padding: 0 2.5mm 1.5mm; font-size: 6pt; color: #444; height: 9mm; }
    .sgn { text-align: center; min-width: 26mm; border-top: .25mm solid #111; padding-top: .3mm; font-size: 5.8pt; color: #111; }
    .back .body { display: block; font-size: 6.4pt; line-height: 1.4; padding-top: 2mm; } .back p { margin: 0 0 1mm; } .back ul { margin: 0; padding-left: 3.5mm; } .back li { margin: 0 0 .5mm; }
  `],
  template: `
  <div class="no-print max-w-5xl mx-auto pb-6 space-y-5">
    <div><h2 class="text-3xl font-black tracking-tighter">ID &amp; Transport Cards</h2>
      <p class="text-sm font-bold text-slate-400 mt-2">Credit-card size cards with the student's photo, ten on one A4 page. The Transport (TPT) card is made only for students who use a bus. Print, then the Principal checks each card and signs in the box.</p></div>
    @if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 items-end bg-white dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-800">
      <div class="col-span-2"><label class="label" for="cd-kind">Card</label><select id="cd-kind" class="field" [ngModel]="kind()" (ngModelChange)="kind.set($event); data.set(null)"><option value="id">Student ID card</option><option value="transport">Transport card (TPT)</option></select></div>
      <div><label class="label" for="cd-class">Class</label><select id="cd-class" class="field" [ngModel]="classId()" (ngModelChange)="classId.set($event); sectionId.set(null); data.set(null)"><option [ngValue]="null">Choose…</option>@for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></div>
      <div><label class="label" for="cd-sec">Section</label><select id="cd-sec" class="field" [ngModel]="sectionId()" (ngModelChange)="sectionId.set($event); data.set(null)" [disabled]="!classId()"><option [ngValue]="null">Whole class</option>@for (s of sections(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }</select></div>
      <div class="col-span-2 md:col-span-4"><label class="label" for="cd-find">Or one student (name or admission no)</label>
        <input id="cd-find" class="field" [ngModel]="q()" (ngModelChange)="find($event)" autocomplete="off" placeholder="Type to search…">
        @if (found().length) { <ul class="mt-2 flex flex-wrap gap-2">@for (f of found(); track f.id) { <li><button type="button" class="btn-ghost" (click)="loadOne(f.id)">{{ f.name }} · {{ f.class_name }}-{{ f.section_name }}</button></li> }</ul> }</div>
      <div class="col-span-2 md:col-span-4 flex flex-wrap gap-3 items-center">
        <button type="button" class="btn-primary" [disabled]="!classId() || busy()" (click)="loadClass()">Prepare cards</button>
        @if (data(); as d) {
          <label class="flex items-center gap-2 text-sm font-bold"><input type="radio" name="side" [checked]="side() === 'front'" (change)="side.set('front')"> Front</label>
          <label class="flex items-center gap-2 text-sm font-bold"><input type="radio" name="side" [checked]="side() === 'back'" (change)="side.set('back')"> Back</label>
          <button type="button" class="btn-ghost" (click)="print()">Print {{ side() }} of {{ d.cards.length }} card(s)</button>
        }
      </div>
      @if (data(); as d) { <p class="col-span-2 md:col-span-4 text-xs font-bold text-slate-400">Print the fronts first. Put the printed pages back in the printer the other way round and print the backs: the back order is already mirrored so each back lands behind its own front (check once with one page). {{ noPhoto() }} card(s) have no photo; add it in the student's profile.</p> }
    </div>
  </div>

  @if (data(); as d) {
    @for (pg of pages(); track $index) {
      <section class="sheetp" [class.tpt]="kind() === 'transport'" [class.id]="kind() === 'id'">
        @for (c of pg; track $index) {
          @if (c) {
            @if (side() === 'front') {
              <article class="card" [class.tpt]="kind() === 'transport'" [class.id]="kind() === 'id'">
                <div class="band">@if (d.hasLogo) { <img src="/api/settings/logo" alt=""> } @else { <span class="ini">{{ d.short.slice(0, 2) || 'C' }}</span> }
                  <div><b>{{ d.institute }}</b><small>{{ kind() === 'id' ? 'Student Identity Card' : 'Transport Card' }} · {{ d.session }}</small></div>
                  <span class="tag">{{ kind() === 'transport' ? 'TPT' : 'ID' }}</span></div>
                <div class="body">
                  <div class="ph"><img [src]="c.photo || avatar(c.gender)" alt=""></div>
                  <dl>
                    <span class="nm" dir="auto">{{ c.name }}</span>
                    <div><dt>S/O</dt><dd dir="auto">{{ c.father_name }}</dd></div>
                    <div><dt>Class</dt><dd>{{ c.class_name }}-{{ c.section_name }}@if (c.roll_no) { &nbsp; Roll {{ c.roll_no }} }</dd></div>
                    <div><dt>Adm. no</dt><dd>{{ c.reg_no }}</dd></div>
                    @if (kind() === 'id') {
                      @if (c.dob) { <div><dt>DOB</dt><dd>{{ c.dob }}</dd></div> }
                      <div><dt>Contact</dt><dd>{{ c.father_phone || c.phone || '-' }}</dd></div>
                    } @else {
                      <div><dt>Route</dt><dd>{{ c.route }}</dd></div>
                      <div><dt>Stop</dt><dd>{{ c.stop || '-' }}</dd></div>
                      <div><dt>Bus</dt><dd>{{ c.bus || '-' }} &nbsp; {{ mode(c.mode) }}</dd></div>
                    }
                  </dl>
                  <div class="qr" [innerHTML]="qr(c.reg_no)"></div>
                </div>
                <div class="foot"><span>Valid: session {{ d.session }}</span><div class="sgn">{{ d.principal }}<br>Principal (checked &amp; signed)</div></div>
              </article>
            } @else {
              <article class="card back" [class.tpt]="kind() === 'transport'" [class.id]="kind() === 'id'">
                <div class="band"><div><b>{{ d.institute }}</b><small>{{ d.address }}{{ d.address && d.phone ? ' · ' : '' }}{{ d.phone }}</small></div></div>
                <div class="body">
                  @if (kind() === 'id') {
                    <div><p><b>Student:</b> <span dir="auto">{{ c.name }}</span> · S/O <span dir="auto">{{ c.father_name }}</span></p>
                      @if (c.address) { <p><b>Address:</b> {{ c.address }}</p> }
                      <p><b>Emergency contact:</b> {{ c.father_phone || c.phone || '-' }}</p>
                      <ul><li>This card must be carried every day.</li><li>Report a lost card to the office at once.</li><li>If found, please return it to the college office.</li></ul></div>
                  } @else {
                    <div><p><b>Bus:</b> {{ c.bus || '-' }} · <b>Route:</b> {{ c.route }} · <b>Stop:</b> {{ c.stop || '-' }}</p>
                      <p><b>Timing:</b> Morning {{ c.pickup || c.morning || '-' }} · Return {{ c.drop_at || c.afternoon || '-' }}</p>
                      @if (c.driver) { <p><b>Driver:</b> {{ c.driver }} {{ c.driver_phone }}</p> }
                      <ul><li>Show this card to the conductor when boarding.</li><li>The card is not transferable; only the named student may use it.</li><li>Be at the stop 5 minutes early. Report a lost card to the office.</li></ul></div>
                  }
                </div>
              </article>
            }
          } @else { <div></div> }
        }
      </section>
    }
  }
  `
})
export class Cards {
  private api = inject(Api); private san = inject(DomSanitizer); private settings = inject(SettingsService);
  classes = signal<ClassInfo[]>([]); classId = signal<number | null>(null); sectionId = signal<number | null>(null);
  kind = signal<Kind>('id'); side = signal<'front' | 'back'>('front'); data = signal<Data | null>(null);
  busy = signal(false); error = signal(''); q = signal(''); found = signal<Found[]>([]);
  sections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  noPhoto = computed(() => this.data()?.cards.filter(c => !c.photo).length ?? 0);
  /** Ten cards per page (2 x 5); the back side is mirrored left to right so it lines up behind the front. */
  pages = computed(() => {
    const cards = this.data()?.cards ?? [], out: (Card | null)[][] = [];
    for (let i = 0; i < cards.length; i += 10) {
      const pg: (Card | null)[] = Array.from({ length: 10 }, (_, k) => cards[i + k] ?? null);
      if (this.side() === 'back') for (let r = 0; r < 10; r += 2) { const t = pg[r]; pg[r] = pg[r + 1]; pg[r + 1] = t; }
      out.push(pg);
    }
    return out;
  });
  private qrCache = new Map<string, SafeHtml>();
  qr(text: string): SafeHtml { let v = this.qrCache.get(text); if (!v) { try { v = this.san.bypassSecurityTrustHtml(qrSvg(`${this.settings.publicUrl() || location.origin}/scan/${encodeURIComponent(text)}`)); } catch { v = ''; } this.qrCache.set(text, v); } return v; }
  avatar = avatarOf;
  mode = (m: string | null) => (m ? MODE[m] ?? '' : '');

  constructor() { this.api.get<ClassInfo[]>('/classes').subscribe({ next: c => this.classes.set(c), error: e => this.error.set(errorText(e)) }); }

  private fetch(params: Record<string, string | number | undefined>) {
    this.busy.set(true); this.error.set('');
    this.api.get<Data>('/cards', { kind: this.kind(), ...params }).subscribe({
      next: r => { this.busy.set(false); this.data.set(r); if (!r.cards.length) this.error.set(this.kind() === 'transport' ? 'No student of this selection uses a bus (set the route in the student profile).' : 'No student found.'); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  loadClass() { this.fetch({ classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined }); }
  loadOne(id: number) { this.found.set([]); this.fetch({ studentIds: String(id) }); }
  find(v: string) {
    this.q.set(v);
    if (v.trim().length < 2) { this.found.set([]); return; }
    this.api.get<{ items: Found[] }>('/students', { q: v.trim(), limit: 8 }).subscribe({ next: r => this.found.set(r.items), error: () => this.found.set([]) });
  }
  print() { window.print(); }
}
