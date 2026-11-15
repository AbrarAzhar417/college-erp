export type Role = 'director' | 'principal' | 'admin' | 'teacher' | 'accountant';

export interface User { id: number; name: string; username: string; role: Role; /** Additional charges: exam_dept, test_dept, timetable_team. */ duties?: string[] }

export const ROLE_LABEL: Record<Role, string> = {
  director: 'Director', principal: 'Principal', admin: 'Front Desk Admin', teacher: 'Teacher', accountant: 'Accountant'
};

export interface SectionInfo { id: number; name: string; students: number }
export interface ClassInfo { id: number; grade: number; name: string; stage: string; total: number; sections: SectionInfo[] }

export interface Student {
  id: number; photo?: string | null; has_photo?: number; reg_no: string; roll_no: number | null; father_cnic: string | null; category: 'A' | 'B' | 'C' | null; p_number: string | null; father_phone: string | null; mother_phone: string | null; tr_route_id: number | null; tr_stop_id: number | null; tr_mode: string | null; bus_route: string | null; name: string; father_name: string; gender: 'male' | 'female';
  dob: string | null; phone: string | null; address: string | null; admission_date: string;
  section_id: number; section_name: string; class_id: number; grade: number; class_name: string;
}
export interface StudentPage { items: Student[]; total: number; page: number; limit: number }

export interface DashboardData {
  students: number; boys: number; girls: number; classes: number; sections: number; staff: number;
  byClass: { grade: number; name: string; students: number }[];
  recent: { id: number; name: string; reg_no: string; admission_date: string; class_name: string; section_name: string }[];
}
