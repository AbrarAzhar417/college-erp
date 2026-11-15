import { fmtDate, money, today } from '../fee/fee';
export { fmtDate, money, today };

export interface Alert { level: 'expired' | 'soon' | 'warning'; text: string; days: number | null; link: string }
export interface RouteCard { id: number; name: string; area: string | null; morning_time: string | null; afternoon_time: string | null; fee_both: number; bus: string | null; capacity: number | null; driver: string | null; driver_phone: string | null; used: number; stops: number; monthly: number }
export interface Overview { routes: RouteCard[]; alerts: Alert[]; totals: { students: number; active: number; vehicles: number; routes: number; seats: number; monthly: number } }
export interface Rider {
  id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; phone: string | null; father_phone: string | null; category: string | null; class_name: string; section_name: string;
  tr_route_id: number | null; tr_stop_id: number | null; tr_mode: string | null; fee: number; dues: number; route?: string; bus?: string; stop?: string;
}
export interface Stop { id: number; route_id: number; name: string; sort: number; pickup_time: string | null; drop_time: string | null; fee_both: number | null; fee_one: number | null; students: Rider[] }
export interface Vehicle {
  id: number; number: string; reg_no: string | null; kind: string; capacity: number; make_model: string | null; year: number | null; driver_id: number | null; conductor_id: number | null;
  fitness_expiry: string | null; permit_expiry: string | null; insurance_expiry: string | null; tax_expiry: string | null; next_service: string | null; notes: string | null;
  driver?: string | null; conductor?: string | null; route?: string | null; route_id?: number | null; used?: number; driver_phone?: string | null; conductor_phone?: string | null;
}
export interface Staff { id: number; name: string; role: 'driver' | 'conductor'; phone: string | null; cnic: string | null; address: string | null; vehicles?: string | null }
export interface RouteRow { id: number; name: string; area: string | null; vehicle_id: number | null; morning_time: string | null; afternoon_time: string | null; fee_both: number; fee_one: number | null; note: string | null; bus?: string | null; capacity?: number | null; used?: number }
export interface RouteDetail {
  route: RouteRow; vehicle: Vehicle | null; stops: Stop[]; noStop: Rider[];
  totals: { students: number; capacity: number; left: number; monthly: number; dues: number };
}

export const MODE_LABEL: Record<string, string> = { both: 'Pick and drop', pickup: 'Pick up only', drop: 'Drop only' };
export const MODE_SHORT: Record<string, string> = { both: 'P+D', pickup: 'Pick', drop: 'Drop' };
export const daysLeft = (iso: string | null) => (iso ? Math.round((Date.parse(iso) - Date.parse(today())) / 86400000) : null);
export const docClass = (iso: string | null) => { const d = daysLeft(iso); return d === null ? 'bg-slate-500/10 text-slate-400' : d < 0 ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : d <= 30 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'; };
export const docText = (iso: string | null) => { const d = daysLeft(iso); return iso === null ? 'Not set' : `${fmtDate(iso)}${d !== null && d < 0 ? ' (expired)' : d !== null && d <= 30 ? ` (${d} days)` : ''}`; };
export const seatClass = (used: number, cap: number | null) => (!cap ? 'bg-slate-400' : used > cap ? 'bg-rose-500' : used / cap > 0.9 ? 'bg-amber-500' : 'bg-emerald-500');

export const monthLabelOf = (ym: string) => { const n = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']; return `${n[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`; };
