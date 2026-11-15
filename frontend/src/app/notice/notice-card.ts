import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';

interface N { id: number; title: string; body: string; pinned: number; publish_on: string; created_by_name: string | null; read: boolean }

/** Live notices for staff, for the dashboard and the teacher's home. Opening one marks it as read. */
@Component({
  selector: 'app-notice-card',
  template: `
  @if (list().length) {
    <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-enterprise" aria-label="Notice board">
      <h3 class="font-black mb-3">Notice board</h3>
      @for (n of list(); track n.id) {
        <details class="border-t border-slate-100 dark:border-slate-800 py-2" (toggle)="opened(n, $event)">
          <summary class="cursor-pointer text-sm font-black flex items-center gap-2">
            @if (n.pinned) { <span aria-label="Pinned">📌</span> }<span>{{ n.title }}</span>
            @if (!n.read) { <span class="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-black">NEW</span> }
            <span class="ml-auto text-xs font-bold text-slate-400">{{ n.publish_on }}</span></summary>
          <p class="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300 whitespace-pre-line">{{ n.body }}</p>
          @if (n.created_by_name) { <p class="mt-1 text-xs font-bold text-slate-400">{{ n.created_by_name }}</p> }
        </details>
      }
    </section>
  }
  `
})
export class NoticeCard {
  private api = inject(Api); list = signal<N[]>([]);
  constructor() { this.api.get<N[]>('/notices/active').subscribe({ next: l => this.list.set(l), error: () => {} }); }
  opened(n: N, ev: Event) {
    if (!(ev.target as HTMLDetailsElement).open || n.read) return;
    this.api.post(`/notices/${n.id}/read`, {}).subscribe({ next: () => this.list.update(l => l.map(x => x.id === n.id ? { ...x, read: true } : x)), error: () => {} });
  }
}
