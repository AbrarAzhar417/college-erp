import { Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorText } from '../core/api';

interface Hit { type: string; id: number; title: string; sub: string; link: string; query?: Record<string, string> }
interface Group { type: string; label: string; hits: Hit[] }

/** One search box for students, teachers, staff, fee papers, notices and enquiries. Type, pick with the arrows or the mouse, press Enter. */
@Component({
  selector: 'app-global-search',
  imports: [FormsModule],
  host: { class: 'block relative z-30' },
  template: `
  <div class="relative text-slate-900 dark:text-slate-100" (focusout)="onBlur($event)">
    <label class="sr-only" for="gs-box">Search students, teachers, phone numbers and more</label>
    <input #box id="gs-box" type="search" autocomplete="off" class="field py-4! text-base! rounded-2xl!" placeholder="Search a student, teacher, phone number, admission no, receipt or notice   ( press / )"
      [ngModel]="q()" (ngModelChange)="type($event)" (keydown)="key($event)" (focus)="open.set(true)" role="combobox" aria-expanded="true" aria-controls="gs-list">
    @if (open() && q().trim().length >= 2) {
      <div id="gs-list" role="listbox" class="absolute z-50 left-0 right-0 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 shadow-2xl p-2">
        @if (busy() && !flat().length) { <p class="p-4 text-sm font-bold text-slate-400">Searching...</p> }
        @else if (error()) { <p role="alert" class="p-4 text-sm font-bold text-rose-600">{{ error() }}</p> }
        @else if (!flat().length) { <p class="p-4 text-sm font-bold text-slate-400">Nothing found for "{{ q().trim() }}".</p> }
        @else {
          @for (g of groups(); track g.type) {
            <p class="px-3 pt-3 pb-1 text-[11px] font-black uppercase tracking-widest text-slate-400">{{ g.label }}</p>
            @for (h of g.hits; track h.type + h.id) {
              <button type="button" role="option" [attr.aria-selected]="flat()[active()] === h" class="w-full text-left px-3 py-2 rounded-xl flex flex-col" [class]="flat()[active()] === h ? 'bg-indigo-600 text-white' : 'text-slate-900 dark:text-slate-100 hover:bg-slate-500/10'"
                (mousedown)="$event.preventDefault()" (click)="go(h)" (mouseenter)="active.set(flat().indexOf(h))">
                <span class="font-black text-sm">{{ h.title }}</span><span class="text-xs font-bold" [class]="flat()[active()] === h ? 'text-white/80' : 'text-slate-500'">{{ h.sub }}</span>
              </button>
            }
          }
        }
      </div>
    }
  </div>`
})
export class GlobalSearch {
  private api = inject(Api); private router = inject(Router);
  box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  q = signal(''); open = signal(false); busy = signal(false); error = signal(''); groups = signal<Group[]>([]); active = signal(0);
  flat = () => this.groups().flatMap(g => g.hits);
  private timer: ReturnType<typeof setTimeout> | undefined; private seq = 0;

  type(v: string) {
    this.q.set(v); this.open.set(true); clearTimeout(this.timer);
    if (v.trim().length < 2) { this.groups.set([]); this.error.set(''); return; }
    this.timer = setTimeout(() => this.run(v.trim()), 220);
  }
  private run(v: string) {
    const mine = ++this.seq; this.busy.set(true);
    this.api.get<{ groups: Group[] }>('/search', { q: v }).subscribe({
      next: r => { if (mine !== this.seq) return; this.busy.set(false); this.error.set(''); this.groups.set(r.groups); this.active.set(0); },
      error: e => { if (mine !== this.seq) return; this.busy.set(false); this.error.set(errorText(e)); }
    });
  }
  key(ev: KeyboardEvent) {
    const n = this.flat().length;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (n) this.active.set((this.active() + 1) % n); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (n) this.active.set((this.active() - 1 + n) % n); }
    else if (ev.key === 'Enter') { ev.preventDefault(); const h = this.flat()[this.active()]; if (h) this.go(h); }
    else if (ev.key === 'Escape') { this.open.set(false); this.box().nativeElement.blur(); }
  }
  go(h: Hit) { this.open.set(false); this.q.set(''); this.groups.set([]); this.router.navigate([h.link], h.query ? { queryParams: h.query } : {}); }
  onBlur(ev: FocusEvent) { if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node | null)) this.open.set(false); }

  /** Pressing "/" anywhere on the page (outside a text box) jumps to the search. */
  @HostListener('document:keydown', ['$event'])
  slash(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey || (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable))) return;
    ev.preventDefault(); this.box().nativeElement.focus();
  }
}
