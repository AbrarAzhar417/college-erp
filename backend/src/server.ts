import os from 'node:os';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, ensureBaseData, getSetting, setSetting } from './db.js';
import { facultyRouter } from './faculty/routes.js';
import { collegeRouter, publicBearers, syncBearerLogins } from './college/routes.js';
import { requireAuth, requireRole, signTicket, signToken, type AuthUser } from './auth.js';
import { DUTIES, dutiesOf, listStaffDuties, setDuties } from './duties.js';
import './timetable/schema.js';
import './fee/schema.js';
import { applyCategoryRules } from './fee/service.js';
import { importRouter } from './import/routes.js';
import { logCategoryChange, registerStudentAudit } from './students/audit.js';
import { registerStudentReports } from './students/reports.js';
import { cnicCheck, findDuplicate, firstVoucher, makeRegNo, registerAdmission } from './students/admission.js';
import { acceptStrong, familyView, linkedSiblings, findSiblings, linkStudents, unlinkStudent } from './family.js';
import './attendance/schema.js';
import './exam/schema.js';
import './syllabus/schema.js';
import './transport/schema.js';
import './hr/schema.js';
import { transportRouter } from './transport/routes.js';
import { assignTransport, TransportError } from './transport/service.js';
import { syllabusRouter } from './syllabus/routes.js';
import { examRouter } from './exam/routes.js';
import { attendanceRouter } from './attendance/routes.js';
import { feeRouter } from './fee/routes.js';
import { timetableRouter } from './timetable/routes.js';
import { hrRouter } from './hr/routes.js';
import { diaryRouter } from './diary/routes.js';
import { frontdeskRouter } from './frontdesk/routes.js';
import { ptmRouter } from './ptm/routes.js';
import { commRouter } from './communication/routes.js';
import { downloadsRouter } from './downloads/routes.js';
import { tasksRouter } from './tasks/routes.js';
import { papersRouter } from './papers/routes.js';
import { testDeptRouter } from './testdept/routes.js';
import { myFilesRouter } from './myfiles/routes.js';
import { teacherRouter } from './teacher/routes.js';
import { audit } from './audit/service.js';
import { sheetsRouter } from './sheets/routes.js';
import { cardsRouter } from './cards/routes.js';
import { extrasRouter } from './timetable/extras.js';
import { ocrRouter } from './ocr/routes.js';
import { auditRouter } from './audit/routes.js';
import { backupRouter } from './backup/routes.js';
import { searchRouter } from './search/routes.js';
import { upgradeDatabase } from './upgrade.js';
import { checkIntegrity, installGuards, repairIntegrity } from './integrity.js';
import { otpEnabled, mustSetup } from './otp/service.js';
import { otpLoginRouter, otpRouter } from './otp/routes.js';
import { bulkReadLog } from './audit/downloads.js';
import { dutyRouter } from './exam/duty.js';
import { todayRouter } from './today/routes.js';
import { applicationRouter } from './students/application.js';
import { disciplineRouter } from './discipline/routes.js';
import { inventoryRouter } from './inventory/routes.js';
import { noticeRouter } from './notice/routes.js';
import { forecastRouter } from './fee/forecast.js';
import { startAutoFee } from './parentmsg/auto.js';
import { startAutoBackup } from './backup/service.js';
import { rolloverRouter } from './rollover/routes.js';
import { parentMsgRouter } from './parentmsg/routes.js';
import { receiptVerifyRouter } from './fee/verify.js';
import { publicResultRouter } from './publicresult/routes.js';
ensureBaseData();
upgradeDatabase();
installGuards();
syncBearerLogins();

/** The college crest is the default logo. It is put in once on a fresh database; if the director later removes or replaces it, that choice is kept. */
try {
  if (!getSetting('logo') && getSetting('logo_seeded') !== '1') {
    const f = new URL('../assets/logo.jpg', import.meta.url);
    if (fs.existsSync(f)) { setSetting('logo', 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64')); setSetting('logo_version', String(Date.now())); }
    setSetting('logo_seeded', '1');
  }
} catch { /* a missing file only means no default logo */ }

export const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);   // behind nginx/Caddy: real visitor address for limits and the audit log
app.use(cors());
app.use(compression());
app.use('/api/import', importRouter);   // before the 2 MB parser: has its own limit
app.use(express.json({ limit: '2mb' }));

// ---------- Login with a simple brute-force limit ----------
const attempts = new Map<string, { n: number; first: number }>();
function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > 15 * 60_000) { attempts.set(key, { n: 1, first: now }); return false; }
  a.n++;
  return a.n > 10;
}

const api = express.Router();
api.use('/public', receiptVerifyRouter);
api.use('/public', publicResultRouter);   // no login: parents look up a published result (see publicresult/routes.ts)

api.get('/health', (_req, res) => res.json({ ok: true }));

/** Addresses other devices on the same network can use to reach this server. */
export function lanUrls(): string[] {
  const port = Number(process.env.PORT) || 3000, out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
  return out;
}
const INSTITUTE_FIELDS: Record<string, { key: string; max: number }> = {
  instituteName: { key: 'institute_name', max: 80 }, shortName: { key: 'short_name', max: 20 },
  address: { key: 'inst_address', max: 160 }, phone: { key: 'inst_phone', max: 60 }, email: { key: 'inst_email', max: 80 },
  publicUrl: { key: 'inst_public_url', max: 120 }, website: { key: 'inst_website', max: 80 }, motto: { key: 'inst_motto', max: 120 }, affiliation: { key: 'inst_affiliation', max: 120 }, established: { key: 'inst_established', max: 20 }
};

api.get('/settings', (_req, res) => {
  const demo = getSetting('demo_mode') === '1';
  res.json({
    instituteName: getSetting('institute_name'), shortName: getSetting('short_name'), address: getSetting('inst_address'),
    phone: getSetting('inst_phone'), email: getSetting('inst_email'),
    website: getSetting('inst_website'), motto: getSetting('inst_motto'), affiliation: getSetting('inst_affiliation'), established: getSetting('inst_established'),
    publicUrl: getSetting('inst_public_url'), lanUrls: lanUrls(),
    bearers: publicBearers(),
    hasLogo: !!getSetting('logo'), logoVersion: getSetting('logo_version'),
    demoMode: demo,
    demoAccounts: demo ? db.prepare("SELECT name, username, role FROM users WHERE role <> 'teacher' OR username = 'teacher' ORDER BY id").all() : []
  });
});

api.get('/settings/logo', (_req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(getSetting('logo'));
  if (!m) return res.status(404).end();
  res.type(m[1]).set('Cache-Control', 'public, max-age=300').send(Buffer.from(m[2], 'base64'));
});

api.put('/settings', requireAuth, requireRole('director', 'principal'), (req, res) => {
  const out: Record<string, string> = {};
  for (const [field, { key, max }] of Object.entries(INSTITUTE_FIELDS)) {
    if (req.body?.[field] === undefined) continue;
    const v = String(req.body[field]).trim();
    if (field === 'instituteName' && (v.length < 2 || v.length > max)) return res.status(400).json({ message: `College name must be 2 to ${max} characters.` });
    if (v.length > max) return res.status(400).json({ message: `${field} is too long (most ${max} characters).` });
    if (field === 'publicUrl' && v && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(v)) return res.status(400).json({ message: 'The address must start with http:// or https://, for example http://192.168.1.10:3000' });
    setSetting(key, v); out[field] = v;
  }
  res.json(out);
});

api.put('/settings/logo', requireAuth, requireRole('director', 'principal'), (req, res) => {
  const d = String(req.body?.dataUrl ?? '');
  const m = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(d);
  if (!m) return res.status(400).json({ message: 'Please choose a PNG, JPG or WebP image.' });
  if (m[1].length * 0.75 > 600_000) return res.status(400).json({ message: 'The logo is too big. Use an image under 600 KB.' });
  setSetting('logo', d); setSetting('logo_version', String(Date.now()));
  res.json({ ok: true });
});

api.delete('/settings/logo', requireAuth, requireRole('director', 'principal'), (_req, res) => {
  setSetting('logo', ''); setSetting('logo_version', String(Date.now()));
  res.json({ ok: true });
});

api.use(otpLoginRouter);
api.post('/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!username || !password) return res.status(400).json({ message: 'Enter your username and password.' });
  if (tooManyAttempts(`${req.ip}|${username}`)) return res.status(429).json({ message: 'Too many attempts. Wait 15 minutes and try again.' });

  const row = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username) as any;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    audit(null, 'login.failed', 'user', null, `username ${username}`, req.ip || '');
    return res.status(401).json({ message: 'Wrong username or password.' });
  }
  const user: AuthUser = { id: row.id, name: row.name, username: row.username, role: row.role, duties: row.role === 'teacher' ? dutiesOf(row.id) : [] };
  attempts.delete(`${req.ip}|${username}`);
  if (otpEnabled(user.id)) return res.json({ otpRequired: true, ticket: signTicket(user.id) });   // password right; now the 6-digit code
  audit(user, 'login', 'user', user.id, '', req.ip || '');
  res.json({ token: signToken(user), user });
});

// Additional charges (exam, test, timetable). The office gives them to teachers.
api.get('/duties', requireAuth, requireRole('director', 'principal', 'admin'), (_req, res) => res.json({ duties: Object.entries(DUTIES).map(([key, v]) => ({ key, ...v })), staff: listStaffDuties() }));
api.put('/duties/:userId', requireAuth, requireRole('director', 'principal', 'admin'), (req, res) => {
  const r = setDuties(Number(req.params.userId), req.body?.duties, req.user!.id);
  typeof r === 'string' ? res.status(r === 'Staff member not found.' ? 404 : 400).json({ message: r }) : res.json({ duties: r });
});
api.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

api.post('/auth/change-password', requireAuth, (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  if (next.length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters.' });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!row || !bcrypt.compareSync(current, row.password_hash)) return res.status(400).json({ message: 'Current password is wrong.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user!.id);
  res.json({ ok: true });
});

// Everything below needs a logged-in user
api.use(requireAuth);
// A role that must use two-step login cannot do anything else until it is set up.
api.use((req, res, next) => {
  const ok = req.path.startsWith('/auth') || req.path.startsWith('/otp') || (req.method === 'GET' && req.path.startsWith('/settings'));
  if (!ok && req.user && mustSetup(req.user)) return res.status(403).json({ message: 'Set up two-step login first (Security page).', otpSetupRequired: true });
  next();
});
api.use('/otp', otpRouter);
// Every successful change (POST/PUT/PATCH/DELETE) is written to the audit log: who, when, which request. Bodies are never stored.
api.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => { if (res.statusCode < 400) audit(req.user, `${req.method} ${req.baseUrl.replace(/^\/api/, '')}${req.path}`.slice(0, 60), 'request', null, `status ${res.statusCode}`, req.ip || ''); });
  next();
});

// Large reads (100 rows or more in one answer) are written to the audit log as "bulk.read": who, which page, how many rows.
// This is what the Downloads report is made from. It catches screens that are later saved as CSV on the person's own computer too.
api.use(bulkReadLog);
api.use('/timetable', timetableRouter);
api.use('/fee', feeRouter);
api.use('/attendance', attendanceRouter);
api.use('/exam-duty', dutyRouter);
api.use('/college', collegeRouter);
api.use('/faculty', facultyRouter);
api.use('/discipline', disciplineRouter);
api.use('/inventory', inventoryRouter);
api.use('/notices', noticeRouter);
api.use('/fee-forecast', forecastRouter);
api.use('/exam', examRouter);
api.use('/syllabus', syllabusRouter);
api.use('/transport', transportRouter);
api.use('/hr', hrRouter);
api.use('/diary', diaryRouter);
api.use('/frontdesk', frontdeskRouter);
api.use('/ptm', ptmRouter);
api.use('/communication', commRouter);
api.use('/downloads', downloadsRouter);
api.use('/tasks', tasksRouter);
api.use('/paper-setting', papersRouter);
api.use('/testdept', testDeptRouter);
api.use('/my-files', myFilesRouter);
api.use('/teacher', teacherRouter);
api.use('/audit', auditRouter);
api.use('/sheets', sheetsRouter);
api.use('/cards', cardsRouter);
api.use('/timetable', extrasRouter);
api.use('/ocr', ocrRouter);
api.use('/backup', backupRouter);
api.use('/search', requireAuth, searchRouter);
api.get('/integrity', requireRole('director', 'principal', 'admin'), (_req, res) => res.json(checkIntegrity()));
api.post('/integrity/repair', requireRole('director', 'principal', 'admin'), (req, res) => {
  const r = repairIntegrity(); audit(req.user, 'integrity.repair', 'database', null, JSON.stringify(r.fixed));
  res.json({ ...r, after: checkIntegrity() });
});
api.use('/rollover', rolloverRouter);
api.use('/parent-msg', parentMsgRouter);

// ---------- Classes & sections ----------
api.get('/classes', (_req, res) => {
  const rows = db.prepare(`
    SELECT c.id AS class_id, c.grade, c.name AS class_name, c.stage,
           s.id AS section_id, s.name AS section_name,
           COUNT(st.id) AS students
    FROM classes c
    JOIN sections s ON s.class_id = c.id
    LEFT JOIN students st ON st.section_id = s.id AND st.status = 'active'
    GROUP BY s.id ORDER BY c.grade, s.name`).all() as any[];
  const map = new Map<number, any>();
  for (const r of rows) {
    if (!map.has(r.class_id)) map.set(r.class_id, { id: r.class_id, grade: r.grade, name: r.class_name, stage: r.stage, total: 0, sections: [] });
    const c = map.get(r.class_id);
    c.sections.push({ id: r.section_id, name: r.section_name, students: r.students });
    c.total += r.students;
  }
  res.json([...map.values()]);
});

// ---------- Students ----------
const canWrite = requireRole('director', 'principal', 'admin');
/** Teachers see their students' names and phones, but not the father's CNIC or P. No. */
const hidePrivate = (r: any) => { const { father_cnic, p_number, ...rest } = r; return rest; };
const canFamily = requireRole('director', 'principal', 'admin', 'accountant');

api.get('/students', (req, res) => {
  const { classId, sectionId, q } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const where: string[] = ["st.status = 'active'"];
  const params: any[] = [];
  if (classId) { where.push('c.id = ?'); params.push(Number(classId)); }
  if (sectionId) { where.push('s.id = ?'); params.push(Number(sectionId)); }
  if (q?.trim()) {
    where.push('(st.name LIKE ? OR st.father_name LIKE ? OR st.reg_no LIKE ? OR st.phone LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  const base = `FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params) as any).n;
  const items = db.prepare(`
    SELECT st.id, (st.photo IS NOT NULL) AS has_photo, st.reg_no, st.roll_no, st.father_cnic, st.tr_route_id, st.tr_stop_id, st.tr_mode, (SELECT name FROM tr_routes WHERE id = st.tr_route_id) AS bus_route, st.category, st.p_number, st.father_phone, st.mother_phone, st.name, st.father_name, st.gender, st.dob, st.phone, st.address, st.admission_date,
           st.section_id, s.name AS section_name, c.id AS class_id, c.grade, c.name AS class_name
    ${base} ORDER BY c.grade, s.name, st.roll_no, st.name LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  res.json({ items: req.user!.role === 'teacher' ? (items as any[]).map(hidePrivate) : items, total, page, limit });
});

registerStudentReports(api, canWrite);
registerAdmission(api);
// Photos are not sent with the list (they are large): each avatar asks for its own, only when it scrolls into view, and the browser keeps it for an hour.
api.get('/students/:id/photo', (req, res) => {
  const r = db.prepare('SELECT photo FROM students WHERE id = ?').get(Number(req.params.id)) as { photo: string | null } | undefined;
  if (!r) return res.status(404).json({ message: 'Student not found.' });
  res.set('Cache-Control', 'private, max-age=3600').json({ photo: r.photo });
});
api.get('/students/siblings', canFamily, (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(findSiblings(q.cnic, [q.phone1, q.phone2, q.phone3], Number(q.exclude) || 0));
});
api.get('/students/:id/siblings', canFamily, (req, res) => {
  const st = db.prepare('SELECT id, father_cnic, phone, father_phone, mother_phone FROM students WHERE id = ?').get(Number(req.params.id)) as any;
  if (!st) return res.status(404).json({ message: 'Student not found.' });
  res.json(findSiblings(st.father_cnic, [st.phone, st.father_phone, st.mother_phone], st.id));
});
// Families: linked brothers / sisters, suggestions, and manual link / unlink
api.get('/students/:id/family', canFamily, (req, res) => {
  const v = familyView(Number(req.params.id));
  if (!v) return res.status(404).json({ message: 'Student not found.' });
  res.json(v);
});
const refreshFees = (ids: number[]) => { for (const i of ids) applyCategoryRules(i); return ids.length; };
api.post('/students/:id/family/link', canWrite, (req, res) => {
  const r = linkStudents(Number(req.params.id), Number(req.body?.sibling_id));
  if (typeof r === 'string') return res.status(400).json({ message: r });
  res.json({ linked: r.length, fees_updated: refreshFees(r) });
});
api.post('/students/:id/family/accept', canWrite, (req, res) => {
  const r = acceptStrong(Number(req.params.id));
  if (typeof r === 'string') return res.status(404).json({ message: r });
  res.json({ linked: r.length, fees_updated: refreshFees(r) });
});
api.delete('/students/:id/family', canWrite, (req, res) => {
  const r = unlinkStudent(Number(req.params.id));
  res.json({ unlinked: r.length > 0, fees_updated: refreshFees(r) });
});

api.use('/students', applicationRouter);
// The QR on a card opens this student: the scanner finds the admission number here, and the usual profile rules then apply.
api.get('/students/by-reg/:reg', (req, res) => {
  const r = db.prepare('SELECT id FROM students WHERE reg_no = ? COLLATE NOCASE').get(String(req.params.reg).slice(0, 40)) as { id: number } | undefined;
  if (!r) return res.status(404).json({ message: 'No student has this admission number.' });
  res.json({ id: r.id });
});

api.get('/students/:id', (req, res) => {
  const st = db.prepare(`SELECT st.*, s.name AS section_name, c.id AS class_id, c.grade, c.name AS class_name, t.name AS class_teacher,
      (SELECT name FROM tr_routes WHERE id = st.tr_route_id) AS bus_route
    FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id LEFT JOIN teachers t ON t.id = s.class_teacher_id WHERE st.id = ?`).get(Number(req.params.id)) as any;
  if (!st) return res.status(404).json({ message: 'Student not found.' });
  res.json(req.user!.role === 'teacher' ? hidePrivate(st) : st);
});

function validateStudent(b: any): string | null {
  if (!String(b?.name ?? '').trim()) return 'Student name is required.';
  if (!String(b?.father_name ?? '').trim()) return "Father's name is required.";
  if (!['male', 'female'].includes(b?.gender)) return 'Choose male or female.';
  if (!Number.isInteger(b?.section_id)) return 'Choose a class and section.';
  if (!db.prepare('SELECT 1 FROM sections WHERE id = ?').get(b.section_id)) return 'That section does not exist.';
  return cnicCheck(b?.father_cnic).error;
}

const nextRoll = (sectionId: number) =>
  (db.prepare("SELECT COALESCE(MAX(roll_no), 0) AS n FROM students WHERE section_id = ? AND status = 'active'").get(sectionId) as any).n + 1;
const rollTaken = (sectionId: number, roll: number, exceptId = 0) =>
  !!db.prepare("SELECT 1 FROM students WHERE section_id = ? AND roll_no = ? AND status = 'active' AND id <> ?").get(sectionId, roll, exceptId);
const cleanCnic = (v: unknown) => cnicCheck(v).value;
const cleanCat = (v: unknown) => (['A', 'B', 'C'].includes(String(v)) ? String(v) : null);
const cleanPhoto = (v: unknown) => (typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length <= 120000 ? v : null);
const cleanText = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n) || null;

api.post('/students', canWrite, (req, res) => {
  const err = validateStudent(req.body);
  if (err) return res.status(400).json({ message: err });
  const b = req.body;
  const roll = Number(b.roll_no) > 0 ? Math.floor(Number(b.roll_no)) : nextRoll(b.section_id);
  if (rollTaken(b.section_id, roll)) return res.status(409).json({ message: `Roll number ${roll} is already used in this section.` });
  const dup = b.force ? null : findDuplicate(b.name, b.father_name, b.dob);
  if (dup) return res.status(409).json({ message: `${dup.name} (${dup.reg_no}, ${dup.class_name}-${dup.section_name}${dup.status === 'left' ? ', left' : ''}) already has the same father name and date of birth. Save anyway only if this is a different child.`, duplicate: dup });
  const create = db.transaction(() => {
    const reg = makeRegNo(b.section_id);
    const r = db.prepare(`INSERT INTO students (photo, reg_no, roll_no, father_cnic, category, p_number, father_phone, mother_phone, name, father_name, gender, dob, phone, address, section_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(cleanPhoto(b.photo), reg, roll, cleanCnic(b.father_cnic), cleanCat(b.category), cleanText(b.p_number, 30), cleanText(b.father_phone, 20), cleanText(b.mother_phone, 20), b.name.trim(), b.father_name.trim(), b.gender, b.dob || null, b.phone || null, b.address || null, b.section_id);
    const sid = Number(r.lastInsertRowid);
    // Same father CNIC / phone = same family, linked on admission (weaker guesses are only suggested). Everyone's order, and so their sibling discount, is refreshed.
    logCategoryChange(sid, null, cleanCat(b.category), req.user!.id, 'Admission');
    const fam = acceptStrong(sid);
    applyCategoryRules(sid);
    if (Array.isArray(fam)) for (const i of fam) if (i !== sid) applyCategoryRules(i);
    const tr = b.tr_route_id ? assignTransport(sid, Number(b.tr_route_id), b.tr_stop_id ? Number(b.tr_stop_id) : null, b.tr_mode) : null;
    return { id: sid, reg_no: reg, roll_no: roll, transport_fee: tr?.fee ?? 0, warning: tr?.warning ?? null };
  });
  try {
    const made = create();
    const fv = firstVoucher(made.id, req.user!.id);   // admission fee + first month, if switched on in the admission settings
    res.status(201).json({ ...made, voucher_id: fv.voucherId, voucher_note: fv.note });
  } catch (e) { if (e instanceof TransportError) return res.status(400).json({ message: e.message }); throw e; }
});

api.put('/students/:id', canWrite, (req, res) => {
  const err = validateStudent(req.body);
  if (err) return res.status(400).json({ message: err });
  const b = req.body;
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT section_id, roll_no, category FROM students WHERE id = ?').get(id) as any;
  if (!cur) return res.status(404).json({ message: 'Student not found.' });
  let roll = Number(b.roll_no) > 0 ? Math.floor(Number(b.roll_no)) : (cur.section_id === b.section_id && cur.roll_no ? cur.roll_no : nextRoll(b.section_id));
  if (rollTaken(b.section_id, roll, id)) return res.status(409).json({ message: `Roll number ${roll} is already used in this section.` });
  const tr = { warning: null as string | null };
  try { db.transaction(() => {
  db.prepare(`UPDATE students SET photo=CASE WHEN ? = 1 THEN ? ELSE photo END, roll_no=?, father_cnic=?, category=?, p_number=?, father_phone=?, mother_phone=?, name=?, father_name=?, gender=?, dob=?, phone=?, address=?, section_id=? WHERE id=?`)
    .run(b.photo !== undefined ? 1 : 0, cleanPhoto(b.photo), roll, cleanCnic(b.father_cnic), cleanCat(b.category), cleanText(b.p_number, 30), cleanText(b.father_phone, 20), cleanText(b.mother_phone, 20), b.name.trim(), b.father_name.trim(), b.gender, b.dob || null, b.phone || null, b.address || null, b.section_id, id);
  logCategoryChange(id, cur.category, cleanCat(b.category), req.user!.id, cleanText(b.category_reason, 200));
  applyCategoryRules(id);
  for (const o of linkedSiblings(id)) applyCategoryRules(o.id);   // a changed date of birth can change who is the 2nd child
  if (b.tr_route_id !== undefined) tr.warning = assignTransport(id, b.tr_route_id ? Number(b.tr_route_id) : null, b.tr_stop_id ? Number(b.tr_stop_id) : null, b.tr_mode).warning;
  })(); } catch (e) { if (e instanceof TransportError) return res.status(400).json({ message: e.message }); throw e; }
  res.json({ ok: true, warning: tr.warning });
});

registerStudentAudit(api, canWrite);

// Soft delete: the record stays in the database (marked "left")
api.delete('/students/:id', canWrite, (req, res) => {
  assignTransport(Number(req.params.id), null, null);
  const r = db.prepare("UPDATE students SET status = 'left' WHERE id = ?").run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ message: 'Student not found.' });
  res.json({ ok: true });
});

// ---------- Dashboard ----------
api.use('/today', todayRouter);
api.get('/dashboard', requireRole('director', 'principal', 'admin'), (_req, res) => {
  const one = (sql: string) => (db.prepare(sql).get() as any).n as number;
  res.json({
    students: one("SELECT COUNT(*) AS n FROM students WHERE status='active'"),
    boys: one("SELECT COUNT(*) AS n FROM students WHERE status='active' AND gender='male'"),
    girls: one("SELECT COUNT(*) AS n FROM students WHERE status='active' AND gender='female'"),
    classes: one('SELECT COUNT(*) AS n FROM classes'),
    sections: one('SELECT COUNT(*) AS n FROM sections'),
    staff: one('SELECT COUNT(*) AS n FROM users WHERE active=1'),
    byClass: db.prepare(`
      SELECT c.grade, c.name, COUNT(st.id) AS students
      FROM classes c JOIN sections s ON s.class_id = c.id
      LEFT JOIN students st ON st.section_id = s.id AND st.status='active'
      GROUP BY c.id ORDER BY c.grade`).all(),
    recent: db.prepare(`
      SELECT st.id, st.name, st.reg_no, st.admission_date, c.name AS class_name, s.name AS section_name
      FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id
      WHERE st.status='active' ORDER BY st.id DESC LIMIT 6`).all()
  });
});

app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found.' }));

// ---------- Serve the built Angular app (so one server does everything) ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = process.env.WEB_ROOT || path.resolve(here, '..', '..', 'frontend', 'dist', 'frontend', 'browser');
if (fs.existsSync(webRoot)) {
  app.use(express.static(webRoot, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('API is running. Build the frontend (see README) to open the portal here.'));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT) || 3000;
if (!process.env.NO_LISTEN) { startAutoBackup(); startAutoFee(); }
if (!process.env.NO_LISTEN) app.listen(port, '0.0.0.0', () => console.log(`College ERP running on http://localhost:${port}` + (lanUrls().length ? `\nOther devices on this network: ${lanUrls().join('  ')}` : '')));
