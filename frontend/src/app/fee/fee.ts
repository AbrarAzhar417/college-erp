import { Injectable } from '@angular/core';

export interface Institute {
  name: string; shortName: string; address: string; phone: string; email: string; hasLogo: boolean; logoVersion: string;
  bank: { name: string; branch: string; title: string; accountNo: string; iban: string };
  lateFine: number; notes: string[];
}
export interface VItem { head_id: number | null; description: string; amount: number }
export interface VoucherPrint {
  id: number; voucher_no: string; period_label: string; issue_date: string; due_date: string;
  net: number; arrears: number; late_fine: number; status: string; payable: number; after_due: number; paid: boolean; items: VItem[];
  name: string; father_name: string; gender: string; phone: string | null; address: string | null; reg_no: string; roll_no: number | null;
  father_cnic: string | null; class_name: string; section_name: string;
}
export interface VoucherRow {
  id: number; voucher_no: string; period: string; period_label: string; issue_date: string; due_date: string; net: number; arrears: number; late_fine: number;
  student_id: number; name: string; father_name: string; roll_no: number | null; reg_no: string; class_name: string; section_name: string;
  payable: number; paid: number; balance: number; state: 'paid' | 'partial' | 'unpaid' | 'cancelled'; overdue: boolean;
}
export interface Head { id: number; name: string; frequency: 'monthly' | 'annual' | 'one_time'; optional: number; concessionable: number }
export interface FeeSettings {
  bank_name: string; bank_branch: string; account_title: string; account_no: string; iban: string; late_fine: number; due_day: number; voucher_notes: string;
}
export interface StudentHit { id: number; name: string; father_name: string; reg_no: string; roll_no: number | null; phone: string | null; class_name: string; section_name: string; balance: number }

export const FREQ_LABEL = { monthly: 'Every month', annual: 'Once a year', one_time: 'One time' } as const;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const money = (n: number) => Math.round(n).toLocaleString('en-US');
export const today = () => new Date().toISOString().slice(0, 10);
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`;

/** 2026-10-01 -> 01-Oct-2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${MONTHS[Number(m) - 1]?.slice(0, 3)}-${y}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string {
  let s = '';
  if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)] + ' '; n %= 10; }
  if (n > 0) s += ONES[n] + ' ';
  return s;
}
/** 125000 -> "Rupees One Lakh Twenty Five Thousand Only" (Pakistani numbering) */
export function rupeesInWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Zero Rupees Only';
  const parts: [number, string][] = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']];
  let s = '';
  for (const [size, name] of parts) { const q = Math.floor(n / size); if (q) { s += below1000(q) + name + ' '; n %= size; } }
  s += below1000(n);
  return `Rupees ${s.trim()} Only`;
}

/** Remembers which vouchers to print, even after a page refresh. */
@Injectable({ providedIn: 'root' })
export class FeePrintService {
  private key = 'fee_print_ids';
  set(ids: number[]) { sessionStorage.setItem(this.key, JSON.stringify(ids)); }
  get(): number[] { try { return JSON.parse(sessionStorage.getItem(this.key) || '[]'); } catch { return []; } }
}
