export type Kind = 'circular' | 'meeting' | 'order' | 'datesheet' | 'result' | 'notice';
export const KIND_LABEL: Record<Kind, string> = { circular: 'Circular', meeting: 'Meeting points', order: 'Office order', datesheet: 'Date sheet', result: 'Result notification', notice: 'Notice' };
export const AUDIENCE_LABEL: Record<string, string> = { all: 'Staff and parents', staff: 'All staff', teachers: 'Teachers only', parents: 'Parents' };
export interface MeetingPoint { text: string; assignee: string; due: string }
export interface DateRow { class_label: string; subject: string; date: string; day?: string; time: string }
export interface ResultLine { class_label: string; pass_pct: number | null; avg: number | null; top: string }
export interface NoticeData { meeting_date?: string; time?: string; venue?: string; attendees?: string; points?: MeetingPoint[]; exam_name?: string; rows?: DateRow[]; exam_id?: number | null; lines?: ResultLine[] }
export interface Notice {
  id: number; kind: Kind; title: string; body: string; data: NoticeData; audience: 'all' | 'staff' | 'teachers' | 'parents'; class_ids: number[]; priority: 'normal' | 'urgent';
  status: 'draft' | 'published' | 'withdrawn'; ref_no: string | null; issue_date: string; signed_by: string; created_by: number | null; read_at: string | null; reads: number; needs_ack: boolean;
}
export const niceDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
