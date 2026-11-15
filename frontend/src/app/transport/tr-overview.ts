import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Overview, money, seatClass } from './tr';

@Component({
  selector: 'app-tr-overview',
  imports: [RouterLink],
  template: `
  <div class="space-y-6">
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }
    @if (o(); as x) {
      <section class="grid grid-cols-2 xl:grid-cols-5 gap-5">
        @for (k of kpis(); track k.label) { <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-enterprise"><p class="text-3xl font-black tracking-tighter" [class]="k.cls">{{ k.value }}</p><p class="text-xs font-bold text-slate-400 mt-1">{{ k.label }}</p></div> }
      </section>

      @if (x.alerts.length) {
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-3">
          <h3 class="text-lg font-black tracking-tight">Needs your attention ({{ x.alerts.length }})</h3>
          <ul class="space-y-2">@for (a of x.alerts; track $index) {
            <li><a [routerLink]="a.link" class="flex items-start gap-3 p-3 rounded-2xl text-sm font-bold hover:opacity-80" [class]="a.level === 'expired' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : a.level === 'soon' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-white/60 dark:bg-black/20">{{ a.level === 'expired' ? 'Expired' : a.level === 'soon' ? 'Soon' : 'Check' }}</span><span>{{ a.text }}</span></a></li> }</ul>
        </section>
      }

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        @for (r of x.routes; track r.id) {
          <a [routerLink]="['/transport/route', r.id]" class="block bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border-2 border-slate-200 dark:border-slate-800 hover:border-indigo-400 shadow-enterprise transition-all space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div><h3 class="text-xl font-black tracking-tight">{{ r.name }}</h3><p class="text-xs font-bold text-slate-400 mt-1">{{ r.bus || 'No bus yet' }}{{ r.driver ? ' · ' + r.driver : '' }}</p></div>
              <span class="px-3 py-1.5 rounded-xl bg-indigo-600/10 text-indigo-700 dark:text-indigo-300 text-sm font-black">{{ r.used }}</span>
            </div>
            <div><div class="flex justify-between text-xs font-black mb-1.5"><span>Seats</span><span [class]="r.capacity && r.used > r.capacity ? 'text-rose-500' : ''">{{ r.used }} of {{ r.capacity ?? '?' }}{{ r.capacity && r.used > r.capacity ? ' (too many)' : '' }}</span></div>
              <div class="h-3 rounded-full bg-slate-100 dark:bg-slate-950 overflow-hidden"><div class="h-full rounded-full transition-all" [class]="sc(r.used, r.capacity)" [style.width.%]="r.capacity ? min(100, (r.used / r.capacity) * 100) : 0"></div></div></div>
            <p class="text-xs font-bold text-slate-500">{{ r.stops }} stops · morning {{ r.morning_time || '-' }} · fee Rs {{ m(r.monthly) }} a month</p>
          </a>
        }
      </div>
      @if (!x.routes.length) { <p class="text-sm font-bold text-slate-400">No routes yet. Add the first one in the Routes tab.</p> }
    }
  </div>
  `
})
export class TrOverview {
  private api = inject(Api);
  m = money; sc = seatClass; min = Math.min;
  o = signal<Overview | null>(null); error = signal('');
  kpis = computed(() => { const t = this.o()?.totals; if (!t) return []; return [
    { label: 'Students on buses', value: `${t.students}`, cls: '' }, { label: 'Of all students', value: t.active ? Math.round((t.students / t.active) * 100) + '%' : '-', cls: '' },
    { label: 'Buses and routes', value: `${t.vehicles} / ${t.routes}`, cls: '' }, { label: 'Seats in use', value: t.seats ? `${t.students} of ${t.seats}` : '-', cls: t.students > t.seats ? 'text-rose-500' : '' },
    { label: 'Transport fee a month', value: 'Rs ' + money(t.monthly), cls: 'text-emerald-600' }]; });
  constructor() { this.api.get<Overview>('/transport/overview').subscribe({ next: o => this.o.set(o), error: e => this.error.set(errorText(e)) }); }
}
