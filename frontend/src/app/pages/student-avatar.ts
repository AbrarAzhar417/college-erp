import { Component, ElementRef, Injectable, OnDestroy, OnInit, inject, input, signal } from '@angular/core';
import { Api } from '../core/api';
import { avatarOf } from '../core/avatar';

/** One request per student, remembered while the page is open. */
@Injectable({ providedIn: 'root' })
export class PhotoCache {
  private api = inject(Api);
  private seen = new Map<number, string | null>();
  private pending = new Map<number, Promise<string | null>>();
  load(id: number): Promise<string | null> {
    if (this.seen.has(id)) return Promise.resolve(this.seen.get(id)!);
    let p = this.pending.get(id);
    if (!p) {
      p = new Promise<string | null>(done => this.api.get<{ photo: string | null }>(`/students/${id}/photo`).subscribe({
        next: r => { this.seen.set(id, r.photo); done(r.photo); }, error: () => done(null)
      }));
      this.pending.set(id, p);
    }
    return p;
  }
  forget(id: number) { this.seen.delete(id); this.pending.delete(id); }
}

@Component({
  selector: 'app-student-avatar',
  template: `<img [src]="src() || place()" alt="" [class]="cls()">`
})
export class StudentAvatar implements OnInit, OnDestroy {
  id = input.required<number>(); name = input<string>(''); has = input<boolean>(false); gender = input<string>('male'); size = input<'sm' | 'lg'>('sm');
  place = () => avatarOf(this.gender());
  cls = () => (this.size() === 'lg' ? 'w-28 h-28 rounded-3xl object-cover border border-slate-200 dark:border-slate-700' : 'w-9 h-9 rounded-full object-cover');
  src = signal<string | null>(null);
  private el = inject(ElementRef<HTMLElement>);
  private cache = inject(PhotoCache);
  private io?: IntersectionObserver;
  initials = () => this.name().split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  ngOnInit() {
    if (!this.has()) return;
    if (typeof IntersectionObserver === 'undefined') { void this.fetch(); return; }
    this.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { this.io?.disconnect(); void this.fetch(); } }, { rootMargin: '200px' });
    this.io.observe(this.el.nativeElement);
  }
  private async fetch() { this.src.set(await this.cache.load(this.id())); }
  ngOnDestroy() { this.io?.disconnect(); }
}
