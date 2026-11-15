import { db } from '../db.js';
import { acceptStrong } from '../family.js';
import { applyCategoryRules } from '../fee/service.js';
import { kindOfType, nextEmpNo } from '../hr/service.js';
import { parseCsv, toCsv } from './csv.js';
import { clean, digits, isLeft, norm, parseClass, parseDate, parseGender, parseMoney, parsePhone } from './values.js';

export type Kind = 'students' | 'staff';
export interface Field { key: string; label: string; aliases: string[]; required?: boolean; hint?: string }

// Aliases are compared after lower-casing and removing spaces/punctuation, so "Father's Name", "FATHER NAME" and "father_name" are all the same.
export const FIELDS: Record<Kind, Field[]> = {
  students: [
    { key: 'name', label: 'Student name', required: true, aliases: ['name', 'studentname', 'student', 'nameofstudent', 'fullname', 'studentfullname', 'naam', 'طالبعلم', 'نام', 'pupilname', 'childname'] },
    { key: 'class', label: 'Class (6, 6-A, Six B ...)', required: true, aliases: ['class', 'grade', 'classname', 'std', 'standard', 'currentclass', 'classsection', 'کلاس', 'cls', 'classofstudent'] },
    { key: 'section', label: 'Section', aliases: ['section', 'sec', 'sectionname', 'سیکشن', 'div', 'division'] },
    { key: 'father_name', label: 'Father name', aliases: ['fathername', 'father', 'fathersname', 'nameoffather', 'guardian', 'guardianname', 'walid', 'والد', 'fname', 'parentname', 'sonof', 'sdw'] },
    { key: 'reg_no', label: 'Admission / registration no.', aliases: ['regno', 'regnumber', 'registrationno', 'registration', 'admissionno', 'admno', 'admissionnumber', 'adm', 'grno', 'grnumber', 'rollnoadmission', 'studentid', 'id', 'sno', 'admissionid'] },
    { key: 'roll_no', label: 'Roll no.', aliases: ['rollno', 'roll', 'rollnumber', 'classroll', 'rno'] },
    { key: 'gender', label: 'Gender', aliases: ['gender', 'sex', 'جنس', 'mf', 'boygirl'] },
    { key: 'dob', label: 'Date of birth', aliases: ['dob', 'dateofbirth', 'birthdate', 'birthday', 'birth', 'dateofbirthdob', 'تاریخپیدائش', 'bdate'] },
    { key: 'father_cnic', label: 'Father CNIC', aliases: ['fathercnic', 'cnic', 'fathernic', 'guardiancnic', 'nic', 'cnicno', 'fathercnicno', 'parentcnic', 'idcardno', 'fathercnicnumber'] },
    { key: 'phone', label: 'Phone / mobile', aliases: ['phone', 'mobile', 'contact', 'cell', 'phoneno', 'mobileno', 'contactno', 'fathermobile', 'fatherphone', 'fathercell', 'whatsapp', 'telephone', 'mobilenumber', 'phonenumber', 'ٹیلیفون', 'موبائل', 'fathercontact', 'guardianphone', 'guardianmobile'] },
    { key: 'mother_phone', label: 'Mother phone', aliases: ['motherphone', 'mothermobile', 'mothercell', 'mothercontact', 'phone2', 'mobile2', 'contact2', 'alternatephone', 'othercontact'] },
    { key: 'address', label: 'Address', aliases: ['address', 'residence', 'homeaddress', 'پتہ', 'addr', 'permanentaddress'] },
    { key: 'category', label: 'Category (A/B/C)', aliases: ['category', 'cat', 'feecategory', 'studentcategory'] },
    { key: 'status', label: 'Status (active / left)', aliases: ['status', 'studentstatus', 'active', 'currentstatus', 'leftstatus', 'condition'] },
    { key: 'admission_date', label: 'Admission date', aliases: ['admissiondate', 'dateofadmission', 'doa', 'admitdate', 'dateadmitted', 'admittedon', 'داخلہ'] }
  ],
  staff: [
    { key: 'name', label: 'Staff name', required: true, aliases: ['name', 'staffname', 'employeename', 'nameofemployee', 'fullname', 'teachername', 'naam', 'نام', 'empname', 'nameofstaff'] },
    { key: 'emp_no', label: 'Employee no.', aliases: ['empno', 'employeeno', 'employeeid', 'empid', 'staffid', 'staffno', 'id', 'sno', 'employeenumber', 'code', 'empcode'] },
    { key: 'father_name', label: 'Father name', aliases: ['fathername', 'father', 'fathersname', 'nameoffather', 'walid', 'والد', 'sonof', 'sdw'] },
    { key: 'designation', label: 'Designation / post', aliases: ['designation', 'post', 'position', 'job', 'jobtitle', 'title', 'role', 'عہدہ', 'postname', 'subject', 'work', 'duty'] },
    { key: 'department', label: 'Department', aliases: ['department', 'dept', 'section', 'wing', 'شعبہ'] },
    { key: 'cnic', label: 'CNIC', aliases: ['cnic', 'cnicno', 'nic', 'idcardno', 'cnicnumber', 'nicno'] },
    { key: 'phone', label: 'Phone / mobile', aliases: ['phone', 'mobile', 'contact', 'cell', 'phoneno', 'mobileno', 'contactno', 'telephone', 'mobilenumber', 'phonenumber', 'موبائل'] },
    { key: 'email', label: 'Email', aliases: ['email', 'emailaddress', 'mail', 'emailid'] },
    { key: 'gender', label: 'Gender', aliases: ['gender', 'sex', 'جنس'] },
    { key: 'dob', label: 'Date of birth', aliases: ['dob', 'dateofbirth', 'birthdate', 'birthday', 'birth'] },
    { key: 'qualification', label: 'Qualification', aliases: ['qualification', 'education', 'degree', 'qualifications', 'تعلیم', 'edu'] },
    { key: 'address', label: 'Address', aliases: ['address', 'residence', 'homeaddress', 'پتہ', 'addr'] },
    { key: 'joining_date', label: 'Joining date', aliases: ['joiningdate', 'dateofjoining', 'doj', 'joined', 'datejoined', 'appointmentdate', 'dateofappointment', 'joinedon', 'dateofjoin'] },
    { key: 'basic_salary', label: 'Salary (monthly)', aliases: ['salary', 'basicsalary', 'basic', 'pay', 'monthlysalary', 'grosssalary', 'wage', 'تنخواہ', 'salaryrs', 'basicpay'] },
    { key: 'employment', label: 'Employment (permanent / contract ...)', aliases: ['employment', 'employmenttype', 'jobtype', 'nature', 'natureofjob', 'appointmenttype', 'contracttype'] },
    { key: 'status', label: 'Status (active / left)', aliases: ['status', 'staffstatus', 'currentstatus', 'active'] }
  ]
};

/** Which file column holds which field. Exact alias first, then a column whose name contains an alias (4+ letters). One column per field. */
export function autoMap(kind: Kind, headers: string[]): Record<string, string> {
  const heads = headers.map(norm), used = new Set<number>(), map: Record<string, string> = {};
  const give = (f: Field, i: number) => { map[headers[i]] = f.key; used.add(i); };
  for (const f of FIELDS[kind]) { const i = heads.findIndex((h, k) => !used.has(k) && h && f.aliases.includes(h)); if (i >= 0) give(f, i); }
  for (const f of FIELDS[kind]) {
    if (Object.values(map).includes(f.key)) continue;
    const i = heads.findIndex((h, k) => !used.has(k) && h.length >= 4 && f.aliases.some(a => a.length >= 4 && (h.includes(a) || a.includes(h))));
    if (i >= 0) give(f, i);
  }
  return map;
}
export function detectKind(headers: string[]): Kind {
  const score = (k: Kind, sig: string[]) => { const m = Object.values(autoMap(k, headers)); return m.length + sig.filter(s => m.includes(s)).length * 3; };
  return score('staff', ['designation', 'basic_salary', 'joining_date', 'emp_no', 'department']) > score('students', ['class', 'section', 'father_name', 'reg_no', 'roll_no']) ? 'staff' : 'students';
}

export interface Opts { kind?: Kind; mapping?: Record<string, string>; createMissing?: boolean }
export interface RowResult { line: number; status: 'new' | 'duplicate' | 'error'; problems: string[]; warnings: string[]; raw: string[]; data: Record<string, any>; summary: string }

const STAFF_TYPES: [RegExp, string][] = [[/driver|ڈرائیور/i, 'driver'], [/conductor|کنڈکٹر/i, 'conductor'], [/lab/i, 'lab_attendant'], [/account|cashier|bursar|fee/i, 'accounts'],
  [/teach|lectur|instruct|tutor|ustad|ustaad|mudarris|professor|hod|headmaster|headmistress|principal|استاد|معلم|مدرس/i, 'teacher'], [/peon|naib|guard|chowkidar|sweep|maali|mali|cook|helper|attendant|cleaner|mason|waiter|نائب|چوکیدار/i, 'support']];
const staffType = (designation: string) => STAFF_TYPES.find(([re]) => re.test(designation))?.[1] ?? 'office';
const EMPLOYMENT: [RegExp, string][] = [[/contract|ٹھیکہ/i, 'contract'], [/part|visit|hourly/i, 'part_time'], [/prob/i, 'probation'], [/perm|regular|پکا/i, 'permanent']];

/** Looks a section up without writing anything. */
function findSection(grade: number, section: string): number | null {
  const r = db.prepare('SELECT s.id FROM sections s JOIN classes c ON c.id = s.class_id WHERE c.grade = ? AND s.name = ?').get(grade, section) as { id: number } | undefined;
  return r?.id ?? null;
}
/** Used only when saving: creates the class / section if it is missing. */
function ensureSection(grade: number, section: string): number {
  let c = db.prepare('SELECT id FROM classes WHERE grade = ?').get(grade) as { id: number } | undefined;
  if (!c) { db.prepare('INSERT INTO classes (grade, name, stage) VALUES (?,?,?)').run(grade, `Class ${grade}`, grade <= 5 ? 'Primary' : grade <= 8 ? 'Middle' : grade <= 10 ? 'SSC' : 'HSSC'); c = db.prepare('SELECT id FROM classes WHERE grade = ?').get(grade) as { id: number }; }
  db.prepare('INSERT OR IGNORE INTO sections (class_id, name) VALUES (?,?)').run(c.id, section);
  return (db.prepare('SELECT id FROM sections WHERE class_id = ? AND name = ?').get(c.id, section) as { id: number }).id;
}

interface Parsed { headers: string[]; rows: string[][]; delimiter: string; kind: Kind; mapping: Record<string, string> }
export function readFile(text: string, o: Opts): Parsed | string {
  const { rows, delimiter } = parseCsv(String(text ?? ''));
  if (rows.length < 2) return 'The file needs a header row and at least one data row.';
  const headers = rows[0].map((h, i) => clean(h, 80) || `Column ${i + 1}`);
  const kind = o.kind === 'staff' || o.kind === 'students' ? o.kind : detectKind(headers);
  const valid = new Set(FIELDS[kind].map(f => f.key));
  const mapping = o.mapping ? Object.fromEntries(Object.entries(o.mapping).filter(([h, f]) => headers.includes(h) && valid.has(f))) : autoMap(kind, headers);
  return { headers, rows: rows.slice(1), delimiter, kind, mapping };
}

/** Checks every row against the database and the rest of the file. Nothing is written. */
export function check(p: Parsed, o: Opts): RowResult[] {
  const col = new Map<string, number>(); p.headers.forEach((h, i) => { const f = p.mapping[h]; if (f && !col.has(f)) col.set(f, i); });
  const get = (r: string[], k: string) => (col.has(k) ? clean(r[col.get(k)!] ?? '', 300) : '');
  const missingReq = FIELDS[p.kind].filter(f => f.required && !col.has(f.key));
  if (missingReq.length) return [{ line: 1, status: 'error', problems: [`No column is matched to: ${missingReq.map(f => f.label).join(', ')}. Pick it in the column list.`], warnings: [], raw: [], data: {}, summary: '' }];
  return p.kind === 'students' ? checkStudents(p.rows, get, col, o) : checkStaff(p.rows, get, col);
}

function checkStudents(rows: string[][], get: (r: string[], k: string) => string, col: Map<string, number>, o: Opts): RowResult[] {
  const out: RowResult[] = [];
  const seenReg = new Set<string>(), seenKey = new Set<string>();
  const dbReg = new Set((db.prepare('SELECT reg_no FROM students').all() as any[]).map(r => String(r.reg_no).toLowerCase()));
  const dbKey = new Set((db.prepare('SELECT name, father_name, dob FROM students').all() as any[]).map(r => norm(r.name) + '|' + norm(r.father_name) + '|' + (r.dob ?? '')));
  const year = new Date().getFullYear(); let seq = (db.prepare('SELECT COUNT(*) AS n FROM students').get() as any).n;
  const rollUsed = new Map<string, Set<number>>();
  rows.forEach((r, idx) => {
    const line = idx + 2, problems: string[] = [], warnings: string[] = [], notes: string[] = [];
    const d: Record<string, any> = {};
    d.name = get(r, 'name'); if (!d.name) problems.push('Student name is empty.');
    d.father_name = get(r, 'father_name') || '-'; if (col.has('father_name') && d.father_name === '-') warnings.push('Father name is empty');
    const cl = parseClass(get(r, 'class')), secText = get(r, 'section');
    const sec = secText ? (/^[a-z]$/i.test(secText.trim()) ? secText.trim().toUpperCase() : parseClass('6 ' + secText).section ?? secText.trim().toUpperCase().slice(0, 3)) : cl.section;
    if (!cl.grade) problems.push(`Class "${get(r, 'class')}" is not understood (use 6, 6-A, Six B ...).`);
    d.status = isLeft(get(r, 'status')) ? 'left' : 'active';
    if (cl.grade && !problems.length) {
      d.grade = cl.grade; d.sec = sec ?? 'A'; d.class_text = `${d.grade}-${d.sec}`;
      const s = findSection(d.grade, d.sec);
      if (s !== null) d.section_id = s;
      else if (o.createMissing) notes.push(`class ${d.class_text} will be created`);
      else problems.push(`Class ${d.class_text} does not exist. Tick "Create missing classes and sections" to add it.`);
    }
    const g = parseGender(get(r, 'gender')); d.gender = g ?? 'male'; if (!g) warnings.push(col.has('gender') && get(r, 'gender') ? `Gender "${get(r, 'gender')}" not understood, saved as male` : 'No gender, saved as male');
    const dobText = get(r, 'dob'); if (dobText) { const dob = parseDate(dobText); if (!dob) problems.push(`Date of birth "${dobText}" is not a valid date.`); else d.dob = dob; }
    const adText = get(r, 'admission_date'); if (adText) { const ad = parseDate(adText); if (!ad) warnings.push(`Admission date "${adText}" not understood, today's date used`); else d.admission_date = ad; }
    const cnicRaw = get(r, 'father_cnic'); if (cnicRaw) { const c = digits(cnicRaw); if (c.length !== 13) warnings.push(`CNIC "${cnicRaw}" is not 13 digits`); d.father_cnic = c.length === 13 ? `${c.slice(0, 5)}-${c.slice(5, 12)}-${c.slice(12)}` : cnicRaw.slice(0, 20); }
    for (const k of ['phone', 'mother_phone']) { const v = get(r, k); if (!v) continue; const ph = parsePhone(v); if (ph === null) warnings.push(`Phone "${v}" looks wrong`); else d[k] = ph; }
    d.address = get(r, 'address') || null;
    const cat = get(r, 'category').toUpperCase().replace(/[^ABC]/g, '').slice(0, 1); if (get(r, 'category') && !cat) warnings.push(`Category "${get(r, 'category')}" is not A, B or C`); d.category = cat || null;
    const roll = Number(get(r, 'roll_no')); d.roll_no = Number.isInteger(roll) && roll > 0 ? roll : null;
    d.reg_no = get(r, 'reg_no');
    // duplicates: same admission no., or same name + father + date of birth, in the database or earlier in this file
    const keyOf = norm(d.name) + '|' + norm(d.father_name) + '|' + (d.dob ?? '');
    let dup = '';
    if (d.reg_no && (dbReg.has(d.reg_no.toLowerCase()))) dup = `Admission no. ${d.reg_no} is already in the database`;
    else if (d.reg_no && seenReg.has(d.reg_no.toLowerCase())) dup = `Admission no. ${d.reg_no} appears twice in the file`;
    else if (d.name && d.dob && (dbKey.has(keyOf) || seenKey.has(keyOf))) dup = 'Same name, father name and date of birth already exist';
    else if (d.name && !d.reg_no && !d.dob && d.father_name !== '-' && (dbKey.has(keyOf) || seenKey.has(keyOf))) dup = 'Same name and father name already exist';
    if (!problems.length && !dup) {
      if (!d.reg_no) { do { seq++; d.reg_no = `${year}-${String(seq).padStart(4, '0')}`; } while (dbReg.has(d.reg_no.toLowerCase()) || seenReg.has(d.reg_no.toLowerCase())); warnings.push(`No admission no., "${d.reg_no}" given`); }
      seenReg.add(d.reg_no.toLowerCase()); seenKey.add(keyOf);
      if (d.status === 'left') d.roll_no = null;
      else if (d.class_text) {
        const used = rollUsed.get(d.class_text) ?? new Set<number>(), taken = (n: number) => used.has(n) || (d.section_id && !!db.prepare("SELECT 1 FROM students WHERE section_id = ? AND roll_no = ? AND status = 'active'").get(d.section_id, n));
        if (d.roll_no && taken(d.roll_no)) { warnings.push(`Roll no. ${d.roll_no} is already used in that section, a new one is given`); d.roll_no = null; }
        if (!d.roll_no) { let n = (d.section_id ? ((db.prepare("SELECT COALESCE(MAX(roll_no),0) AS n FROM students WHERE section_id = ? AND status = 'active'").get(d.section_id) as any).n as number) : 0) + 1; while (taken(n)) n++; d.roll_no = n; }
        used.add(d.roll_no); rollUsed.set(d.class_text, used);
      }
    }
    out.push({ line, status: problems.length ? 'error' : dup ? 'duplicate' : 'new', problems: dup ? [dup] : problems, warnings: [...warnings, ...notes], raw: r, data: d, summary: `${d.name} - ${d.class_text ?? '?'}${d.status === 'left' ? ' (left)' : ''}` });
  });
  return out;
}

function checkStaff(rows: string[][], get: (r: string[], k: string) => string, col: Map<string, number>): RowResult[] {
  const out: RowResult[] = [];
  const db1 = db.prepare('SELECT emp_no, cnic, name, phone FROM hr_staff').all() as any[];
  const seenEmp = new Set(db1.map(r => String(r.emp_no).toLowerCase())), seenCnic = new Set(db1.map(r => digits(r.cnic)).filter(x => x.length === 13)), seenNP = new Set(db1.map(r => norm(r.name) + '|' + digits(r.phone).slice(-10)));
  const reserved = new Set<string>();
  rows.forEach((r, idx) => {
    const line = idx + 2, problems: string[] = [], warnings: string[] = [], d: Record<string, any> = {};
    d.name = get(r, 'name'); if (!d.name) problems.push('Staff name is empty.');
    d.father_name = get(r, 'father_name') || null; d.designation = get(r, 'designation') || null; d.department = get(r, 'department') || null;
    d.staff_type = staffType(`${d.designation ?? ''} ${d.department ?? ''}`); d.kind = kindOfType(d.staff_type);
    d.employment = EMPLOYMENT.find(([re]) => re.test(get(r, 'employment')))?.[1] ?? 'permanent';
    const c = digits(get(r, 'cnic')); if (get(r, 'cnic')) { if (c.length !== 13) warnings.push('CNIC is not 13 digits'); d.cnic = c.length === 13 ? `${c.slice(0, 5)}-${c.slice(5, 12)}-${c.slice(12)}` : get(r, 'cnic').slice(0, 20); }
    const ph = get(r, 'phone'); if (ph) { const p = parsePhone(ph); if (p === null) warnings.push(`Phone "${ph}" looks wrong`); else d.phone = p; }
    d.email = get(r, 'email') || null; if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) { warnings.push('Email looks wrong, not saved'); d.email = null; }
    d.gender = parseGender(get(r, 'gender')); d.qualification = get(r, 'qualification') || null; d.address = get(r, 'address') || null;
    for (const k of ['dob', 'joining_date']) { const v = get(r, k); if (!v) continue; const x = parseDate(v); if (!x) problems.push(`${k === 'dob' ? 'Date of birth' : 'Joining date'} "${v}" is not a valid date.`); else d[k] = x; }
    const sal = parseMoney(get(r, 'basic_salary')); if (sal === null) problems.push(`Salary "${get(r, 'basic_salary')}" is not a number.`); else d.basic_salary = sal;
    d.status = isLeft(get(r, 'status')) ? 'left' : 'active';
    d.emp_no = get(r, 'emp_no');
    let dup = '';
    if (d.emp_no && seenEmp.has(d.emp_no.toLowerCase())) dup = `Employee no. ${d.emp_no} already exists`;
    else if (c.length === 13 && seenCnic.has(c)) dup = 'A staff member with this CNIC already exists';
    else if (d.name && d.phone && seenNP.has(norm(d.name) + '|' + digits(d.phone).slice(-10))) dup = 'Same name and phone already exist';
    if (!problems.length && !dup) {
      seenEmp.add(d.emp_no.toLowerCase()); if (c.length === 13) seenCnic.add(c); if (d.phone) seenNP.add(norm(d.name) + '|' + digits(d.phone).slice(-10));
      if (d.emp_no) reserved.add(d.emp_no); else warnings.push('No employee no., one is given on saving');
    }
    out.push({ line, status: problems.length ? 'error' : dup ? 'duplicate' : 'new', problems: dup ? [dup] : problems, warnings, raw: r, data: d, summary: `${d.name} - ${d.designation ?? d.staff_type}` });
  });
  return out;
}

export const summarise = (rs: RowResult[]) => ({ total: rs.length, new: rs.filter(r => r.status === 'new').length, duplicate: rs.filter(r => r.status === 'duplicate').length, error: rs.filter(r => r.status === 'error').length, warnings: rs.filter(r => r.warnings.length).length });

export function analyze(text: string, o: Opts) {
  const p = readFile(text, o); if (typeof p === 'string') return { error: p } as const;
  const rows = check(p, o);
  return { kind: p.kind, delimiter: p.delimiter, headers: p.headers, mapping: p.mapping, fields: FIELDS[p.kind].map(({ key, label, required }) => ({ key, label, required: !!required })),
    counts: summarise(rows), sample: p.rows.slice(0, 3), rows: rows.filter(r => r.status !== 'new' || r.warnings.length).slice(0, 300).concat(rows.filter(r => r.status === 'new' && !r.warnings.length).slice(0, 20)).map(({ line, status, problems, warnings, summary }) => ({ line, status, problems, warnings, summary })) };
}

/** Saves the rows that are fine. Rows with problems and duplicates are left out and returned as a CSV the user can fix and upload again. */
export function commit(text: string, o: Opts) {
  const p = readFile(text, o); if (typeof p === 'string') return { error: p } as const;
  const rows = check(p, o);
  if (rows.length === 1 && rows[0].line === 1 && rows[0].status === 'error') return { error: rows[0].problems[0] } as const;
  const fresh = rows.filter(r => r.status === 'new'); const touched: number[] = [];
  db.transaction(() => {
    if (p.kind === 'students') {
      const ins = db.prepare(`INSERT INTO students (reg_no, roll_no, father_cnic, category, name, father_name, gender, dob, phone, father_phone, mother_phone, address, section_id, status, admission_date)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const r of fresh) {
        const d = r.data; if (!d.section_id) d.section_id = ensureSection(d.grade, d.sec);
        touched.push(Number(ins.run(d.reg_no, d.roll_no, d.father_cnic ?? null, d.category, d.name, d.father_name, d.gender, d.dob ?? null, d.phone ?? null, d.phone ?? null, d.mother_phone ?? null, d.address, d.section_id, d.status, d.admission_date ?? new Date().toISOString().slice(0, 10)).lastInsertRowid));
      }
    } else {
      const cols = ['name', 'father_name', 'gender', 'cnic', 'dob', 'phone', 'email', 'address', 'qualification', 'staff_type', 'kind', 'department', 'designation', 'employment', 'joining_date', 'basic_salary', 'status'];
      for (const r of fresh) {
        const d = r.data, emp = d.emp_no || nextEmpNo();
        db.prepare(`INSERT INTO hr_staff (emp_no, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(emp, ...cols.map(c => d[c] ?? (c === 'basic_salary' ? 0 : null)));
      }
    }
  })();
  let linked = 0;
  if (p.kind === 'students') {
    // After saving: brothers and sisters are found from CNIC / phone, then category and sibling discounts are worked out for everyone concerned.
    const all = new Set<number>(touched);
    for (const id of touched) { const r = acceptStrong(id); if (Array.isArray(r)) { if (r.length) linked++; r.forEach(x => all.add(x)); } }
    for (const id of all) applyCategoryRules(id);
  }
  const bad = rows.filter(r => r.status !== 'new');
  const csv = bad.length ? toCsv([[...p.headers, 'Why it was not saved'], ...bad.map(r => [...r.raw, r.problems.join(' | ')])]) : '';
  return { kind: p.kind, saved: fresh.length, duplicates: rows.filter(r => r.status === 'duplicate').length, errors: rows.filter(r => r.status === 'error').length, families_linked: linked, rejected_csv: csv };
}

export const TEMPLATES: Record<Kind, string> = {
  students: toCsv([['Admission No', 'Name', 'Father Name', 'Class', 'Section', 'Roll No', 'Gender', 'Date of Birth', 'Father CNIC', 'Phone', 'Address', 'Category', 'Status', 'Admission Date'],
    ['2015-0001', 'Ali Raza', 'Muhammad Aslam', '6', 'A', '1', 'Male', '15/03/2012', '37405-1234567-1', '0300-1234567', 'House 1, Street 2, Rawalpindi', 'A', 'Active', '01/04/2018']]),
  staff: toCsv([['Employee No', 'Name', 'Father Name', 'Designation', 'Department', 'CNIC', 'Phone', 'Email', 'Gender', 'Date of Birth', 'Qualification', 'Address', 'Joining Date', 'Salary', 'Employment', 'Status'],
    ['E-001', 'Sara Khan', 'Khalid Khan', 'Math Teacher', 'Teaching', '37405-7654321-2', '0312-7654321', 'sara@example.com', 'Female', '10/08/1990', 'MSc Mathematics', 'Rawalpindi', '01/08/2019', '45000', 'Permanent', 'Active']])
};
