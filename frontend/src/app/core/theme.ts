import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<'light' | 'dark'>(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light');

  constructor() {
    this.apply();
    window.addEventListener('beforeprint', () => document.documentElement.classList.remove('dark'));
    window.addEventListener('afterprint', () => this.apply());
  }

  toggle(ev?: MouseEvent) {
    const change = () => {
      this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
      try { localStorage.setItem('theme', this.theme()); } catch { /* ignore */ }
      this.apply();
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || calm) return change();
    const el = ev?.currentTarget as HTMLElement | undefined;
    const r = el?.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--tx', r ? `${r.left + r.width / 2}px` : '100%');
    root.setProperty('--ty', r ? `${r.top + r.height / 2}px` : '0%');
    doc.startViewTransition(change);
  }
  private apply() { document.documentElement.classList.toggle('dark', this.theme() === 'dark'); }
}
