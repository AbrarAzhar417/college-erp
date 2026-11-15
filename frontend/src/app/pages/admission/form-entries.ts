/** What the office types, in the order the paper form asks for it. `src` says where it is stored: the student record or the application particulars. */
export type Src = 'st' | 'info';
export interface Entry {
  t: 'f' | 'class' | 'transport' | 'sibs' | 'exam' | 'photo' | 'auto' | 'category';
  label: string; src?: Src; k?: string; kind?: 'date' | 'yesno' | 'group' | 'decision' | 'gender' | 'tel' | 'cnic' | 'area' | 'pick'; n?: number; p?: string; wide?: boolean; opts?: string[];
}
export interface Section { title: string; items: Entry[] }
export type FormType = 'school' | 'registration' | 'college';

const f = (label: string, src: Src, k: string, kind?: Entry['kind'], wide = false): Entry => ({ t: 'f', label, src, k, kind, wide });
const st = (label: string, k: string, kind?: Entry['kind'], wide = false) => f(label, 'st', k, kind, wide);
const info = (label: string, k: string, kind?: Entry['kind'], wide = false) => f(label, 'info', k, kind, wide);
const cat: Entry = { t: 'category', label: 'Category (father\'s job)' };
const cls: Entry = { t: 'class', label: 'Class and section' };
const photo: Entry = { t: 'photo', label: 'Photo' };
const gender = st('Gender (for the record)', 'gender', 'gender');
const regNo: Entry = { t: 'auto', label: 'Registration No', k: 'reg_no' };
const officeCommon = (first: Entry[]): Entry[] => [...first, info('House', 'house'), info('Decision', 'decision', 'decision'), info('Decision date', 'decision_date', 'date'), info('Total fee received (Rs)', 'fee_received'), info('Receipt no', 'receipt_no'), info('Receipt date', 'receipt_date', 'date')];

export const SCHOOL: Section[] = [
  { title: 'Top of the form', items: [regNo, info('Date of issue', 'issue_date', 'date'), cat, cls, info('Session (e.g. 2026-27)', 'apply_session'), gender, photo] },
  { title: '1. Particulars of student', items: [st("1. Student's name (block letters)", 'name', undefined, true), st('2. Date of birth', 'dob', 'date'), info('3. Place of birth', 'place_of_birth'), info('4. Religion', 'religion'), info('5. Nationality', 'nationality')] },
  { title: 'Father', items: [st("6. Father's name", 'father_name', undefined, true), info("7. Father's qualification", 'father_qualification'), info('7. Designation', 'father_designation'), info('7. Division', 'father_division'),
    st('8. CNIC no', 'father_cnic', 'cnic'), st('8. P. No', 'p_number'), info('8. SPS / BPS', 'father_sps_bps')] },
  { title: 'Addresses and telephone', items: [st('9. Residential address', 'address', 'area', true), info('10. Permanent address', 'permanent_address', 'area', true),
    info('11. (a) Telephone (office)', 'office_phone', 'tel'), info('11. (b) Residence', 'res_phone', 'tel'), st('11. (c) Cell (father)', 'father_phone', 'tel'), st("Mother's cell (for the record)", 'mother_phone', 'tel'), st('Student phone (for the record)', 'phone', 'tel')] },
  { title: 'Family and previous school', items: [info("12. Mother's qualification & occupation", 'mother_qual_occ', undefined, true), info("13. Father's monthly income", 'father_income'),
    info('14. (a) School / college last attended', 'prev_school', undefined, true), info('14. (b) Dues paid there upto (month)', 'dues_paid_upto'), info('14. (c) Class last attended', 'prev_class'), info('14. (d) Medium', 'medium'),
    info('15. Distinction / scholarship won', 'distinction', undefined, true), info('16. Interest in co-curricular activities', 'cocurricular', undefined, true)] },
  { title: '17. Transport', items: [{ t: 'transport', label: 'Transport' }] },
  { title: 'For office use only', items: officeCommon([info('Admission test held on', 'test_date', 'date')]) }
];

export const REGISTRATION: Section[] = [
  { title: 'Top of the form', items: [regNo, info('Date of issue', 'issue_date', 'date'), cat, cls, gender, photo] },
  { title: '1. Particulars of student', items: [st("i) Student's name (block letters)", 'name', undefined, true), st('ii) Date of birth (the words are written by themselves)', 'dob', 'date'),
    info('iii) Name of school last attended', 'prev_school', undefined, true), info('iv) Class in which studying / promoted', 'prev_class'), info('iv) Medium', 'medium'),
    info('v) Class in which to be admitted', 'admit_class'), info('vi) Blood group', 'blood_group')] },
  { title: '2. Particulars of parents / guardian', items: [st("i) Father's name", 'father_name', undefined, true), info('ii) Qualifications', 'father_qualification'), info('iii) Designation', 'father_designation'), st('iii) P. No', 'p_number'),
    info('iii) Division', 'father_division'), info('iii) SPS / BPS', 'father_sps_bps'), info('iv) Official address', 'official_address', 'area', true), st('v) Residential address', 'address', 'area', true),
    info('vi) Telephone (office)', 'office_phone', 'tel'), info('vi) Residence', 'res_phone', 'tel'), st('vi) Mobile no (father)', 'father_phone', 'tel'), st("Mother's mobile (for the record)", 'mother_phone', 'tel'),
    info('vii) Permanent home address', 'permanent_address', 'area', true)] },
  { title: '3. Brothers / sisters (if studying in this college)', items: [{ t: 'sibs', label: 'Brothers / sisters', n: 5 }] },
  { title: 'For office use only', items: [info('Called for test on', 'test_date', 'date'), info('Reported for test', 'reported_test', 'yesno'),
    ...['urdu', 'english', 'maths', 'science', 'total'].map(s => info('Result (I): ' + s[0].toUpperCase() + s.slice(1), 'res_' + s)),
    ...['urdu', 'english', 'maths', 'science', 'total'].map(s => info('Retest (ii): ' + s[0].toUpperCase() + s.slice(1), 'ret_' + s)),
    info('Remarks', 'remarks', undefined, true), info('Admission granted / not granted / recommended', 'decision', 'decision'), info('Dated', 'decision_date', 'date')] }
];

export const COLLEGE: Section[] = [
  { title: 'Top of the form', items: [regNo, cat, cls, info('Session (e.g. 2026-27)', 'apply_session'), info('Subject group', 'subject_group', 'group'), gender, photo] },
  { title: '1. Particulars of student', items: [st('i. Name (block letters)', 'name', undefined, true), st('ii. Date of birth', 'dob', 'date'), info('iii. Place of birth', 'place_of_birth'), info('iv. Religion', 'religion'), info('v. Nationality', 'nationality'),
    info('vi. School / college last attended', 'prev_school', undefined, true), info('vii. Class last attended', 'prev_class'), info('vii. Medium of instruction', 'medium'), info("viii. CNIC / 'B' form no", 'student_bform', 'cnic')] },
  { title: '2. Particulars of parents / guardian', items: [st("i. Father's / guardian's name", 'father_name', undefined, true), st('ii. P. No', 'p_number'), info('iii. Occupation / designation', 'father_designation'), info('iv. Division', 'father_division'),
    st('v. CNIC no', 'father_cnic', 'cnic'), info('vi. Qualification', 'father_qualification'), info('vii. Monthly income', 'father_income'), info('vii. BPS / SPS', 'father_sps_bps'),
    info('viii. Phone (office)', 'office_phone', 'tel'), info('viii. Residence', 'res_phone', 'tel'), st('viii. Cell (father)', 'father_phone', 'tel'), st("Mother's cell (for the record)", 'mother_phone', 'tel')] },
  { title: '3 and 4. Addresses', items: [st('3. Present home address', 'address', 'area', true), info('4. Permanent home address', 'permanent_address', 'area', true)] },
  { title: '5. Examinations passed', items: [{ t: 'exam', label: 'SSC', p: 'ssc' }, { t: 'exam', label: 'HSSC-I', p: 'hssc1' }] },
  { title: '7 to 11', items: [info('7. Interest in co-curricular / literary activities', 'cocurricular', undefined, true), info('8. Games / sports / hobbies', 'sports', undefined, true), info('9. Distinction / scholarship won', 'distinction', undefined, true),
    info('10. Serious health / medical problem?', 'health_issue', 'yesno'), info('10. i. Name of the disease', 'disease'), info('10. ii. Doctor / hospital', 'doctor'), info('10. iii. Present status', 'disease_status'), info('11. What do you plan to be in future?', 'future_plan', undefined, true)] },
  { title: '12. Brothers / sisters (if studying in KMC)', items: [{ t: 'sibs', label: 'Brothers / sisters', n: 4 }] },
  { title: '13. Transport', items: [{ t: 'transport', label: 'Transport' }] },
  { title: 'For office use only', items: officeCommon([info('Admission test / interview held on', 'test_date', 'date')]) }
];


/** Ready-made answers for fields that are usually one of a few things. The last choice in the box is always "Other", which lets the office type anything. */
const CLASSES = ['Class I', 'Class II', 'Class III', 'Class IV', 'Class V', 'Class VI', 'Class VII', 'Class VIII', 'Class IX', 'Class X', 'Class XI', 'Class XII'];
const year = new Date().getFullYear();
export const BOARDS = ['BISE Rawalpindi', 'FBISE (Federal Board)', 'BISE Lahore', 'BISE Gujranwala', 'BISE Faisalabad', 'BISE Sargodha', 'BISE Multan', 'BISE Peshawar', 'AJK Board', 'Cambridge (O / A level)'];
export const PICKS: Record<string, string[]> = {
  religion: ['Islam', 'Christianity', 'Hinduism', 'Sikhism'],
  nationality: ['Pakistani'],
  medium: ['English', 'Urdu'],
  prev_class: CLASSES, admit_class: CLASSES.slice(4),
  apply_session: [-1, 0, 1].map(d => `${year + d}-${String((year + d + 1) % 100).padStart(2, '0')}`),
  blood_group: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  place_of_birth: ['Kahuta', 'Rawalpindi', 'Islamabad', 'Lahore', 'Karachi', 'Peshawar'],
  father_qualification: ['Illiterate', 'Primary', 'Middle', 'Matric', 'F.A / F.Sc / Intermediate', 'B.A / B.Sc', 'B.E / B.Tech', 'M.A / M.Sc', 'M.Phil', 'PhD', 'Diploma / Technical'],
  father_sps_bps: Array.from({ length: 22 }, (_, i) => `BPS-${i + 1}`),
  father_income: ['Below 25,000', '25,000 - 50,000', '50,000 - 100,000', '100,000 - 200,000', 'Above 200,000'],
  mother_qual_occ: ['Housewife', 'Teacher', 'Doctor / Nurse', 'Government employee', 'Private job', 'Business'],
  dues_paid_upto: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  distinction: ['None', 'Merit scholarship', 'Position holder', 'Sports award', 'Quran / Naat award', 'Talent award'],
  cocurricular: ['Debates / Speeches', 'Naat / Qirat', 'Drawing / Art', 'Quiz / Declamation', 'Scouts', 'Computer / Coding', 'Writing / Magazine', 'Drama / Theatre'],
  sports: ['Cricket', 'Football', 'Hockey', 'Badminton', 'Table Tennis', 'Athletics', 'Volleyball', 'Swimming', 'Cycling', 'Reading', 'Gardening'],
  disease_status: ['Cured', 'Under treatment', 'Chronic / ongoing', 'Recovering'],
  future_plan: ['Doctor', 'Engineer', 'Army / Armed forces', 'Pilot', 'Teacher', 'Scientist', 'Civil servant (CSS)', 'Businessman', 'IT / Software', 'Lawyer', 'Banker / Accountant'],
};
const withPicks = (secs: Section[]): Section[] => secs.map(sc => ({ ...sc, items: sc.items.map(e => e.t === 'f' && e.k && PICKS[e.k] && !e.kind ? { ...e, kind: 'pick' as const, opts: PICKS[e.k] } : e) }));

export const ENTRIES: Record<FormType, Section[]> = { school: withPicks(SCHOOL), registration: withPicks(REGISTRATION), college: withPicks(COLLEGE) };
