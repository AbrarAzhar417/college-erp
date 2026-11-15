import { Injectable, inject, signal } from '@angular/core';
import { Api } from '../core/api';

export interface TTSettings { days: number[]; periodCount: number; startTime: string; periodMinutes: number; breakAfter: number; breakMinutes: number; classTeacherFirst?: boolean; targetLoad?: number }
export interface Period { start: string; end: string }
export interface Subject { id: number; name: string; code: string | null; heavy: number; science: number; sections: number; teachers: number }
export interface Teacher {
  id: number; name: string; phone: string | null; max_per_day: number; max_per_week: number; user_id: number | null;
  subjects: number[]; unavailable: { day: number; period: number }[]; load: number; username?: string | null;
}
export interface Slot {
  section_id: number; day: number; period: number; subject_id: number; subject_name: string; teacher_id: number; teacher_name: string;
  grp: number; locked: number; grade: number; section_name: string; class_id: number;
}
export interface GenSlot { sectionId: number; day: number; period: number; subjectId: number; teacherId: number; grp: number; locked: boolean }
export interface Issue { level: 'error' | 'warning'; message: string }
export type Wing = 'school' | 'college';
export const WING_LABEL: Record<Wing, string> = { school: 'School wing', college: 'College wing' };
export interface Check { issues: Issue[]; sections: number; lessons: number; periods: number; teachers: number; published: number; locked: number }

export interface Cell { title: string; sub: string; hue: number; grp: number; locked: boolean; cont: boolean }

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const hueOf = (subjectId: number) => (subjectId * 47 + 12) % 360;

/** Builds the cell map the grid draws, marking the 2nd period of a double lesson as a continuation. */
export function buildCells(items: { day: number; period: number; subjectId: number; title: string; sub: string; grp: number; locked: boolean }[]): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const i of items) m.set(`${i.day}-${i.period}`, { title: i.title, sub: i.sub, hue: hueOf(i.subjectId), grp: i.grp, locked: i.locked, cont: false });
  for (const i of items) {
    const prev = m.get(`${i.day}-${i.period - 1}`);
    if (prev && prev.grp === i.grp) m.get(`${i.day}-${i.period}`)!.cont = true;
  }
  return m;
}

@Injectable({ providedIn: 'root' })
export class TtData {
  private api = inject(Api);
  settings = signal<TTSettings | null>(null);
  periods = signal<Period[]>([]);
  /** The school and the college have their own bell times and timetables; this is the one being worked on. */
  wing = signal<Wing>((() => { try { return localStorage.getItem('tt_wing') === 'college' ? 'college' : 'school'; } catch { return 'school'; } })());
  classWing = signal<Map<number, Wing>>(new Map());
  ready = signal(false);
  inWing = (classId: number) => (this.classWing().get(classId) ?? 'school') === this.wing();

  setWing(w: Wing) { try { localStorage.setItem('tt_wing', w); } catch { /* ignore */ } this.wing.set(w); this.loadConfig(); }

  loadWings(done?: () => void) {
    this.api.get<{ classes: { id: number; wing: Wing }[] }>('/timetable/wings').subscribe({ next: r => { this.classWing.set(new Map(r.classes.map(c => [c.id, c.wing]))); done?.(); }, error: () => done?.() });
  }
  loadConfig() {
    this.ready.set(false);
    this.loadWings(() => this.api.get<{ settings: TTSettings; periods: Period[] }>('/timetable/config', { wing: this.wing() }).subscribe({
      next: r => { this.settings.set(r.settings); this.periods.set(r.periods); this.ready.set(true); }, error: () => this.ready.set(true)
    }));
  }
}
