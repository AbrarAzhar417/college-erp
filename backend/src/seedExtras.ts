import bcrypt from 'bcryptjs';
import { db, getSetting, setSetting } from './db.js';
import { todayISO } from './attendance/service.js';
import './college/routes.js';
import { syncTeacher } from './faculty/routes.js';
import { createMeeting } from './ptm/service.js';
import './ptm/routes.js';
import './frontdesk/service.js';
import './communication/service.js';
import './notice/routes.js';
import './tasks/service.js';
import './discipline/routes.js';
import './inventory/routes.js';
import './diary/service.js';
import { letterDraft, nextLetterRef } from './discipline/routes.js';
import { checkIntegrity, installGuards } from './integrity.js';
import { upgradeDatabase } from './upgrade.js';
import { linkStudents } from './family.js';

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
const uid = (role: string) => (db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1').get(role) as { id: number } | undefined)?.id;

/** Fills the modules that the first demo script does not touch, and makes every copy of a name agree. Safe to run again. */
export function seedExtras() {
  const today = todayISO();
  const principal = uid('principal')!, director = uid('director')!, admin = uid('admin')!, teacherUser = uid('teacher')!, accountant = uid('accountant');

  // ---- College profile -------------------------------------------------------------------------------------------
  const set = (k: string, v: string) => { if (!getSetting(k)) setSetting(k, v); };
  set('inst_address', 'KRL Colony, Kahuta, District Rawalpindi'); set('inst_phone', '051-3311000, 051-3311001'); set('inst_email', 'info@kmcb.edu.pk');
  set('inst_website', 'www.kmcb.edu.pk'); set('inst_motto', 'Knowledge, Character, Service'); set('inst_affiliation', 'BISE Rawalpindi (SSC and HSSC)'); set('inst_established', '1998');
  const people = {
    director: ['Dr. Muhammad Aslam Satti', '0300-5551001', 'PhD Physics'], principal: ['Prof. Tariq Mehmood Abbasi', '0300-5551002', 'MA Education, M.Ed'],
    vice_principal: ['Mrs. Shaista Parveen', '0300-5551003', 'MSc Chemistry, B.Ed'], headmaster: ['Mr. Khalid Hussain Malik', '0300-5551004', 'MA English, B.Ed'],
    accounts_officer: ['Mr. Rashid Ali Awan', '0300-5551005', 'M.Com'], hr_officer: ['Mr. Javed Iqbal Raja', '0300-5551006', 'MBA (HR)'], admin_officer: ['Mr. Naveed Akhtar Qureshi', '0300-5551007', 'MPA']
  } as Record<string, string[]>;
  const titles: Record<string, string> = { director: 'Director', principal: 'Principal', vice_principal: 'Vice Principal', headmaster: 'Headmaster', accounts_officer: 'Accounts Officer', hr_officer: 'HR Officer', admin_officer: 'Admin Officer' };
  if (count('office_bearers') === 0) {
    const ins = db.prepare('INSERT INTO office_bearers (post, title, name, phone, email, qualification, sort_order) VALUES (?,?,?,?,?,?,?)');
    Object.entries(people).forEach(([post, [name, phone, q]], i) => ins.run(post, titles[post], name, phone, `${post.replace('_', '.')}@kmcb.edu.pk`, q, i + 1));
  }
  // The name on a login and in its HR file follow the College Profile, so one person has one name everywhere.
  const rename = (userId: number | undefined, name: string) => { if (!userId) return; db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId); db.prepare('UPDATE hr_staff SET name = ? WHERE user_id = ?').run(name, userId); };
  rename(director, people.director[0]); rename(principal, people.principal[0]); rename(admin, people.admin_officer[0]);
  if (accountant) rename(accountant, people.accounts_officer[0]);

  // ---- Teachers: rank, details, a login for each ---------------------------------------------------------------
  const ranks = ['educator', 'educator', 'senior_educator', 'subject_specialist', 'educator', 'senior_subject_specialist', 'lecturer', 'subject_specialist', 'assistant_professor', 'senior_educator', 'associate_professor', 'professor'];
  const quals = ['B.Ed', 'BSc, B.Ed', 'MA, B.Ed', 'MSc, B.Ed', 'MPhil', 'MSc', 'MA English, B.Ed', 'M.Ed'];
  const hash = bcrypt.hashSync('Teacher@123', 10), slugs = new Set((db.prepare('SELECT lower(username) AS u FROM users').all() as any[]).map(r => r.u));
  const teachers = db.prepare('SELECT * FROM teachers ORDER BY id').all() as any[];
  const insU = db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, 'teacher')");
  db.transaction(() => {
    teachers.forEach((t, i) => {
      const gender = /^(Mrs|Ms|Miss|Madam)\b/i.test(t.name) || /(Ayesha|Fatima|Maryam|Zainab|Hira|Sana|Amna|Khadija|Iqra|Noor|Shaista|Nasreen|Sadia)/.test(t.name) ? 'female' : 'male';
      const cnic = `37301-${String(1000000 + i * 7919 + 13).slice(-7)}-${(i % 9) + 1}`, mail = `${t.name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@kmcb.edu.pk`;
      db.prepare(`UPDATE teachers SET rank = COALESCE(rank, ?), email = COALESCE(email, ?), cnic = COALESCE(cnic, ?), qualification = COALESCE(qualification, ?), address = COALESCE(address, ?),
        joining_date = COALESCE(joining_date, ?), gender = COALESCE(gender, ?) WHERE id = ?`).run(ranks[i % ranks.length], mail, cnic, quals[i % quals.length], 'Kahuta, Rawalpindi', `${2008 + (i % 17)}-0${1 + (i % 9)}-01`, gender, t.id);
      if (!t.user_id && t.active) {
        let base = t.name.toLowerCase().replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/, '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') || `teacher${t.id}`, name = base, k = 1;
        while (slugs.has(name)) name = `${base}${++k}`;
        slugs.add(name);
        const u = Number(insU.run(t.name, name, hash).lastInsertRowid);
        db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(u, t.id);
        db.prepare('UPDATE hr_staff SET user_id = ? WHERE teacher_id = ? AND user_id IS NULL').run(u, t.id);
      }
      syncTeacher(t.id);
    });
  })();
  // two teachers carry duties
  const dutyT = db.prepare('SELECT user_id FROM teachers WHERE user_id IS NOT NULL AND user_id <> ? ORDER BY id LIMIT 2').all(teacherUser) as any[];
  const insD = db.prepare('INSERT OR IGNORE INTO staff_duties (user_id, duty, assigned_by) VALUES (?,?,?)');
  if (dutyT[0]) insD.run(dutyT[0].user_id, 'exam_dept', principal); if (dutyT[1]) insD.run(dutyT[1].user_id, 'timetable_team', principal);

  // ---- Front desk ---------------------------------------------------------------------------------------------
  if (count('fd_visitors') === 0) {
    const v = db.prepare('INSERT INTO fd_visitors (date, name, phone, cnic, purpose, meeting_with, badge_no, time_in, time_out, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)');
    v.run(today, 'Muhammad Younas', '0301-2223344', '37301-1234567-1', 'Fee query', 'Accounts Officer', 'V-01', '09:10', '09:35', admin);
    v.run(today, 'Abdul Majeed', '0333-4445566', null, 'Meet the principal', 'Principal', 'V-02', '10:05', null, admin);
    v.run(today, 'Shahid Mehmood', '0345-6667788', null, 'Book supplier', 'Admin Officer', 'V-03', '11:20', '11:50', admin);
    v.run(addDays(today, -1), 'Rubina Bibi', '0312-9998877', null, 'Child admission', 'Principal', 'V-04', '08:50', '09:30', admin);
    v.run(addDays(today, -1), 'Tahir Hussain', '0300-1112233', '37301-7654321-9', 'Complaint about bus timing', 'Headmaster', 'V-05', '12:15', '12:40', admin);
  }
  if (count('fd_enquiries') === 0) {
    const e = db.prepare('INSERT INTO fd_enquiries (date, child_name, parent_name, phone, grade, source, category, status, follow_up, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    e.run(addDays(today, -9), 'Hamza Raja', 'Imran Raja', '0300-7001001', 6, 'Walk-in', 'A', 'new', addDays(today, 1), 'Wants to see the campus', admin);
    e.run(addDays(today, -7), 'Ayesha Awan', 'Zahid Awan', '0301-7001002', 9, 'Referral', 'C', 'contacted', addDays(today, 2), 'Asked about fee and bus', admin);
    e.run(addDays(today, -5), 'Usman Satti', 'Rashid Satti', '0302-7001003', 11, 'Facebook', 'B', 'visited', addDays(today, 3), 'Visited with father, test fixed', admin);
    e.run(addDays(today, -4), 'Bilal Malik', 'Javed Malik', '0303-7001004', 7, 'Walk-in', 'A', 'admitted', null, 'Form submitted', admin);
    e.run(addDays(today, -3), 'Saad Qureshi', 'Naveed Qureshi', '0304-7001005', 8, 'Newspaper', 'C', 'lost', null, 'Chose another school', admin);
  }
  if (count('fd_gate_passes') === 0) {
    const kids = db.prepare("SELECT id FROM students WHERE status = 'active' ORDER BY id LIMIT 3").all() as any[];
    const p = db.prepare('INSERT INTO fd_gate_passes (student_id, date, reason, taken_by, relation, taker_cnic, status, decided_by, decided_at, left_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    if (kids[0]) p.run(kids[0].id, today, 'Doctor appointment', 'Muhammad Aslam', 'Father', '37301-1111111-1', 'approved', principal, `${today} 10:00:00`, '10:20', admin);
    if (kids[1]) p.run(kids[1].id, today, 'Family function', 'Tariq Mehmood', 'Uncle', null, 'pending', null, null, null, admin);
    if (kids[2]) p.run(kids[2].id, addDays(today, -1), 'Not well', 'Shahid Iqbal', 'Father', '37301-2222222-3', 'rejected', principal, `${addDays(today, -1)} 11:00:00`, null, admin);
  }

  // ---- Parent teacher meeting (uses the real planner so slots are consistent) --------------------------------------
  if (count('ptm_meetings') === 0) {
    const exam = db.prepare('SELECT id FROM exams ORDER BY id LIMIT 1').get() as any;
    const secs = (db.prepare("SELECT s.id FROM sections s JOIN students st ON st.section_id = s.id AND st.status = 'active' JOIN classes c ON c.id = s.class_id WHERE c.grade = 9 GROUP BY s.id ORDER BY s.name LIMIT 2").all() as any[]).map(r => r.id);
    if (secs.length) {
      const r = createMeeting({ title: 'Parent Teacher Meeting, Class 9', date: addDays(today, 5), start_time: '09:00', slot_minutes: 10, section_ids: secs, exam_id: exam?.id, venue: 'Main Hall' }, principal);
      if (typeof r === 'string') console.log('PTM demo skipped:', r);
    }
  }

  // ---- Circulars, notices, tasks -----------------------------------------------------------------------------------
  if (count('comm_notices') === 0) {
    const ins = db.prepare("INSERT INTO comm_notices (kind, title, body, audience, priority, status, ref_no, issue_date, signed_by, created_by, published_by, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const sign = people.principal[0], short = getSetting('short_name') || 'KMCB', y = today.slice(0, 4);
    ins.run('circular', 'Winter timings', 'From Monday the college opens at 8:30 am and closes at 2:00 pm. Teachers report at 8:15 am.', 'all', 'normal', 'published', `${short}/CIR/${y}/001`, addDays(today, -6), sign, admin, principal, `${addDays(today, -6)} 09:00:00`);
    ins.run('circular', 'Staff meeting on Saturday', 'All teaching staff must attend the monthly meeting in the library at 10:00 am.', 'teachers', 'urgent', 'published', `${short}/CIR/${y}/002`, addDays(today, -2), sign, admin, principal, `${addDays(today, -2)} 12:00:00`);
    ins.run('circular', 'Fee last date', 'The last date for November fee without fine is the 10th. Please inform parents.', 'staff', 'normal', 'draft', null, today, sign, admin, null, null);
  }
  if (count('notices') === 0) {
    const n = db.prepare("INSERT INTO notices (title, body, target, pinned, publish_on, expires_on, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?)");
    n.run('Welcome back', 'Classes are running as per the new timetable.', 'all', 1, addDays(today, -10), null, admin, people.admin_officer[0]);
    n.run('Sports day', 'Annual sports day will be held on the first Saturday of next month.', 'all', 0, addDays(today, -3), addDays(today, 30), admin, people.admin_officer[0]);
    n.run('Test schedule', 'Monthly test starts next week. See the datesheet in your diary.', 'parents', 0, addDays(today, -1), addDays(today, 10), principal, people.principal[0]);
  }
  if (count('tasks') === 0) {
    const t = db.prepare('INSERT INTO tasks (title, description, assigned_to, assigned_by, priority, due_date, status) VALUES (?,?,?,?,?,?,?)');
    t.run('Prepare the fee defaulters list', 'Students with more than two months pending.', accountant ?? admin, principal, 'high', addDays(today, 2), 'open');
    t.run('Update the notice board', 'Put the winter timing circular on the board.', admin, principal, 'normal', addDays(today, 1), 'in_progress');
    t.run('Submit Class 9 lesson plans', 'Week-wise plans for the term.', teacherUser, principal, 'normal', addDays(today, 7), 'open');
  }

  // ---- Discipline, inventory, diary --------------------------------------------------------------------------------
  const kids = db.prepare("SELECT id, section_id FROM students WHERE status = 'active' ORDER BY id LIMIT 12").all() as any[];
  if (count('disc_records') === 0 && kids.length >= 5) {
    const d = db.prepare('INSERT INTO disc_records (student_id, date, kind, category, text, action, status, meet_date, outcome, by_user, by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    d.run(kids[0].id, addDays(today, -8), 'praise', 'Other', 'First position in the class test.', null, 'closed', null, 'pending', principal, people.principal[0]);
    d.run(kids[1].id, addDays(today, -6), 'warning', 'Uniform', 'Came without the college tie three days in a row.', 'Parents informed by phone', 'closed', null, 'pending', principal, people.principal[0]);
    d.run(kids[2].id, addDays(today, -4), 'summon', 'Late / bunking', 'Absent from two periods without leave.', 'Father called to the college', 'open', addDays(today, 2), 'pending', principal, people.principal[0]);
    d.run(kids[3].id, addDays(today, -2), 'note', 'Homework', 'Homework not submitted for a week.', null, 'open', null, 'pending', principal, people.principal[0]);
  }
  if (count('disc_letters') === 0) {
    for (const rec of db.prepare("SELECT * FROM disc_records WHERE kind IN ('warning','summon','praise') ORDER BY id").all() as any[]) {
      const st = db.prepare("SELECT st.id, st.name, st.reg_no, c.name || '-' || s.name AS class_name FROM students st JOIN sections s ON s.id = st.section_id JOIN classes c ON c.id = s.class_id WHERE st.id = ?").get(rec.student_id) as any;
      const type = rec.kind === 'praise' ? 'appreciation' : rec.kind, d = letterDraft(rec, st, type);
      db.prepare('INSERT INTO disc_letters (student_id, record_id, type, ref_no, subject, body, issued_on, signed_by, issued_by, issued_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(rec.student_id, rec.id, type, nextLetterRef(rec.date), d.subject, d.body, rec.date, people.principal[0], principal, people.principal[0]);
    }
  }
  if (count('inv_items') === 0) {
    const it = db.prepare('INSERT INTO inv_items (code, name, category, location, unit, qty_good, qty_damaged, qty_lost, qty_disposed, purchase_date, cost) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const ev = db.prepare("INSERT INTO inv_events (item_id, date, kind, qty, note, by_user, by_name) VALUES (?,?,?,?,?,?,?)");
    const rows: [string, string, string, string, number, number, number, number][] = [
      ['FUR-001', 'Student desk', 'furniture', 'Class rooms', 180, 12, 0, 4], ['LAB-001', 'Microscope', 'lab', 'Biology lab', 14, 2, 0, 0], ['LAB-002', 'Beaker 250 ml', 'lab', 'Chemistry lab', 60, 6, 3, 0],
      ['ELE-001', 'Projector', 'electronics', 'AV room', 5, 1, 0, 0], ['SPT-001', 'Football', 'sports', 'Sports store', 12, 3, 2, 0], ['LIB-001', 'Reference books', 'library', 'Library', 420, 15, 8, 0]
    ];
    rows.forEach(([code, name, cat, loc, good, dam, lost, disp]) => { const id = Number(it.run(code, name, cat, loc, 'pcs', good, dam, lost, disp, addDays(today, -400), null).lastInsertRowid); ev.run(id, addDays(today, -400), 'added', good + dam + lost + disp, 'Opening stock', admin, people.admin_officer[0]); });
  }
  if (count('diary_entries') === 0 && kids.length) {
    const subj = db.prepare('SELECT id FROM subjects ORDER BY id LIMIT 2').all() as any[];
    const e = db.prepare('INSERT INTO diary_entries (date, section_id, subject_id, kind, title, body, due_date, created_by) VALUES (?,?,?,?,?,?,?,?)');
    if (subj[0]) e.run(today, kids[0].section_id, subj[0].id, 'homework', 'Exercise 4.2', 'Solve questions 1 to 10 in the notebook.', addDays(today, 1), teacherUser);
    if (subj[1]) e.run(today, kids[0].section_id, subj[1].id, 'classwork', 'Poem recitation', 'Learn the first two stanzas.', null, teacherUser);
    e.run(addDays(today, -1), kids[0].section_id, null, 'notice', 'Bring colour pencils', 'For the drawing test on Thursday.', addDays(today, 2), teacherUser);
  }

  // ---- Brothers and sisters (linked families) ------------------------------------------------------------------------
  if (count('families') === 0) {
    const fathers = db.prepare("SELECT father_name FROM students WHERE status = 'active' GROUP BY father_name HAVING COUNT(*) > 1 ORDER BY father_name LIMIT 4").all() as any[];
    for (const f of fathers) {
      const ids = (db.prepare("SELECT id FROM students WHERE status = 'active' AND father_name = ? ORDER BY id").all(f.father_name) as any[]).map(r => r.id);
      for (let i = 1; i < ids.length; i++) linkStudents(ids[0], ids[i]);
    }
  }

  // ---- Check ---------------------------------------------------------------------------------------------------
  upgradeDatabase();
  installGuards();
  const r = checkIntegrity();
  console.log(r.ok ? 'Seed extras added. Data check: no problems.' : `Seed extras added. Data check found: ${r.findings.map(f => `${f.label} (${f.count})`).join('; ')}`);
  return r;
}
