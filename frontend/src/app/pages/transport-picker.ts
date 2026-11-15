import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface TrStop { id: number; name: string; pickup_time?: string | null; drop_time?: string | null; fee_both: number | null; fee_one: number | null }
export interface TrRoute {
  id: number; name: string; area?: string | null; bus: string | null; capacity: number | null; used: number; morning_time?: string | null; afternoon_time?: string | null;
  fee_both: number; fee_one: number | null; stops: TrStop[];
}
const rs = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-US');

/**
 * Choose the school bus: route (with seats left and fee), stop (with its pick-up and drop times) and pick/drop mode (with the fee of each).
 * Shows the monthly fee and the times the student will be picked up and dropped, and warns when the bus is already full.
 */
@Component({
  selector: 'app-transport-picker',
  imports: [FormsModule],
  template: `
  <fieldset class="md:col-span-2 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50 space-y-3">
    <legend class="label !ml-0 px-1">Transport (school bus)</legend>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div><label class="label" for="tp-route">Route</label>
        <select id="tp-route" class="field" [ngModel]="routeId()" (ngModelChange)="pickRoute($event)" name="tp-route">
          <option [ngValue]="null">Does not need transport</option>
          @for (r of routes(); track r.id) { <option [ngValue]="r.id">{{ r.name }} · {{ money(r.fee_both) }}{{ seatText(r) }}</option> }
        </select></div>
      <div><label class="label" for="tp-stop">Stop</label>
        <select id="tp-stop" class="field" [ngModel]="stopId()" (ngModelChange)="stopId.set($event)" name="tp-stop" [disabled]="!route()">
          <option [ngValue]="null">{{ route()?.stops?.length ? 'Choose the stop' : 'Whole route' }}</option>
          @for (p of route()?.stops ?? []; track p.id) { <option [ngValue]="p.id">{{ p.name }}{{ stopHint(p) }}</option> }
        </select></div>
      <div><label class="label" for="tp-mode">Pick and drop</label>
        <select id="tp-mode" class="field" [ngModel]="mode()" (ngModelChange)="mode.set($event)" name="tp-mode" [disabled]="!route()">
          <option value="both">Pick and drop · {{ money(feeOf('both')) }}</option><option value="pickup">Pick up only (morning) · {{ money(feeOf('pickup')) }}</option><option value="drop">Drop only (afternoon) · {{ money(feeOf('drop')) }}</option>
        </select></div>
    </div>
    @if (route(); as r) {
      <div class="text-xs font-bold text-slate-600 dark:text-slate-300 space-y-1" aria-live="polite">
        <p>Monthly transport fee: <b>{{ money(fee()) }}</b>. It is added to the monthly fee voucher on its own.</p>
        @if (times(); as t) { <p>{{ t }}</p> }
        @if (r.bus) { <p>{{ r.bus }}{{ r.capacity ? ' · ' + left() + ' of ' + r.capacity + ' seats left' : '' }}</p> }
        @if (full()) { <p role="alert" class="p-2 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">This bus is already full. You can still add the student, but the route will have more students than seats.</p> }
      </div>
    }
  </fieldset>
  `
})
export class TransportPicker {
  routes = input.required<TrRoute[]>();
  /** The route the student is already saved on, so his own seat is not counted against him. */
  savedRouteId = input<number | null>(null);
  routeId = model<number | null>(null); stopId = model<number | null>(null); mode = model<string>('both');
  money = rs;

  route = computed(() => this.routes().find(r => r.id === this.routeId()) ?? null);
  stop = computed(() => this.route()?.stops.find(s => s.id === this.stopId()) ?? null);
  feeOf = (m: string) => {
    const r = this.route(); if (!r) return 0; const s = this.stop(), both = s?.fee_both ?? r.fee_both ?? 0;
    return m === 'both' ? both : (s?.fee_one ?? r.fee_one ?? both);
  };
  fee = computed(() => this.feeOf(this.mode()));
  left = computed(() => { const r = this.route(); return r?.capacity ? r.capacity - r.used + (this.savedRouteId() === r.id ? 1 : 0) : 0; });
  full = computed(() => { const r = this.route(); return !!r?.capacity && this.left() <= 0; });
  times = computed(() => {
    const r = this.route(); if (!r) return '';
    const s = this.stop(), up = s?.pickup_time || r.morning_time, dn = s?.drop_time || r.afternoon_time, m = this.mode();
    const parts: string[] = [];
    if (m !== 'drop' && up) parts.push('Picked up at ' + up);
    if (m !== 'pickup' && dn) parts.push('dropped at ' + dn);
    return parts.join(', ');
  });

  seatText(r: TrRoute) {
    if (!r.capacity) return '';
    const left = r.capacity - r.used + (this.savedRouteId() === r.id ? 1 : 0);
    return left > 0 ? ` · ${left} seats left` : ' · FULL';
  }
  stopHint(p: TrStop) {
    const bits: string[] = [];
    if (p.pickup_time) bits.push(p.pickup_time);
    if (p.fee_both != null && p.fee_both !== this.route()?.fee_both) bits.push(rs(p.fee_both));
    return bits.length ? ' · ' + bits.join(' · ') : '';
  }
  pickRoute(id: number | null) { this.routeId.set(id); this.stopId.set(null); }
}
