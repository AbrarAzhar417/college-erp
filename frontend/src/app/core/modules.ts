import {
  CalendarCheck, CalendarDays, FilePenLine, BookOpen, BookMarked, Handshake, ConciergeBell,
  Wallet, Briefcase, ShieldCheck, Send, MessageSquare, ListChecks, Download, Megaphone, Package, ShieldAlert, Bus, House, Layers, Users, Building2, GraduationCap, LucideIconData
} from 'lucide-angular';
import type { Role } from './models';

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIconData;
  link: string;
  /** Only these roles see the item (all roles when missing). */
  roles?: Role[];
  /** A teacher with one of these additional charges also sees the item. */
  duties?: string[];
}
export interface NavGroup { title: string; items: NavItem[] }

const OFFICE: Role[] = ['director', 'principal', 'admin'];
const STAFF: Role[] = ['director', 'principal', 'admin', 'teacher', 'accountant'];

/** The menu for the office, the accountant and the principal. */
export const NAV: NavGroup[] = [
  {
    title: 'Main',
    items: [
      { key: 'home', label: 'Dashboard', icon: House, link: '/' },
      { key: 'classes', label: 'Classes & Sections', icon: Layers, link: '/classes' },
      { key: 'students', label: 'Students & Admissions', icon: Users, link: '/students' }
    ]
  },
  {
    title: 'Academics',
    items: [
      { key: 'timetable', label: 'Timetable', icon: CalendarDays, link: '/timetable' },
      { key: 'attendance', label: 'Attendance', icon: CalendarCheck, link: '/attendance', roles: OFFICE },
      { key: 'exams', label: 'Examination', icon: FilePenLine, link: '/exams', roles: OFFICE },
      { key: 'paper-setting', label: 'Paper Setting', icon: BookOpen, link: '/paper-setting', roles: OFFICE },
      { key: 'test-dept', label: 'Test Department', icon: ListChecks, link: '/test-dept', roles: OFFICE },
      { key: 'diary', label: 'Daily Diary & Homework', icon: BookOpen, link: '/diary', roles: OFFICE },
      { key: 'syllabus', label: 'Syllabus', icon: BookMarked, link: '/syllabus', roles: OFFICE },
      { key: 'ptm', label: 'Parent Teacher Meeting', icon: Handshake, link: '/ptm', roles: OFFICE }
    ]
  },
  {
    title: 'Office & Finance',
    items: [
      { key: 'frontdesk', label: 'Front Desk', icon: ConciergeBell, link: '/frontdesk', roles: OFFICE },
      { key: 'fee', label: 'Fee Management', icon: Wallet, link: '/fee', roles: ['director', 'principal', 'accountant', 'admin'] },
      { key: 'hr', label: 'HR Management', icon: Briefcase, link: '/hr' },
      { key: 'discipline', label: 'Discipline & Behaviour', icon: ShieldAlert, link: '/discipline', roles: OFFICE },
      { key: 'notices', label: 'Notice Board', icon: Megaphone, link: '/notices', roles: OFFICE },
      { key: 'inventory', label: 'Inventory & Lab', icon: Package, link: '/inventory', roles: STAFF },
      { key: 'duties', label: 'Additional Charges', icon: Users, link: '/duties', roles: OFFICE },
      { key: 'sheets', label: 'Sheets & Lists', icon: ListChecks, link: '/sheets', roles: OFFICE },
      { key: 'cards', label: 'ID & Transport Cards', icon: Users, link: '/cards', roles: OFFICE },
      { key: 'parent-msg', label: 'Parent Messages', icon: Send, link: '/parent-messages', roles: OFFICE },
      { key: 'security', label: 'My Security', icon: ShieldCheck, link: '/security' },
      { key: 'college', label: 'College Profile', icon: Building2, link: '/college', roles: ['director', 'principal', 'admin'] },
      { key: 'teachers', label: 'Teachers', icon: GraduationCap, link: '/teachers', roles: ['director', 'principal', 'admin'] },
      { key: 'system', label: 'System & Safety', icon: ShieldCheck, link: '/system', roles: ['director', 'principal', 'admin'] },
      { key: 'communication', label: 'Communication', icon: MessageSquare, link: '/communication', roles: STAFF },
      { key: 'tasks', label: 'Tasks', icon: ListChecks, link: '/tasks', roles: STAFF }
    ]
  },
  {
    title: 'Campus',
    items: [
      { key: 'transport', label: 'Transport', icon: Bus, link: '/transport', roles: ['director', 'principal', 'admin', 'accountant'] },
      { key: 'downloads', label: 'Download Center', icon: Download, link: '/downloads', roles: STAFF }
    ]
  }
];

/** A teacher sees only what belongs to them. */
export const TEACHER_NAV: NavGroup[] = [
  {
    title: 'My work',
    items: [
      { key: 'me', label: 'My Home', icon: House, link: '/me' },
      { key: 'my-timetable', label: 'My Timetable', icon: CalendarDays, link: '/timetable/view' },
      { key: 'my-syllabus', label: 'My Syllabus', icon: BookMarked, link: '/syllabus/mine' },
      { key: 'my-marks', label: 'My Test Marks', icon: FilePenLine, link: '/exams/papers' },
      { key: 'my-slips', label: 'My Salary Slips', icon: Wallet, link: '/hr/mine' },
      { key: 'my-files', label: 'My Files', icon: Layers, link: '/files' },
      { key: 'my-inventory', label: 'Report Damage', icon: Package, link: '/inventory' },
      { key: 'my-security', label: 'My Security', icon: ShieldCheck, link: '/security' }
    ]
  },
  {
    title: 'My class',
    items: [
      { key: 'attendance', label: 'Attendance', icon: CalendarCheck, link: '/attendance' },
      { key: 'diary', label: 'Daily Diary & Homework', icon: BookOpen, link: '/diary' },
      { key: 'ptm', label: 'Parent Teacher Meeting', icon: Handshake, link: '/ptm' },
      { key: 'sheets', label: 'Print Sheets & Lists', icon: ListChecks, link: '/sheets' }
    ]
  },
  {
    title: 'School',
    items: [
      { key: 'paper-setting', label: 'My Papers to Set', icon: BookOpen, link: '/paper-setting' },
      { key: 'communication', label: 'Notices', icon: MessageSquare, link: '/communication' },
      { key: 'tasks', label: 'Tasks', icon: ListChecks, link: '/tasks' },
      { key: 'downloads', label: 'Download Center', icon: Download, link: '/downloads' }
    ]
  },
  {
    title: 'Additional charge',
    items: [
      { key: 'exam-dept', label: 'Exam Department', icon: FilePenLine, link: '/exams', duties: ['exam_dept'] },
      { key: 'exam-papers', label: 'Paper Collection', icon: BookOpen, link: '/paper-setting', duties: ['exam_dept'] },
      { key: 'test-dept', label: 'Test Department', icon: ListChecks, link: '/test-dept', duties: ['test_dept', 'exam_dept'] },
      { key: 'tt-team', label: 'Timetable Team', icon: CalendarDays, link: '/timetable', duties: ['timetable_team'] }
    ]
  }
];

export const ALL_ITEMS = [...NAV, ...TEACHER_NAV].flatMap(g => g.items);
