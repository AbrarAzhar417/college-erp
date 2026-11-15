import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { fmtDate, money, monthLabel, today } from '../fee/fee';
export { fmtDate, money, monthLabel, today };

export type StaffType = 'teacher' | 'office' | 'accounts' | 'driver' | 'conductor' | 'support' | 'lab_attendant';
export const STAFF_TYPES: { key: StaffType; label: string }[] = [
  { key: 'teacher', label: 'Teacher' }, { key: 'office', label: 'Office staff' }, { key: 'accounts', label: 'Accounts' }, { key: 'driver', label: 'Driver' },
  { key: 'conductor', label: 'Conductor' }, { key: 'support', label: 'Naib qasid / security' }, { key: 'lab_attendant', label: 'Lab attendant' }
];
export const TYPE_LABEL: Record<string, string> = Object.fromEntries(STAFF_TYPES.map(t => [t.key, t.label]));
export const EMPLOYMENT: { key: string; label: string }[] = [{ key: 'permanent', label: 'Permanent' }, { key: 'contract', label: 'Contract' }, { key: 'probation', label: 'Probation' }, { key: 'part_time', label: 'Part time' }];
export const EMP_LABEL: Record<string, string> = Object.fromEntries(EMPLOYMENT.map(t => [t.key, t.label]));

export interface Staff {
  id: number; emp_no: string; name: string; father_name: string | null; gender: string | null; cnic: string | null; dob: string | null; phone: string | null; email: string | null; address: string | null;
  emergency_name: string | null; emergency_phone: string | null; qualification: string | null; staff_type: StaffType; kind: string; photo: string | null;
  department: string | null; designation: string | null; employment: string; joining_date: string | null; contract_end: string | null;
  basic_salary?: number; house_allow?: number; medical_allow?: number; conveyance_allow?: number; other_allow?: number; fixed_deduction?: number; bank_name?: string | null; account_no?: string | null;
  license_no: string | null; license_expiry: string | null; status: 'active' | 'left' | 'resigned'; left_date: string | null; left_reason: string | null; user_id: number | null;
}
export interface Balance { type_id: number; name: string; paid: number; quota: number; used: number; pending: number; left: number | null }
export interface LeaveRow { id: number; staff_id: number; name?: string; emp_no?: string; designation?: string; type: string; type_id: number; from_date: string; to_date: string; days: number; reason: string | null; status: 'pending' | 'approved' | 'rejected'; paid?: number; balance_left?: number | null }
export interface LeaveType { id: number; name: string; yearly_quota: number; paid: number; active?: number }
export interface HrLookup { departments: string[]; designations: string[]; leaveTypes: LeaveType[]; config: HrConfig }
export interface HrConfig { day_divisor: '30' | 'working'; late_per_day: number; late_after: string; contract_alert_days: number }
export interface Slip {
  id: number; month: string; staff_id: number; name: string; emp_no: string; designation: string | null; department: string | null; kind: string; cnic: string | null; joining_date: string | null;
  basic: number; allowances: number; gross: number; working_days: number; absent_days: number; unpaid_days: number; notjoined_days: number; per_day: number; cut_amount: number;
  late_count: number; late_cut_days: number; fixed_deduction: number; advance: number; loan: number; other_deduction: number; bonus: number; overtime: number; arrears: number;
  net: number; unmarked: number; status: 'draft' | 'approved' | 'paid'; paid_date: string | null;
}
export interface MonthDay { date: string; day: number; dow: number; off: boolean; holiday: string | null; working: boolean }

export const ATT_LABEL: Record<string, string> = { P: 'Present', LT: 'Late', A: 'Absent', L: 'Leave', HD: 'Half day' };
export const ATT_SHORT: Record<string, string> = { P: 'P', LT: 'T', A: 'A', L: 'L', HD: 'H' };
export const attBox = (s: string | null | undefined) => (s === 'P' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : s === 'LT' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : s === 'A' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
  : s === 'L' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : s === 'HD' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'bg-slate-500/10 text-slate-400');
export const SLIP_STATUS: Record<string, string> = { draft: 'Draft', approved: 'Approved', paid: 'Paid' };
export const slipBadge = (s: string) => (s === 'paid' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : s === 'approved' ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'bg-slate-500/10 text-slate-500');
export const leaveBadge = (s: string) => (s === 'approved' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : s === 'rejected' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300');

export const STAGES = ['applied', 'shortlisted', 'interview', 'offered', 'hired', 'rejected'] as const;
export const STAGE_LABEL: Record<string, string> = { applied: 'Applied', shortlisted: 'Shortlisted', interview: 'Interview', offered: 'Offered', hired: 'Hired', rejected: 'Rejected' };
export const stageBadge = (s: string) => (s === 'hired' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : s === 'rejected' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : s === 'offered' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
  : s === 'interview' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : s === 'shortlisted' ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'bg-slate-500/10 text-slate-500');

export interface Job { id: number; title: string; department: string | null; kind: string; positions: number; qualification: string | null; experience: string | null; salary_range: string | null; description: string | null; keywords: string | null; posted_date: string | null; last_date: string | null; status: 'open' | 'closed'; stages: Record<string, number>; total: number; filled: number }
export interface Candidate {
  id: number; job_id: number | null; job_title: string | null; name: string; phone: string | null; email: string | null; cnic: string | null; gender: string | null; city: string | null; qualification: string | null;
  experience_years: number | null; current_employer: string | null; current_salary: number | null; expected_salary: number | null; source: string | null; stage: string; rating: number | null; notes: string | null; reject_reason: string | null;
  offer_designation: string | null; offer_salary: number | null; offer_date: string | null; joining_date: string | null; offer_employment: string | null; staff_id: number | null; applied_date: string;
  cvs: number; messages: number; int_date: string | null; int_time: string | null; int_venue: string | null;
  score: number | null; kw_hits?: number; cv_status?: string | null;
}
export interface ScoreInfo { score: number; keywords: number; experience: number; qualification: number; found: string[]; missing: string[] }
export interface CvImport { status: 'created' | 'duplicate'; id: number; name: string; phone: string | null; email: string | null; qualification: string | null; experience_years: number | null; score: number | null; text_ok: boolean; name_found: boolean; existing_job: string | null; existing_stage: string | null; file?: string }

// ---------- messages to candidates ----------
/** Pakistani numbers: 0300 1234567 -> 923001234567 (what WhatsApp and SMS links need). */
export function normPhone(p: string | null | undefined): string {
  let d = (p ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '92' + d.slice(1);
  else if (d.length === 10 && d.startsWith('3')) d = '92' + d;
  return d;
}
export const validPhone = (p: string | null | undefined) => normPhone(p).length >= 11;
export const waLink = (phone: string | null, text: string) => `https://wa.me/${normPhone(phone)}?text=${encodeURIComponent(text)}`;
export const smsLink = (phones: (string | null)[], text: string) => `sms:${phones.map(p => '+' + normPhone(p)).join(',')}?body=${encodeURIComponent(text)}`;
export const mailLink = (to: string[], subject: string, body: string, bcc: boolean) =>
  `mailto:${bcc ? '' : to.join(',')}?${bcc ? 'bcc=' + to.map(encodeURIComponent).join(',') + '&' : ''}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const fillTemplate = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
export const timeText = (t: string | null) => { if (!t) return ''; const h = Number(t.slice(0, 2)); return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? 'AM' : 'PM'}`; };

export const csv = (name: string, rows: (string | number | null | undefined)[][]) => {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/** Upload and open the CVs / documents (they need the login token, so a plain link will not work). */
@Injectable({ providedIn: 'root' })
export class HrFiles {
  private http = inject(HttpClient);
  upload(owner: 'staff' | 'candidate', id: number, file: File, label = '', expires = '') {
    const q = new URLSearchParams({ name: file.name });
    if (label) q.set('label', label);
    if (expires) q.set('expires', expires);
    return firstValueFrom(this.http.post<{ id: number }>(`/api/hr/files/${owner}/${id}?${q}`, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }));
  }
  /** One CV in, one candidate out: the details are read from the file and a person who applied before is not added twice. */
  importCv(file: File, jobId: number | null) {
    const q = new URLSearchParams({ name: file.name });
    if (jobId) q.set('job_id', String(jobId));
    return firstValueFrom(this.http.post<CvImport>(`/api/hr/recruit/candidates/cv-import?${q}`, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }));
  }
  async open(id: number) {
    const blob = await firstValueFrom(this.http.get(`/api/hr/files/${id}`, { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/** Shrinks a picked photo to a small square JPEG (about 10 KB) before it is saved. */
export function shrinkPhoto(file: File, size = 220): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const s = Math.min(img.width, img.height), ctx = c.getContext('2d')!;
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This picture cannot be read.')); };
    img.src = url;
  });
}
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export const scoreBadge = (n: number | null | undefined) => (n === null || n === undefined ? 'bg-slate-500/10 text-slate-400' : n >= 75 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : n >= 50 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300');
