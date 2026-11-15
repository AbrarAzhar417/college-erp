export interface MeetingInfo { id: number; title: string; date: string; start_time: string; slot_minutes: number; venue: string | null; exam_name: string | null; att_from: string; att_to: string; sections: { id: number; label: string; total: number; attended: number; no_show: number }[] }
export interface Invite { slot_id: number; student: string; father: string; time: string; phone: string | null; notified: boolean; message: string }
export interface Point { kind: 'good' | 'concern'; text: string }
export interface SubjectLine { subject: string; max: number; marks: number | null; status: string; pass: boolean | null; pct: number | null; classAvg: number | null; highest: number | null }
export interface StudentReport {
  meeting: { id: number; title: string; date: string; venue: string | null; att_from: string; att_to: string };
  student: { id: number; name: string; father_name: string; gender: string; roll_no: number | null; reg_no: string; section: string };
  slot: { id: number; time: string; status: string; attended_by: string | null; discussed: string; parent_remarks: string; action_points: string; follow_up: string | null };
  exam: { id: number; name: string; status: string } | null;
  result: { subjects: SubjectLine[]; total: number; max: number; pct: number | null; grade: string | null; rank: number | null; students: number; result: string; failed: string[]; missing: number; prev: { name: string; pct: number | null; rank: number | null } | null; delta: number | null; classAvg: number | null; classHighest: number | null } | null;
  history: { exam: string; pct: number; rank: number | null }[];
  attendance: { present: number; late: number; absent: number; leave: number; recorded: number; pct: number | null; low: boolean; lowLimit: number; months: { month: string; pct: number | null; absent: number; recorded: number }[]; absentDates: string[] };
  notes: { date: string; kind: string; note: string }[]; points: Point[];
}
export interface ClassRow { slot_id: number; time: string; status: string; student_id: number; name: string; father_name: string; roll_no: number | null; pct: number | null; grade: string | null; rank: number | null; result: string | null; failed: string[]; trend: string | null; delta: number | null; needsCall: boolean; att_pct: number | null; absent: number; lowAtt: boolean }
export interface ClassReport {
  meeting: { id: number; title: string; date: string; venue: string | null; att_from: string; att_to: string }; section: { id: number; label: string; class_teacher: string | null }; exam: { id: number; name: string; status: string } | null;
  result: { students: number; complete: number; incomplete: number; pass: number; fail: number; passPct: number | null; avg: number | null; highest: number | null; lowest: number | null; subjects: { subject: string; teacher: string | null; avgPct: number | null; highest: number | null; lowest: number | null; passPct: number | null; failed: number }[]; top: { name: string; pct: number | null; rank: number | null }[] } | null;
  attendance: { avgPct: number | null; lowCount: number; perfect: number; lowLimit: number }; meetingStats: { total: number; attended: number; no_show: number; pending: number }; students: ClassRow[];
}
