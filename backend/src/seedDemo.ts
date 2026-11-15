import { db, ensureBaseData } from './db.js';
import { dayInfo, todayISO } from './attendance/service.js';
import { seedExtras } from './seedExtras.js';
import { importRealStudents, isRealStudent } from './realStudents.js';
// A hosted demo (DEMO_SEED=1, see boot.ts) is public, so it gets invented students only. Seeding on your own PC includes the real XI and XII students.
const withReal = process.env.DEMO_SEED !== '1';
import { applyLeaveToRegister, generatePayroll, importExisting, kindOfType, leaveDays, nextEmpNo, syncLinked } from './hr/service.js';

ensureBaseData();

const boys = ['Ali', 'Ahmed', 'Hamza', 'Usman', 'Bilal', 'Hassan', 'Zain', 'Umar', 'Saad', 'Faizan', 'Talha', 'Abdullah', 'Shahzaib', 'Danish', 'Waqas'];
const girls = ['Ayesha', 'Fatima', 'Maryam', 'Zainab', 'Hira', 'Sana', 'Amna', 'Khadija', 'Iqra', 'Noor', 'Laiba', 'Rabia', 'Mahnoor', 'Areeba', 'Hafsa'];
const fathers = ['Muhammad Aslam', 'Abdul Rehman', 'Tariq Mehmood', 'Shahid Iqbal', 'Naveed Akhtar', 'Zahid Hussain', 'Imran Khan', 'Rashid Ali', 'Javed Iqbal', 'Khalid Mehmood'];
const surnames = ['Satti', 'Abbasi', 'Malik', 'Awan', 'Raja', 'Chaudhry', 'Mughal', 'Qureshi'];

let seed = 42;
const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
const pick = <T,>(a: T[]) => a[rnd(a.length)];

const { n } = db.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number };
if (n > 0) {
  console.log('Students already exist, demo data not added.');
} else {
  const sections = db.prepare('SELECT s.id, c.grade FROM sections s JOIN classes c ON c.id = s.class_id').all() as { id: number; grade: number }[];
  const ins = db.prepare(`INSERT INTO students (reg_no, name, father_name, gender, dob, phone, section_id, admission_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let seq = 0;
  db.transaction(() => {
    for (const s of sections) {
      if (s.grade >= 11 && withReal) continue; // classes XI and XII are the real KMCB students (below)
      const count = 6 + rnd(7);
      for (let i = 0; i < count; i++) {
        seq++;
        const male = rnd(2) === 0;
        const sur = pick(surnames);
        const year = 2026 - (s.grade + 5) - rnd(2);
        const dob = `${year}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`;
        ins.run(`2026-${String(seq).padStart(4, '0')}`, `${pick(male ? boys : girls)} ${sur}`, `${pick(fathers)} ${sur}`,
          male ? 'male' : 'female', dob, `03${rnd(5)}${String(1000000 + rnd(8999999))}`, s.id, `2026-0${1 + rnd(8)}-${String(1 + rnd(27)).padStart(2, '0')}`);
      }
    }
  })();
  console.log(`Added ${seq} demo students${withReal ? " (classes 6 to 10)" : ""}.`);
  if (withReal) { const real = importRealStudents() as any; console.log(`Real KMCB students (XI and XII): ${real.saved ?? 0} added${real.error ? ', ' + real.error : ''}.`); }
}
db.prepare("INSERT INTO settings (key, value) VALUES ('demo_mode', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
console.log('Demo mode ON (login page shows quick-access accounts). To turn off, delete the demo_mode row or set it to 0.');

// ---------------------------------------------------------------------------
// Timetable demo data: subjects, teachers, curriculum, teacher assignment
// ---------------------------------------------------------------------------
import './timetable/schema.js';
import { autoAssign } from './timetable/assign.js';

const subjCount = (db.prepare('SELECT COUNT(*) AS n FROM subjects').get() as { n: number }).n;
if (subjCount > 0) {
  console.log('Timetable data already exists, skipped.');
} else {
  const SUBJECTS: [string, number][] = [
    ['English', 1], ['Urdu', 0], ['Mathematics', 1], ['Science', 1], ['Islamiyat', 0], ['Social Studies', 0], ['Computer', 0],
    ['Drawing', 0], ['Physical Education', 0], ['Nazra', 0], ['Physics', 1], ['Chemistry', 1], ['Biology', 1], ['Pak Studies', 0]
  ];
  const insSub = db.prepare('INSERT INTO subjects (name, heavy) VALUES (?, ?)');
  const sid: Record<string, number> = {};
  for (const [n, h] of SUBJECTS) sid[n] = Number(insSub.run(n, h).lastInsertRowid);

  // [subject, periods per week, block]
  type C = [string, number, number];
  const middle: C[] = [['English', 6, 1], ['Urdu', 5, 1], ['Mathematics', 6, 1], ['Science', 5, 1], ['Islamiyat', 3, 1], ['Social Studies', 3, 1], ['Computer', 2, 2], ['Drawing', 2, 1], ['Physical Education', 2, 1], ['Nazra', 2, 1]];
  const ssc: C[] = [['English', 6, 1], ['Urdu', 5, 1], ['Mathematics', 6, 1], ['Physics', 5, 1], ['Chemistry', 5, 1], ['Biology', 5, 1], ['Computer', 4, 2], ['Islamiyat', 3, 1], ['Pak Studies', 2, 1]];
  const hssc: C[] = [['English', 5, 1], ['Urdu', 3, 1], ['Pak Studies', 3, 1], ['Physics', 6, 1], ['Chemistry', 6, 1], ['Mathematics', 6, 1], ['Computer', 4, 2]];
  const curriculum = (g: number) => (g <= 8 ? middle : g <= 10 ? ssc : hssc);

  const sections = db.prepare('SELECT s.id, c.grade FROM sections s JOIN classes c ON c.id = s.class_id').all() as { id: number; grade: number }[];
  const insSS = db.prepare('INSERT INTO section_subjects (section_id, subject_id, periods_per_week, block) VALUES (?,?,?,?)');
  const totals: Record<string, number> = {};
  for (const s of sections) for (const [n, p, b] of curriculum(s.grade)) { insSS.run(s.id, sid[n], p, b); totals[n] = (totals[n] ?? 0) + p; }

  const first = ['Muhammad', 'Abdul', 'Tariq', 'Naveed', 'Shahid', 'Imran', 'Rashid', 'Javed', 'Khalid', 'Zahid', 'Aamir', 'Kamran', 'Nasir', 'Farhan', 'Irfan', 'Sajid', 'Waseem', 'Adeel', 'Rizwan', 'Asif',
    'Ayesha', 'Fatima', 'Sana', 'Hina', 'Nadia', 'Saima', 'Rubina', 'Farah', 'Samina', 'Shazia', 'Uzma', 'Bushra', 'Amna', 'Sumaira', 'Nazia'];
  const last = ['Satti', 'Abbasi', 'Malik', 'Awan', 'Raja', 'Chaudhry', 'Mughal', 'Qureshi', 'Khan', 'Butt', 'Shah', 'Mir'];
  const secondary: Record<string, string[]> = {
    Islamiyat: ['Nazra', 'Pak Studies'], Nazra: ['Islamiyat'], 'Pak Studies': ['Islamiyat', 'Social Studies'], 'Social Studies': ['Pak Studies'],
    Science: ['Biology'], Biology: ['Science'], Chemistry: ['Science'], Physics: ['Mathematics'], Mathematics: ['Physics'], Drawing: ['Physical Education'], 'Physical Education': ['Drawing']
  };
  const insT = db.prepare('INSERT INTO teachers (name, phone, max_per_day, max_per_week) VALUES (?, ?, 6, 30)');
  const insTS = db.prepare('INSERT INTO teacher_subjects VALUES (?, ?)');
  let k = 0, firstTeacher = 0;
  for (const [name] of SUBJECTS) {
    const need = Math.ceil((totals[name] ?? 0) / 26);
    for (let i = 0; i < need; i++, k++) {
      const tid = Number(insT.run(`${first[k % first.length]} ${last[(k * 7) % last.length]}`, `03${rnd(5)}${String(1000000 + rnd(8999999))}`).lastInsertRowid);
      if (!firstTeacher) firstTeacher = tid;
      insTS.run(tid, sid[name]);
      for (const extra of secondary[name] ?? []) insTS.run(tid, sid[extra]);
    }
  }
  const demoTeacherUser = db.prepare("SELECT id FROM users WHERE username = 'teacher'").get() as { id: number } | undefined;
  if (demoTeacherUser) db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(demoTeacherUser.id, firstTeacher);

  const r = autoAssign({});
  console.log(`Timetable demo: ${SUBJECTS.length} subjects, ${k} teachers, ${sections.length} sections. Assigned ${r.assigned} lessons, ${r.unassigned.length} unassigned.`);
}

// ---------------------------------------------------------------------------
// Fee demo data: class amounts, concessions, four months of vouchers and payments (Aug to Nov 2026)
// ---------------------------------------------------------------------------
import './fee/schema.js';
import { generateVouchers, recordPayment, todayISO as feeTodayISO, payable } from './fee/service.js';
import { getSetting, setSetting } from './db.js';

if ((db.prepare('SELECT COUNT(*) AS n FROM fee_structure').get() as { n: number }).n > 0) {
  console.log('Fee data already exists, skipped.');
} else {
  const head: Record<string, number> = {};
  for (const h of db.prepare('SELECT id, name FROM fee_heads').all() as { id: number; name: string }[]) head[h.name] = h.id;
  const tuition: Record<number, number> = { 6: 2500, 7: 2600, 8: 2700, 9: 3200, 10: 3300, 11: 4000, 12: 4200 };
  const insFS = db.prepare('INSERT INTO fee_structure (class_id, head_id, amount) VALUES (?,?,?)');
  for (const c of db.prepare('SELECT id, grade FROM classes').all() as { id: number; grade: number }[]) {
    insFS.run(c.id, head['Tuition Fee'], tuition[c.grade]);
    insFS.run(c.id, head['Computer Lab Fee'], 300);
    insFS.run(c.id, head['Admission Fee'], 3000);
    insFS.run(c.id, head['Annual Charges'], 2000);
    insFS.run(c.id, head['Examination Fee'], 1000);
    insFS.run(c.id, head['Library Fee'], 500);
  }
  const stu = (db.prepare("SELECT id FROM students WHERE status = 'active' ORDER BY id").all() as { id: number }[]).map(r => r.id);
  for (const id of stu) {
    if (id % 12 === 0) db.prepare('INSERT INTO student_heads (student_id, head_id, amount) VALUES (?,?,?)').run(id, head['Transport Fee'], 2000 + (id % 3) * 500);
    if (id % 17 === 0) db.prepare("INSERT INTO student_concessions (student_id, head_id, kind, value, reason) VALUES (?,?, 'percent', 25, 'Sibling discount')").run(id, head['Tuition Fee']);
    else if (id % 23 === 0) db.prepare("INSERT INTO student_concessions (student_id, head_id, kind, value, reason) VALUES (?,?, 'fixed', 500, 'Staff child')").run(id, head['Tuition Fee']);
  }
  setSetting('bank_name', 'Habib Bank Limited (demo)'); setSetting('bank_branch', 'Kahuta Branch, code 0123'); setSetting('account_title', getSetting('institute_name') || 'KRL Model College for Boys');
  setSetting('account_no', '0000-0000000000'); setSetting('iban', 'PK00 XXXX 0000 0000 0000 0000');

  const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  const today = feeTodayISO();
  const months: [string, string, number, boolean][] = [['2026-08', 'August 2026', 82, true], ['2026-09', 'September 2026', 72, false], ['2026-10', 'October 2026', 48, false], ['2026-11', 'November 2026', 22, false]];
  let nV = 0, nP = 0;
  for (const [period, label, fullPct, annual] of months) {
    const issue = `${period}-01`, due = `${period}-10`;
    const r = generateVouchers({ period, label, issueDate: issue, dueDate: due, scope: {}, includeMonthly: true,
      includeHeadIds: annual ? [head['Annual Charges'], head['Library Fee']] : [], lateFine: 100, createdBy: null });
    nV += r.created.length;
    for (const vid of r.created) {
      const v = db.prepare('SELECT student_id, net, arrears FROM vouchers WHERE id = ?').get(vid) as { student_id: number; net: number; arrears: number };
      const due$ = payable(v.net, v.arrears);
      const roll = rnd(100);
      let amount = 0;
      if (roll < fullPct) amount = due$; else if (roll < fullPct + 12) amount = Math.max(100, Math.round((due$ * (0.4 + rnd(30) / 100)) / 100) * 100);
      if (amount <= 0) continue;
      const paidOn = [addDays(issue, 1 + rnd(12)), today].sort()[0];
      recordPayment({ studentId: v.student_id, amount, paidOn, mode: pick(['cash', 'bank', 'bank', 'online']), voucherId: vid, receivedBy: null });
      nP++;
    }
  }
  console.log(`Fee demo: ${nV} vouchers (Aug to Nov 2026) and ${nP} payments.`);
}

// ---------------------------------------------------------------------------
// Attendance demo data: timetable, class teachers, holidays, leaves, 2.5 months of registers
// ---------------------------------------------------------------------------
import './attendance/schema.js';
import { solve } from './timetable/solver.js';
import { loadInput, replaceSlots } from './timetable/routes.js';
import { applyLeave, addDays, dowOf, dateRange, todayISO as attToday, workingDates as attWorking, monthOf } from './attendance/service.js';
import { getSettings as ttSettings, periodTimes as ttTimes } from './timetable/schema.js';

if ((db.prepare('SELECT COUNT(*) AS n FROM att_daily').get() as { n: number }).n > 0) {
  console.log('Attendance data already exists, skipped.');
} else {
  // a published timetable makes "My lessons" and period attendance work in the demo
  if ((db.prepare('SELECT COUNT(*) AS n FROM tt_slots').get() as { n: number }).n === 0) {
    for (const wing of ['school', 'college'] as const) {
      const inp = loadInput(wing);
      if (!inp.lessons.length) continue;
      const r = await solve({ ...inp, locked: [] }, { timeMs: 4000 });
      if (!r.unplaced.length && !r.validationErrors.length) replaceSlots(r.slots, wing);
      console.log(`Timetable for the demo (${wing} wing): ${r.placed}/${r.total} periods placed.`);
    }
  }
  // class teachers: one teacher per section
  const secs = db.prepare('SELECT s.id FROM sections s JOIN classes c ON c.id = s.class_id ORDER BY c.grade, s.name').all() as { id: number }[];
  const tchs = db.prepare('SELECT id FROM teachers WHERE active = 1 ORDER BY id').all() as { id: number }[];
  secs.forEach((s, i) => { if (tchs[i]) db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(tchs[i].id, s.id); });

  db.prepare("INSERT OR IGNORE INTO att_holidays (date, name) VALUES ('2026-08-14', 'Independence Day')").run();
  db.prepare("INSERT OR IGNORE INTO att_holidays (date, name) VALUES ('2026-09-05', 'Eid Milad-un-Nabi')").run();

  const today = attToday(), start = '2026-08-03';
  const students = db.prepare("SELECT id, section_id FROM students WHERE status = 'active' ORDER BY id").all() as { id: number; section_id: number }[];

  // a few approved leaves (these become "L" in the register)
  const kinds = ['sick', 'family', 'casual'] as const;
  students.filter(s => s.id % 19 === 0).forEach((s, i) => {
    const from = addDays('2026-08-17', (s.id * 3) % 55), to = addDays(from, 1 + (i % 3));
    const id = Number(db.prepare("INSERT INTO att_leaves (student_id, from_date, to_date, kind, reason, status, decided_by) VALUES (?,?,?,?,?, 'approved', 1)")
      .run(s.id, from, to, kinds[i % 3], ['Fever', 'Family function', 'Out of city', 'Doctor appointment'][i % 4]).lastInsertRowid);
    applyLeave(id, 1);
  });
  const pendingStu = students.find(s => s.id % 19 === 5);
  if (pendingStu) db.prepare("INSERT INTO att_leaves (student_id, from_date, to_date, kind, reason, status) VALUES (?,?,?,'sick','Fever, applied by parent', 'pending')").run(pendingStu.id, today, addDays(today, 2));

  // each student has a habit: most are regular, some are not
  const habit = (id: number) => { const h = (id * 37) % 100; return h < 68 ? 0.03 : h < 90 ? 0.09 : 0.24; };
  const insD = db.prepare("INSERT OR IGNORE INTO att_daily (student_id, date, status, marked_by) VALUES (?,?,?,1)");
  const dates: string[] = [];
  for (let m = '2026-08'; m <= monthOf(today); m = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)).toISOString().slice(0, 7)) dates.push(...attWorking(m, today));
  const todayUnmarked = new Set(secs.filter((_, i) => i % 3 === 0).map(s => s.id));   // some sections have not marked today yet
  db.transaction(() => {
    for (const s of students) {
      let streak = 0;
      for (const d of dates) {
        if (d < start) continue;
        if (d === today && todayUnmarked.has(s.section_id)) continue;
        const p = habit(s.id) * (dowOf(d) === 1 || dowOf(d) === 6 ? 1.5 : 1);
        let st = 'P';
        if (streak > 0 && rnd(100) < 40) { st = 'A'; streak--; }
        else if (rnd(1000) < p * 1000) { st = 'A'; streak = rnd(100) < 25 ? 1 + rnd(3) : 0; }
        else if (rnd(100) < 4) st = 'LT';
        insD.run(s.id, d, st);
      }
    }
  })();

  // period attendance for the last 5 school days (derived from the morning register, with a little bunking)
  const recent = dates.slice(-5), times = ttTimes(ttSettings()), now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const insP = db.prepare("INSERT OR IGNORE INTO att_period (student_id, date, period, subject_id, teacher_id, status, marked_by) VALUES (?,?,?,?,?,?,1)");
  let np = 0;
  db.transaction(() => {
    for (const d of recent) {
      const slots = db.prepare('SELECT section_id, period, subject_id, teacher_id FROM tt_slots WHERE day = ?').all(dowOf(d)) as any[];
      for (const sl of slots) {
        if (d === today && (times[sl.period]?.start ?? '99') > hhmm) continue;
        if (d === today && rnd(100) < 25) continue;     // a few teachers have not marked yet
        for (const s of students.filter(x => x.section_id === sl.section_id)) {
          const day = db.prepare('SELECT status FROM att_daily WHERE student_id = ? AND date = ?').get(s.id, d) as { status: string } | undefined;
          if (!day) continue;
          const st = day.status === 'A' || day.status === 'L' ? day.status : rnd(100) < 3 ? 'A' : 'P';
          insP.run(s.id, d, sl.period, sl.subject_id, sl.teacher_id, st); np++;
        }
      }
    }
  })();

  // July 2026 of one section is entered as month totals only (the "register shortcut")
  const july = students.filter(s => s.section_id === secs[1]?.id);
  july.forEach((s, i) => db.prepare('INSERT OR IGNORE INTO att_month_totals (student_id, month, working_days, present, absent, leave, late) VALUES (?,?,?,?,?,?,?)').run(s.id, '2026-07', 26, 26 - (i % 4) - (i % 7 === 0 ? 2 : 0), i % 4, i % 7 === 0 ? 2 : 0, 0));
  console.log(`Attendance demo: ${dates.filter(d => d >= start).length} school days of registers for ${students.length} students, ${np} period records.`);
}

// ---------------------------------------------------------------------------
// Examination demo data: student categories, three fortnightly tests, a send-up exam, follow-ups
// ---------------------------------------------------------------------------
import './exam/schema.js';
import { computeSection as examCompute, syncPapers as examSync } from './exam/service.js';

if ((db.prepare('SELECT COUNT(*) AS n FROM exams').get() as { n: number }).n > 0) {
  console.log('Exam data already exists, skipped.');
} else {
  // categories A / B / C, P numbers for A and B, father and mother phone numbers
  // The real students (XI, XII) keep the category from the college's list and get no invented phone numbers.
  const stud = (db.prepare("SELECT id, reg_no FROM students WHERE status = 'active' ORDER BY id").all() as { id: number; reg_no: string }[]).filter(s => !isRealStudent(s.reg_no));
  db.transaction(() => {
    for (const { id } of stud) {
      const h = (id * 31) % 100, cat = h < 35 ? 'A' : h < 60 ? 'B' : 'C';
      db.prepare('UPDATE students SET category = ?, p_number = ?, father_phone = ?, mother_phone = ? WHERE id = ?')
        .run(cat, cat === 'C' ? null : `P-${10000 + id * 7}`, `03${rnd(5)}${String(1000000 + rnd(8999999))}`, id % 5 === 0 ? null : `03${rnd(5)}${String(1000000 + rnd(8999999))}`, id);
    }
  })();

  const classes = db.prepare('SELECT id, grade FROM classes ORDER BY grade').all() as { id: number; grade: number }[];
  const mkExam = (name: string, kind: string, seq: number, start: string, end: string, status: string, gradeFrom: number, max: number) => {
    const id = Number(db.prepare('INSERT INTO exams (name, kind, session, seq, pass_percent, pass_rule, status, start_date, end_date) VALUES (?,?,?,?,33,?,?,?,?)').run(name, kind, '2026-27', seq, 'subjects', status, start, end).lastInsertRowid);
    for (const c of classes.filter(c => c.grade >= gradeFrom)) db.prepare('INSERT INTO exam_classes (exam_id, class_id) VALUES (?, ?)').run(id, c.id);
    examSync(id, max);
    return id;
  };
  const addD = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  const t1 = mkExam('Test 1', 'test', 1, '2026-08-17', '2026-08-22', 'locked', 6, 25);
  const t2 = mkExam('Test 2', 'test', 2, '2026-09-14', '2026-09-19', 'locked', 6, 25);
  const t3 = mkExam('Test 3', 'test', 3, '2026-10-05', '2026-10-10', 'open', 6, 25);
  const sendup = mkExam('Send-up Exam 2026', 'sendup', 1, '2026-11-16', '2026-11-28', 'open', 9, 100);
  for (const [id, start] of [[t1, '2026-08-17'], [t2, '2026-09-14'], [t3, '2026-10-05'], [sendup, '2026-11-16']] as [number, string][])
    for (const p of db.prepare('SELECT id, subject_id FROM exam_papers WHERE exam_id = ?').all(id) as { id: number; subject_id: number }[])
      db.prepare('UPDATE exam_papers SET test_date = ? WHERE id = ?').run(addD(start, p.subject_id % 6), p.id);

  // marks: every student has an ability, a drift (some improve, some slip), and a mood for every subject
  const insM = db.prepare('INSERT INTO exam_marks (paper_id, student_id, marks, status) VALUES (?,?,?,?)');
  db.transaction(() => {
    [[t1, 1], [t2, 2], [t3, 3]].forEach(([eid, t]) => {
      const papers = db.prepare('SELECT p.id, p.section_id, p.subject_id, p.max_marks FROM exam_papers p WHERE p.exam_id = ?').all(eid) as any[];
      for (const p of papers) {
        if (eid === t3 && p.id % 3 === 0) continue;                  // some teachers have not entered Test 3 yet
        for (const s of db.prepare("SELECT id FROM students WHERE section_id = ? AND status = 'active'").all(p.section_id) as { id: number }[]) {
          const base = s.id % 11 === 0 ? 30 + (s.id % 9) : 38 + ((s.id * 53) % 100) * 0.55;
          const drift = (((s.id * 29) % 21) - 10) / 2 - (s.id % 10 === 3 ? 9 : 0);
          const pct = Math.max(12, Math.min(99, base + drift * (t - 1) + (((s.id * 7 + p.subject_id * 13) % 21) - 10) + (rnd(13) - 6)));
          const roll = rnd(1000);
          if (roll < 20) insM.run(p.id, s.id, null, 'A'); else if (roll < 25) insM.run(p.id, s.id, null, 'L');
          else insM.run(p.id, s.id, Math.round((pct / 100) * p.max_marks * 2) / 2, 'P');
        }
      }
    });
  })();

  // guardian calls for Test 2: some already called, some with a meeting date
  const secs2 = db.prepare('SELECT id FROM sections').all() as { id: number }[];
  let n = 0;
  db.transaction(() => {
    for (const sec of secs2) for (const st of examCompute(t2, sec.id, true).students) {
      if (!st.needsCall) continue;
      const k = n++ % 10;
      const status = k < 3 ? 'called' : k < 4 ? 'meeting_set' : k < 5 ? 'attended' : 'pending';
      db.prepare('INSERT INTO exam_followups (exam_id, student_id, reason, pct, prev_pct, failed, status, call_date, ptm_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(t2, st.id, st.reason, st.pct, st.prev?.pct ?? null, st.failed.join(', ') || null, status, status === 'pending' ? null : '2026-09-24', status === 'meeting_set' || status === 'attended' ? '2026-09-30' : null, status === 'called' ? 'Parent will visit with the result card.' : null);
    }
  })();
  console.log(`Exam demo: categories set for ${stud.length} students, 3 tests + send-up exam, ${n} guardian follow-ups.`);
}

// ---------------------------------------------------------------------------
// Syllabus demo data: a week-wise plan for every class and subject, events, teaching progress
// ---------------------------------------------------------------------------
import './syllabus/schema.js';
import { insertItems, monthsBetween as sylMonths, sylConfig, weekRange as sylWeek } from './syllabus/service.js';

if ((db.prepare('SELECT COUNT(*) AS n FROM syl_plans').get() as { n: number }).n > 0) {
  console.log('Syllabus data already exists, skipped.');
} else {
  const CH: Record<string, string[]> = {
    English: ['Reading comprehension', 'Grammar: tenses', 'Letter and application writing', 'Vocabulary and word study', 'Poetry appreciation', 'Story writing and dialogue', 'Essay writing', 'Revision and exam skills'],
    Urdu: ['Nasr: sabaq aur mashq', 'Qawaid: ism aur fail', 'Khat aur darkhwast', 'Nazm: tashreeh', 'Muhawre aur zarbul misal', 'Mazmoon nigari', 'Kahani aur tarjuma', 'Dohrai aur imtihani tayyari'],
    Mathematics: ['Number systems', 'Algebraic expressions', 'Linear equations', 'Geometry: angles and triangles', 'Ratio, proportion and percentage', 'Mensuration', 'Data handling', 'Revision and problem solving'],
    Science: ['Matter and its states', 'Force and motion', 'Energy forms', 'Living things and cells', 'Human body systems', 'Plants and photosynthesis', 'Electricity and magnetism', 'Environment and revision'],
    Islamiyat: ['Tauheed and Risalat', 'Seerat un Nabi', 'Pillars of Islam', 'Akhlaq and manners', 'Quran: selected surahs', 'Hadith and dua', 'Islamic history', 'Revision'],
    'Social Studies': ['Our country Pakistan', 'Maps and globe', 'Government and citizens', 'History of Pakistan', 'Economy and resources', 'Culture and heritage', 'World neighbours', 'Revision'],
    Computer: ['Introduction to computers', 'Hardware and software', 'Operating system basics', 'MS Word', 'MS Excel', 'MS PowerPoint', 'Internet safety and email', 'Programming basics'],
    Drawing: ['Lines and shapes', 'Colour theory', 'Still life', 'Landscape', 'Design and pattern', 'Calligraphy', 'Poster making', 'Portfolio and revision'],
    'Physical Education': ['Warm up and fitness', 'Athletics', 'Cricket skills', 'Football skills', 'Hygiene and health', 'Team games', 'Sports rules', 'Fitness test'],
    Nazra: ['Noorani Qaida revision', 'Makharij', 'Tajweed rules', 'Surah selection 1', 'Surah selection 2', 'Surah selection 3', 'Dua and masnoon azkar', 'Revision'],
    Physics: ['Physical quantities and units', 'Kinematics', 'Dynamics', 'Work, energy and power', 'Waves and sound', 'Heat and thermodynamics', 'Electricity', 'Revision and numericals'],
    Chemistry: ['Atoms and molecules', 'Periodic table', 'Chemical bonding', 'Acids, bases and salts', 'Chemical reactions', 'Organic chemistry basics', 'Electrochemistry', 'Revision and practicals'],
    Biology: ['Cell biology', 'Nutrition', 'Transport in living things', 'Respiration', 'Reproduction', 'Genetics and inheritance', 'Ecology', 'Revision and diagrams'],
    'Pak Studies': ['Ideology of Pakistan', 'Pakistan movement', 'Constitution', 'Geography of Pakistan', 'Resources and economy', 'Culture', 'Foreign relations', 'Revision']
  };
  const cfg = sylConfig(), months = sylMonths(cfg.start, cfg.end), today = attToday();
  const pairs = db.prepare(`SELECT DISTINCT s.class_id, ss.subject_id, sub.name AS subject, AVG(ss.periods_per_week) AS ppw FROM section_subjects ss JOIN sections s ON s.id = ss.section_id JOIN subjects sub ON sub.id = ss.subject_id GROUP BY s.class_id, ss.subject_id`).all() as any[];
  const authors = db.prepare("SELECT id FROM users WHERE username IN ('principal','teacher') ORDER BY id").all() as { id: number }[];
  const partNames = [['Introduction and key terms', 'lesson', 'Teacher explanation with board work and examples', 'Oral questions'], ['Core concepts and examples', 'lesson', 'Group discussion and solved examples', 'Homework: exercise questions'],
    ['Practice and exercises', 'activity', 'Pair work and worksheet', 'Class quiz'], ['Revision and monthly test', 'revision', 'Revision games and question bank', 'Monthly class test']];
  let np = 0, ni = 0, pr = 0;
  for (const pair of pairs) {
    if ((pair.class_id * 7 + pair.subject_id) % 9 === 0) continue;                       // a few subjects have no plan yet
    const h = (pair.class_id * 11 + pair.subject_id * 5) % 20, status = h < 13 ? 'approved' : h < 16 ? 'submitted' : 'draft';
    const chapters = CH[pair.subject] ?? CH['Science'], ppw = Math.max(1, Math.round(pair.ppw));
    const author = authors[(pair.class_id + pair.subject_id) % Math.max(1, authors.length)]?.id ?? 1;
    const pid = Number(db.prepare('INSERT INTO syl_plans (session, class_id, subject_id, overview, books, assessment, status, author_id, approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(cfg.session, pair.class_id, pair.subject_id, `Yearly plan of ${pair.subject}. The syllabus is divided into eight units, one unit every month, with revision in the last week of each month.`, `${pair.subject} textbook of the board (latest edition) and teacher notes`,
        'Monthly class test, fortnightly tests, send-up and board papers. Homework is checked every week.', status, author, status === 'approved' ? 1 : null, status === 'approved' ? '2026-07-30 10:00:00' : null).lastInsertRowid);
    const rows: any[] = [];
    months.forEach((m, mi) => partNames.forEach(([part, kind, act, assess], w) => rows.push({
      month: m, week: w + 1, kind, topic: `${chapters[mi % chapters.length]}: ${part.toLowerCase()}`, chapter: `Unit ${(mi % chapters.length) + 1}`,
      outcomes: `Students understand and can apply ${chapters[mi % chapters.length].toLowerCase()} (${part.toLowerCase()}).`, activities: act, resources: 'Textbook, board, worksheets', assessment: assess, periods: ppw })));
    ni += insertItems(pid, rows); np++;
    // how far each section has got
    if (status !== 'draft') {
      const items = db.prepare('SELECT id, month, week FROM syl_items WHERE plan_id = ? ORDER BY month, week').all(pid) as any[];
      for (const sec of db.prepare('SELECT id FROM sections WHERE class_id = ?').all(pair.class_id) as { id: number }[]) {
        const pace = [1, 1, 1, 0.9, 0.55][(sec.id * 3 + pair.subject_id) % 5];
        const past = items.filter(i => sylWeek(i.month, i.week).to < today);
        past.forEach((i, k) => {
          const done = rnd(100) < pace * 100 + (k < 3 ? 8 : 0);
          db.prepare('INSERT OR IGNORE INTO syl_progress (item_id, section_id, status, done_date, updated_by) VALUES (?,?,?,?,1)').run(i.id, sec.id, done ? 'done' : 'pending', done ? sylWeek(i.month, i.week).to : null); pr++;
        });
      }
    }
  }
  const ev = db.prepare('INSERT INTO syl_events (date, to_date, title, kind) VALUES (?,?,?,?)');
  ev.run('2026-10-25', '2026-10-25', 'Parent meeting (PTM) at KMCB, categories A and B', 'ptm'); ev.run('2026-10-26', '2026-10-26', 'Parent meeting (PTM) at Govt Associate College, category C', 'ptm');
  ev.run('2026-11-06', '2026-11-06', 'Sports day', 'event'); ev.run('2026-11-13', '2026-11-13', 'Last date to submit board admission forms', 'deadline'); ev.run('2027-03-10', '2027-03-10', 'Annual prize distribution', 'event');
  db.prepare("INSERT OR IGNORE INTO att_holidays (date, name) VALUES ('2026-11-09', 'Iqbal Day')").run();
  for (let d = Date.parse('2026-12-24'); d <= Date.parse('2027-01-03'); d += 86400000) db.prepare("INSERT OR IGNORE INTO att_holidays (date, name) VALUES (?, 'Winter vacation')").run(new Date(d).toISOString().slice(0, 10));
  console.log(`Syllabus demo: ${np} plans, ${ni} topics, ${pr} progress records.`);
}

// ---------------------------------------------------------------------------
// Transport demo data: drivers, buses, routes with stops, students on buses, running costs
// ---------------------------------------------------------------------------
import './transport/schema.js';
import { assignTransport as trAssign } from './transport/service.js';

if ((db.prepare('SELECT COUNT(*) AS n FROM tr_routes').get() as { n: number }).n > 0) {
  console.log('Transport data already exists, skipped.');
} else {
  const addD = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const insS = db.prepare('INSERT INTO tr_staff (name, role, phone, cnic, license_no, license_expiry) VALUES (?,?,?,?,?,?)');
  const dr = ['Muhammad Akram', 'Abdul Ghafoor', 'Rashid Mehmood', 'Zafar Iqbal', 'Naseer Ahmed'].map((n, i) => Number(insS.run(n, 'driver', `03${rnd(5)}${String(1000000 + rnd(8999999))}`, `37301-${String(1000000 + rnd(8999999))}-${rnd(9)}`, `LHR-${2015 + i}-${100 + rnd(900)}`, [addD(14), addD(240), addD(400), addD(-8), addD(180)][i]).lastInsertRowid));
  const co = ['Sajid Ali', 'Mushtaq Hussain', 'Tahir Mehmood', 'Imtiaz Khan'].map(n => Number(insS.run(n, 'conductor', `03${rnd(5)}${String(1000000 + rnd(8999999))}`, null, null, null).lastInsertRowid));
  const insV = db.prepare('INSERT INTO tr_vehicles (number, reg_no, kind, capacity, make_model, year, driver_id, conductor_id, fitness_expiry, permit_expiry, insurance_expiry, tax_expiry, next_service) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const veh = [
    ['Bus 1', 'RIA-1201', 'bus', 45, 'Hino AK', 2016, dr[0], co[0], addD(120), addD(200), addD(90), addD(150), addD(25)],
    ['Bus 2', 'RIA-2234', 'bus', 40, 'Isuzu', 2018, dr[1], co[1], addD(18), addD(300), addD(60), addD(150), addD(9)],
    ['Bus 3', 'RIA-3345', 'bus', 50, 'Hino RK', 2014, dr[2], co[2], addD(200), addD(-6), addD(40), addD(120), addD(40)],
    ['Coaster 1', 'RIA-4456', 'coaster', 28, 'Toyota Coaster', 2019, dr[3], co[3], addD(250), addD(250), addD(300), addD(220), addD(60)],
    ['Coaster 2', 'RIA-5567', 'coaster', 14, 'Toyota Hiace', 2020, dr[4], null, addD(300), addD(300), addD(100), addD(100), addD(75)]
  ].map(v => Number(insV.run(...v as any).lastInsertRowid));
  const insR = db.prepare('INSERT INTO tr_routes (name, area, vehicle_id, morning_time, afternoon_time, fee_both, fee_one) VALUES (?,?,?,?,?,?,?)');
  const insP = db.prepare('INSERT INTO tr_stops (route_id, name, sort, pickup_time, drop_time) VALUES (?,?,?,?,?)');
  const R: [string, string, number, string, string, number, number, string[]][] = [
    ['Model Town', 'Model Town, Satellite Town and Hamid Colony', veh[0], '06:45', '14:30', 2500, 1500, ['Model Town Chowk', 'Model Town Park', 'Main Market', 'Jamia Masjid', 'Hamid Colony']],
    ['Kahuta', 'Kahuta city and nearby villages', veh[1], '07:00', '14:30', 1800, 1000, ['Kahuta Bus Stand', 'Hospital Road', 'Bazaar Chowk', 'Tehsil Office']],
    ['Rawalpindi', 'Rawalpindi Saddar to Kahuta Road', veh[2], '06:15', '15:00', 3500, 2000, ['Saddar', 'Committee Chowk', 'Raja Bazaar', 'Chaklala', 'Faizabad']],
    ['Lehtrar Road', 'Lehtrar Road and Sohan', veh[3], '06:50', '14:30', 2200, 1300, ['Sohan Chowk', 'Lehtrar Road Stop', 'Kallar Syedan Mor']],
    ['Gulshan Colony', 'Gulshan-e-Iqbal Colony', veh[4], '07:10', '14:30', 1500, 900, ['Gulshan Gate', 'Colony Park', 'Water Tank']]
  ];
  const routes = R.map(([name, area, v, m, a, f1, f2, stops]) => {
    const rid = Number(insR.run(name, area, v, m, a, f1, f2).lastInsertRowid);
    const ids = stops.map((s, i) => Number(insP.run(rid, s, i + 1, `${m.slice(0, 2)}:${String(Number(m.slice(3)) + i * 7).padStart(2, '0')}`, `${a.slice(0, 2)}:${String(Number(a.slice(3)) + i * 5).padStart(2, '0')}`).lastInsertRowid));
    return { rid, stops: ids };
  });
  // students: roughly one in three uses a bus (this also replaces the sample transport fees of the fee demo)
  const studs = db.prepare("SELECT id FROM students WHERE status = 'active' ORDER BY id").all() as { id: number }[];
  let nt = 0;
  db.transaction(() => {
    for (const { id } of studs) {
      if (id % 3 !== 0 && id % 12 !== 0) continue;
      const h = (id * 7) % 100, ri = h < 20 ? 0 : h < 48 ? 1 : h < 66 ? 2 : h < 78 ? 3 : 4, r = routes[ri], m = (id * 13) % 100;
      trAssign(id, r.rid, r.stops[id % r.stops.length], m < 70 ? 'both' : m < 85 ? 'pickup' : 'drop'); nt++;
    }
  })();
  // who boarded
  const insB = db.prepare('INSERT OR IGNORE INTO tr_boarding (route_id, student_id, date, trip, status) VALUES (?,?,?,?,?)');
  const dates = (db.prepare('SELECT DISTINCT date FROM att_daily ORDER BY date DESC LIMIT 5').all() as { date: string }[]).map(r => r.date);
  let nb = 0;
  db.transaction(() => {
    for (const d of dates) for (const s of db.prepare("SELECT id, tr_route_id, tr_mode FROM students WHERE tr_route_id IS NOT NULL AND status = 'active'").all() as any[])
      for (const trip of ['morning', 'afternoon'] as const) {
        if ((trip === 'morning' && s.tr_mode === 'drop') || (trip === 'afternoon' && s.tr_mode === 'pickup')) continue;
        insB.run(s.tr_route_id, s.id, d, trip, rnd(100) < 94 ? 'boarded' : 'absent'); nb++;
      }
  })();
  console.log(`Transport demo: 5 buses, ${routes.length} routes, ${nt} students on buses, bus attendance for ${dates.length} days (${nb} records).`);
}

// ---------------------------------------------------------------------------
// HR demo data: staff with salaries, 3 months of attendance, leaves, a loan, salary sheets, recruitment
// ---------------------------------------------------------------------------
if ((db.prepare('SELECT COUNT(*) AS n FROM hr_staff').get() as { n: number }).n > 0) {
  console.log('HR data already exists, skipped.');
} else {
  const today = todayISO();
  const monthsBack = (k: number) => { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - k, 1)); return d.toISOString().slice(0, 7); };
  const months = [monthsBack(3), monthsBack(2), monthsBack(1)];
  const imp = importExisting();
  // office staff (and a staff record for the demo admin and accountant logins)
  const office: [string, string, string, string, number, string, string | null][] = [
    ['Rashid Mehmood', 'office', 'Clerk', 'Administration', 38000, '2023-04-01', null],
    ['Shabana Kausar', 'accounts', 'Accountant', 'Accounts', 55000, '2022-08-15', null],
    ['Ghulam Abbas', 'support', 'Naib Qasid', 'Support', 26000, '2021-02-01', null],
    ['Muhammad Nawaz', 'support', 'Security Guard', 'Support', 27000, '2024-06-10', null],
    ['Tahira Parveen', 'lab_attendant', 'Lab Attendant', 'Support', 32000, '2026-09-01', '2027-03-01']
  ];
  const insS = db.prepare(`INSERT INTO hr_staff (emp_no, name, father_name, gender, cnic, phone, staff_type, kind, department, designation, employment, joining_date, contract_end, basic_salary, house_allow, medical_allow, conveyance_allow, qualification, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    office.forEach(([name, type, desig, dept, basic, join, end], i) => {
      const user = type === 'accounts' ? db.prepare("SELECT id FROM users WHERE role = 'accountant' ORDER BY id LIMIT 1").get() as any : i === 0 ? db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as any : null;
      insS.run(nextEmpNo(), name, `Muhammad ${pick(surnames)}`, name.startsWith('T') || name.startsWith('S') ? 'female' : 'male', `37405-${String(1000000 + rnd(8999999))}-${rnd(9)}`, `03${rnd(5)}${String(1000000 + rnd(8999999))}`,
        type, kindOfType(type), dept, desig, end ? 'probation' : 'permanent', join, end, basic, 0, 0, 0, type === 'accounts' ? 'M.Com' : 'Matric', user?.id ?? null);
    });
    // salaries and join dates for the imported teachers and drivers
    const people = db.prepare("SELECT id, staff_type FROM hr_staff WHERE basic_salary = 0").all() as { id: number; staff_type: string }[];
    people.forEach((p, i) => {
      const basic = p.staff_type === 'teacher' ? 42000 + (i % 6) * 4000 : 28000 + (i % 3) * 1500;
      db.prepare('UPDATE hr_staff SET basic_salary = ?, house_allow = ?, medical_allow = ?, conveyance_allow = ?, joining_date = ?, qualification = ?, employment = ?, gender = ? WHERE id = ?')
        .run(basic, Math.round(basic * 0.15), 2000, p.staff_type === 'teacher' ? 3000 : 0, `${2019 + (i % 7)}-0${1 + (i % 8)}-01`, p.staff_type === 'teacher' ? (i % 2 ? 'M.Sc' : 'M.A, B.Ed') : 'Matric', 'permanent', i % 3 === 0 ? 'female' : 'male', p.id);
    });
    db.prepare("UPDATE hr_staff SET fixed_deduction = 1500 WHERE staff_type = 'teacher'").run();
    db.prepare("UPDATE hr_staff SET employment = 'contract', contract_end = date('now', '+20 days') WHERE id = (SELECT id FROM hr_staff WHERE staff_type = 'teacher' ORDER BY id DESC LIMIT 1)").run();
    for (const s of db.prepare('SELECT id FROM hr_staff').all() as { id: number }[]) syncLinked(s.id);
  })();
  const staff = db.prepare('SELECT * FROM hr_staff').all() as any[];

  // leaves: approved ones go onto the register, plus a couple waiting for the principal
  const types = db.prepare('SELECT id, name FROM hr_leave_types').all() as { id: number; name: string }[];
  const tid = (n: string) => types.find(t => t.name.startsWith(n))!.id;
  const insL = db.prepare('INSERT INTO hr_leaves (staff_id, type_id, from_date, to_date, days, reason, status, decided_at) VALUES (?,?,?,?,?,?,?,?)');
  const addLeave = (si: number, type: string, from: string, to: string, reason: string, status: string) => {
    const s = staff[si % staff.length]; const days = leaveDays(from, to); if (!days) return;
    const id = Number(insL.run(s.id, tid(type), from, to, days, reason, status, status === 'pending' ? null : from).lastInsertRowid);
    if (status === 'approved') applyLeaveToRegister(id, 1);
  };
  addLeave(1, 'Casual', `${months[0]}-12`, `${months[0]}-13`, 'Family function', 'approved');
  addLeave(2, 'Sick', `${months[1]}-08`, `${months[1]}-10`, 'Fever', 'approved');
  addLeave(3, 'Unpaid', `${months[1]}-20`, `${months[1]}-22`, 'Personal work', 'approved');
  addLeave(0, 'Casual', `${months[2]}-15`, `${months[2]}-15`, 'Visit to the bank', 'approved');
  const ahead: string[] = [];
  for (let k = 1; ahead.length < 2 && k < 30; k++) { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k); const iso = d.toISOString().slice(0, 10); if (dayInfo(iso).working) ahead.push(iso); }
  if (ahead.length === 2) addLeave(4, 'Casual', ahead[0], ahead[1], 'Wedding', 'pending');
  addLeave(5, 'Sick', `${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-01`, 'Headache', 'rejected');

  // attendance for every school day since the start of the first month (a few staff have not been marked today)
  const insA = db.prepare("INSERT OR IGNORE INTO hr_att (staff_id, date, status, time_in, time_out, marked_by) VALUES (?,?,?,?,?,1)");
  const start = new Date(`${months[0]}-01T00:00:00Z`);
  let na = 0;
  db.transaction(() => {
    for (let d = new Date(start); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (!dayInfo(iso).working) continue;
      for (const s of staff) {
        if (s.joining_date && iso < s.joining_date) continue;
        if (iso === today && rnd(100) < 30) continue;
        const r = rnd(100);
        const hh = 7 + (r < 8 ? 1 : 0), mm = r < 8 ? 10 + rnd(40) : rnd(40);
        const status = r < 4 ? 'A' : r < 6 ? 'HD' : r < 12 ? 'LT' : 'P';
        insA.run(s.id, iso, status, status === 'A' ? null : `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, status === 'A' ? null : '14:05'); na++;
      }
    }
  })();

  // a loan being paid back, and some extras
  const lender = staff[2];
  db.prepare('INSERT INTO hr_loans (staff_id, kind, total, installment, start_month, note) VALUES (?,?,?,?,?,?)').run(lender.id, 'loan', 30000, 5000, months[1], 'Medical expenses');
  db.prepare('INSERT INTO hr_adjustments (staff_id, month, kind, amount, note) VALUES (?,?,?,?,?)').run(staff[0].id, months[2], 'bonus', 5000, 'Good results');
  db.prepare('INSERT INTO hr_adjustments (staff_id, month, kind, amount, note) VALUES (?,?,?,?,?)').run(staff[1].id, months[2], 'overtime', 3000, 'Exam duty');
  db.prepare('INSERT INTO hr_adjustments (staff_id, month, kind, amount, note) VALUES (?,?,?,?,?)').run(staff[3].id, months[1], 'advance', 4000, 'Advance salary');

  // salary sheets: the first two months paid, the last one approved and waiting to be paid
  months.forEach((m, i) => {
    generatePayroll(m);
    db.prepare("UPDATE hr_payslips SET status = ?, approved_by = 1, paid_date = ?, paid_by = 1 WHERE month = ?").run(i < 2 ? 'paid' : 'approved', i < 2 ? `${months[i + 1]}-03` : null, m);
  });

  // recruitment: two posts, candidates at every stage
  const insJ = db.prepare('INSERT INTO hr_jobs (title, department, kind, positions, qualification, experience, salary_range, description, posted_date, last_date) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const j1 = Number(insJ.run('Mathematics Teacher (Class 9 to 12)', 'Teaching', 'teaching', 2, 'MSc Mathematics, B.Ed preferred', '2 years', 'Rs 45,000 to 60,000', 'Teach Mathematics to matric and intermediate classes. Timing 8:00 am to 2:00 pm.', `${months[2]}-25`, `${today.slice(0, 7)}-30`).lastInsertRowid);
  const j2 = Number(insJ.run('Office Clerk', 'Administration', 'non_teaching', 1, 'Intermediate with computer skills', '1 year', 'Rs 35,000', 'Admission and record work at the front desk.', `${months[2]}-25`, `${today.slice(0, 7)}-30`).lastInsertRowid);
  const cands: [number, string, number, string, number, number, number, string][] = [
    [j1, 'Sidra Tariq', 4, 'MSc Mathematics, B.Ed', 55000, 5, 4, 'interview'], [j1, 'Kamran Shafique', 1, 'BSc Mathematics', 40000, 3, 1, 'shortlisted'], [j1, 'Nabeela Asif', 6, 'MPhil Mathematics', 60000, 5, 3, 'offered'],
    [j1, 'Adeel Hussain', 0, 'BS Mathematics', 38000, 2, 1, 'applied'], [j1, 'Farah Naz', 2, 'MSc Mathematics', 48000, 4, 2, 'applied'], [j1, 'Waheed Gul', 3, 'MSc Physics', 45000, 3, 1, 'rejected'],
    [j2, 'Hamid Raza', 2, 'FA, DCS', 35000, 4, 2, 'interview'], [j2, 'Rubina Kanwal', 1, 'ICom', 33000, 3, 1, 'shortlisted'], [j2, 'Zubair Ahmed', 0, 'FSc', 30000, 2, 0, 'applied']
  ];
  const insC = db.prepare('INSERT INTO hr_candidates (job_id, name, phone, email, qualification, experience_years, expected_salary, rating, stage, city, source, applied_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const interviewDay = new Date(`${today}T00:00:00Z`); interviewDay.setUTCDate(interviewDay.getUTCDate() + 2);
  const idate = interviewDay.toISOString().slice(0, 10);
  cands.forEach(([job, name, exp, qual, sal, rating, _x, stage], i) => {
    const id = Number(insC.run(job, name, `03${rnd(5)}${String(1000000 + rnd(8999999))}`, `${name.split(' ')[0].toLowerCase()}@example.com`, qual, exp, sal, rating, stage, 'Rawalpindi', i % 2 ? 'Newspaper' : 'Referral', `${months[2]}-28`).lastInsertRowid);
    if (stage === 'interview') db.prepare("INSERT INTO hr_interviews (candidate_id, round, date, time, venue, panel) VALUES (?,?,?,?,?,?)").run(id, 'Interview', idate, `${String(9 + (i % 3)).padStart(2, '0')}:00`, 'Principal office', 'Principal, HOD');
    if (stage === 'offered') db.prepare("UPDATE hr_candidates SET offer_designation = 'Mathematics Teacher', offer_salary = 55000, offer_date = ?, joining_date = ?, offer_employment = 'probation' WHERE id = ?").run(today, idate, id);
    if (stage === 'rejected') db.prepare("UPDATE hr_candidates SET reject_reason = 'Subject does not match' WHERE id = ?").run(id);
  });
  console.log(`HR demo: ${staff.length} staff (${imp.teachers} teachers, ${imp.drivers} drivers imported), ${na} attendance records, salary sheets for ${months.join(', ')}, 2 job posts and ${cands.length} candidates.`);
}

seedExtras();
