import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, of, throwError } from 'rxjs';
import { AuthService } from './auth';

/**
 * Weak internet in class: attendance and marks that cannot be sent are kept on the phone and sent automatically
 * when the connection returns. Only these saves (they overwrite the same row, so sending twice is harmless) are kept:
 *   POST /api/attendance/daily, /api/attendance/period, /api/exam/papers/:id/marks
 */
const QUEUE_KEY = 'erp_offline_queue';
const REPLAY = 'X-Offline-Replay';
const ALLOWED = [/^\/api\/attendance\/(daily|period)$/, /^\/api\/exam\/papers\/\d+\/marks$/];
interface Entry { id: number; user: number; url: string; body: unknown; at: string }

@Injectable({ providedIn: 'root' })
export class OfflineQueue {
  private http = inject(HttpClient); private auth = inject(AuthService);
  readonly count = signal(0); readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine); readonly sending = signal(false);

  constructor() {
    this.count.set(this.read().length);
    addEventListener('online', () => { this.online.set(true); this.flush(); });
    addEventListener('offline', () => this.online.set(false));
    setTimeout(() => this.flush(), 4000);
    setInterval(() => { if (this.count()) this.flush(); }, 60000);
  }

  private read(): Entry[] { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
  private write(l: Entry[]) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(l)); } catch { /* storage full or blocked */ } this.count.set(l.length); }

  canQueue(method: string, url: string, body: unknown) {
    const path = url.split('?')[0];
    return method === 'POST' && body !== null && typeof body === 'object' && !(body instanceof Blob) && ALLOWED.some(r => r.test(path));
  }
  add(url: string, body: unknown) {
    const uid = this.auth.user()?.id; if (!uid) return false;
    const l = this.read(); l.push({ id: Date.now() + l.length, user: uid, url, body, at: new Date().toISOString() });
    this.write(l); return true;
  }

  /** Sends the waiting entries one by one, oldest first. Stops on a network problem or when the login has expired. */
  async flush() {
    if (this.sending() || !navigator.onLine || !this.auth.isLoggedIn()) return;
    const uid = this.auth.user()?.id;
    this.sending.set(true);
    try {
      for (const e of this.read()) {
        if (e.user !== uid) continue;   // never send another person's entries under this login
        try {
          await new Promise<void>((ok, fail) => this.http.post(e.url, e.body, { headers: { [REPLAY]: '1' } }).subscribe({ next: () => ok(), error: fail }));
          this.write(this.read().filter(x => x.id !== e.id));
        } catch (err) {
          const st = (err as HttpErrorResponse)?.status;
          if (st === 0 || st === 401 || st >= 500) break;           // try again later
          this.write(this.read().filter(x => x.id !== e.id));        // the server refused this entry (for example the exam was locked): drop it
        }
      }
    } finally { this.sending.set(false); }
  }
}

export const offlineInterceptor: HttpInterceptorFn = (req, next) => {
  const q = inject(OfflineQueue);
  if (req.headers.has(REPLAY)) return next(req.clone({ headers: req.headers.delete(REPLAY) }));
  return next(req).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 0 && q.canQueue(req.method, req.url, req.body) && q.add(req.url, req.body)) {
        return of(new HttpResponse({ status: 202, body: { queued: true, ok: true } }));
      }
      return throwError(() => e);
    })
  );
};
