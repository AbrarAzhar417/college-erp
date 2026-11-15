import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { tap, catchError, throwError } from 'rxjs';
import { Api } from './api';
import { User } from './models';

const TOKEN_KEY = 'erp_token';
const USER_KEY = 'erp_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(Api);
  private router = inject(Router);

  readonly user = signal<User | null>(this.readUser());
  readonly isLoggedIn = computed(() => !!this.user());
  /** Who may add or edit students. */
  readonly canWriteStudents = computed(() => ['director', 'principal', 'admin'].includes(this.user()?.role ?? ''));
  readonly canFee = computed(() => ['director', 'principal', 'accountant', 'admin'].includes(this.user()?.role ?? ''));
  readonly canAttendance = computed(() => ['director', 'principal', 'admin', 'teacher'].includes(this.user()?.role ?? ''));
  /** HR: office roles run staff, attendance, leaves and recruitment; salary roles run payroll. */
  readonly canHrOffice = computed(() => ['director', 'principal', 'admin'].includes(this.user()?.role ?? ''));
  readonly canHrPay = computed(() => ['director', 'principal', 'admin', 'accountant'].includes(this.user()?.role ?? ''));
  /** Additional charges given to a teacher by the office. */
  hasDuty(...d: string[]) { const mine = this.user()?.duties ?? []; return d.some(x => mine.includes(x)); }
  readonly isTeacher = computed(() => this.user()?.role === 'teacher');
  readonly canSystem = computed(() => ['director', 'principal', 'admin'].includes(this.user()?.role ?? ''));
  readonly canTimetable = computed(() => this.canWriteStudents() || !!this.user()?.duties?.includes('timetable_team'));
  readonly canExamOffice = computed(() => this.canWriteStudents() || !!this.user()?.duties?.includes('exam_dept'));
  readonly canTestDept = computed(() => this.canWriteStudents() || !!this.user()?.duties?.some(d => d === 'test_dept' || d === 'exam_dept'));
  readonly isLeadership = computed(() => ['director', 'principal', 'admin'].includes(this.user()?.role ?? ''));

  get token() { return localStorage.getItem(TOKEN_KEY); }

  private keep(r: { token: string; user: User }) {
    localStorage.setItem(TOKEN_KEY, r.token);
    localStorage.setItem(USER_KEY, JSON.stringify(r.user));
    this.user.set(r.user);
  }
  /** Returns either a finished login, or `otpRequired` with a ticket for the second step. */
  login(username: string, password: string) {
    return this.api.post<{ token?: string; user?: User; otpRequired?: boolean; ticket?: string }>('/auth/login', { username, password }).pipe(
      tap(r => { if (r.token && r.user) this.keep({ token: r.token, user: r.user }); })
    );
  }
  loginOtp(ticket: string, code: string) {
    return this.api.post<{ token: string; user: User }>('/auth/otp', { ticket, code }).pipe(tap(r => this.keep(r)));
  }

  /** Charges can change after login, so the menu asks the server again each time the app opens. */
  refresh() {
    if (!this.token) return;
    this.api.get<{ user: User }>('/auth/me').subscribe({ next: r => { localStorage.setItem(USER_KEY, JSON.stringify(r.user)); this.user.set(r.user); }, error: () => undefined });
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    // the phone may be shared: forget the lists that were kept for offline use
    try { caches.keys().then(ks => ks.filter(k => k.startsWith('ngsw:') && k.includes('data')).forEach(k => caches.delete(k))); } catch { /* no cache API */ }
    this.user.set(null);
    this.router.navigateByUrl('/login');
  }

  private readUser(): User | null {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const t = auth.token;
  const authed = t ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req;
  return next(authed).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !req.url.endsWith('/auth/login') && !req.url.endsWith('/auth/otp') && auth.isLoggedIn()) auth.logout();
      if (e.status === 403 && e.error?.otpSetupRequired) inject(Router).navigateByUrl('/security');
      return throwError(() => e);
    })
  );
};

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  // Someone who scans a card before signing in is brought back to that student after login.
  return auth.isLoggedIn() && !!auth.token ? true : inject(Router).createUrlTree(['/login'], state.url && state.url !== '/' ? { queryParams: { next: state.url } } : {});
};

export const feeGuard: CanActivateFn = () => (inject(AuthService).canFee() ? true : inject(Router).createUrlTree(['/']));

export const attGuard: CanActivateFn = () => (inject(AuthService).canAttendance() ? true : inject(Router).createUrlTree(['/']));

/** Pages meant for the office only: teachers are sent to the daily register. */
export const managerGuard: CanActivateFn = () => (inject(AuthService).canWriteStudents() ? true : inject(Router).createUrlTree(['/attendance/daily']));

export const systemGuard: CanActivateFn = () => (inject(AuthService).canSystem() ? true : inject(Router).createUrlTree(['/']));
export const examGuard: CanActivateFn = () => (inject(AuthService).canAttendance() ? true : inject(Router).createUrlTree(['/']));
/** Exam pages for the office; teachers go to their own papers. */
export const examOfficeGuard: CanActivateFn = () => (inject(AuthService).canExamOffice() ? true : inject(Router).createUrlTree(['/exams/papers']));

/** Syllabus pages for the office; teachers go to My syllabus. */
export const sylOfficeGuard: CanActivateFn = () => (inject(AuthService).canWriteStudents() ? true : inject(Router).createUrlTree(['/syllabus/mine']));

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() && !!auth.token ? inject(Router).createUrlTree(['/']) : true;
};

/** HR pages for the office; an accountant goes to payroll, everybody else to "My HR". */
export const hrOfficeGuard: CanActivateFn = () => {
  const auth = inject(AuthService), router = inject(Router);
  return auth.canHrOffice() ? true : router.createUrlTree([auth.canHrPay() ? '/hr/payroll' : '/hr/mine']);
};
export const hrPayGuard: CanActivateFn = () => (inject(AuthService).canHrPay() ? true : inject(Router).createUrlTree(['/hr/mine']));

/** A teacher goes to their own home page instead of the school dashboard. */
export const homeGuard: CanActivateFn = () => {
  const auth = inject(AuthService), router = inject(Router);
  if (auth.isTeacher()) return router.createUrlTree(['/me']);
  return auth.user()?.role === 'accountant' ? router.createUrlTree(['/fee']) : true;
};
export const testDeptGuard: CanActivateFn = () => (inject(AuthService).canTestDept() ? true : inject(Router).createUrlTree(['/']));
export const examDeptGuard: CanActivateFn = () => (inject(AuthService).canExamOffice() ? true : inject(Router).createUrlTree(['/']));
