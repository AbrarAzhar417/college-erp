import { bearerName } from '../college/routes.js';
import '../transport/schema.js';
import { db, getSetting } from '../db.js';
import { examConfig } from '../exam/service.js';

export type CardKind = 'id' | 'transport';
export interface CardRow {
  id: number; photo: string | null; name: string; father_name: string; reg_no: string; roll_no: number | null; dob: string | null; gender: string;
  class_name: string; section_name: string; phone: string | null; father_phone: string | null; address: string | null;
  route: string | null; stop: string | null; mode: string | null; bus: string | null; driver: string | null; driver_phone: string | null; morning: string | null; afternoon: string | null; pickup: string | null; drop_at: string | null;
}

/** Everything printed on student ID cards and transport (TPT) cards. Transport cards are only made for students who use a bus. */
export function cardData(kind: CardKind, f: { classId?: number; sectionId?: number; studentIds?: number[] }) {
  const w: string[] = ["st.status = 'active'"], p: any[] = [];
  if (f.studentIds?.length) { const ids = f.studentIds.slice(0, 60); w.push(`st.id IN (${ids.map(() => '?').join(',')})`); p.push(...ids); }
  else if (f.sectionId) { w.push('s.id = ?'); p.push(f.sectionId); } else if (f.classId) { w.push('c.id = ?'); p.push(f.classId); }
  else return { error: 'Choose a class, a section or a student.' as const };
  if (kind === 'transport') w.push('st.tr_route_id IS NOT NULL');
  const cards = db.prepare(`SELECT st.id, st.photo, st.name, st.father_name, st.reg_no, st.roll_no, st.dob, st.gender, c.name AS class_name, s.name AS section_name, st.phone, st.father_phone, st.address,
      r.name AS route, sp.name AS stop, st.tr_mode AS mode, v.number AS bus, d.name AS driver, d.phone AS driver_phone, r.morning_time AS morning, r.afternoon_time AS afternoon, sp.pickup_time AS pickup, sp.drop_time AS drop_at
    FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
    LEFT JOIN tr_routes r ON r.id = st.tr_route_id LEFT JOIN tr_stops sp ON sp.id = st.tr_stop_id LEFT JOIN tr_vehicles v ON v.id = r.vehicle_id LEFT JOIN tr_staff d ON d.id = v.driver_id
    WHERE ${w.join(' AND ')} ORDER BY c.grade, s.name, COALESCE(st.roll_no, 99999), st.name LIMIT 60`).all(...p) as CardRow[];
  const pr = db.prepare("SELECT name FROM users WHERE role = 'principal' AND active = 1 ORDER BY id LIMIT 1").get() as { name: string } | undefined;
  return {
    institute: getSetting('institute_name'), short: getSetting('short_name'), address: getSetting('inst_address'), phone: getSetting('inst_phone'),
    principal: bearerName('principal') || getSetting('principal_name') || pr?.name || 'Principal', session: examConfig().session, hasLogo: !!getSetting('logo'), cards
  };
}
