import { getSetting, setSetting } from './db.js';

/**
 * Open teaching: when on (the default) any teacher can take attendance, enter marks, make a paper and print sheets for ANY class and subject,
 * not only their own. The class teacher keeps the responsibilities that belong to the class (class sheet, whole-class result, PTM, student results).
 * The office switches it off on the College Profile page to go back to "own classes only".
 */
export const teacherOpen = () => getSetting('teacher_open') !== '0';
export const setTeacherOpen = (on: boolean) => setSetting('teacher_open', on ? '1' : '0');
