import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private base = '/api';

  get<T>(path: string, params?: Record<string, string | number | undefined>) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') p = p.set(k, String(v));
    return this.http.get<T>(this.base + path, { params: p });
  }
  post<T>(path: string, body: unknown) { return this.http.post<T>(this.base + path, body); }
  put<T>(path: string, body: unknown) { return this.http.put<T>(this.base + path, body); }
  delete<T>(path: string) { return this.http.delete<T>(this.base + path); }
}

/** Turns a failed request into a message a person can read. */
export function errorText(e: any): string {
  if (e?.status === 0) return 'Cannot reach the server. Check that the college server PC is on and you are on the same WiFi.';
  return e?.error?.message || 'Something went wrong. Please try again.';
}
