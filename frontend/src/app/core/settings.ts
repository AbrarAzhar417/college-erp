import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';

export interface DemoAccount { name: string; username: string; role: string }
export interface Bearer { id: number; post: string; title: string; name: string }
interface PublicSettings {
  instituteName: string; shortName: string; address: string; phone: string; email: string;
  publicUrl?: string; lanUrls?: string[]; website: string; motto: string; affiliation: string; established: string; bearers: Bearer[];
  hasLogo: boolean; logoVersion: string; demoMode: boolean; demoAccounts: DemoAccount[];
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private api = inject(Api);
  readonly instituteName = signal('College Portal');
  readonly shortName = signal('');
  readonly address = signal('');
  readonly phone = signal('');
  readonly email = signal('');
  readonly website = signal('');
  readonly publicUrl = signal('');
  readonly lanUrls = signal<string[]>([]);
  readonly motto = signal('');
  readonly affiliation = signal('');
  readonly established = signal('');
  readonly bearers = signal<Bearer[]>([]);
  /** The name of whoever holds a post (principal, vice_principal, accounts_officer...), or '' so the printed line stays blank to sign. */
  who(post: string): string { return this.bearers().find(b => b.post === post)?.name ?? ''; }
  /** "Principal" or "Principal: Col. Ahmed", for the signature lines of the printed sheets. */
  sign(label: string, post: string): string { const n = this.who(post); return n ? `${label}: ${n}` : label; }
  readonly hasLogo = signal(false);
  readonly logoVersion = signal('');
  readonly demoMode = signal(false);
  readonly demoAccounts = signal<DemoAccount[]>([]);
  readonly initial = computed(() => (this.instituteName().trim()[0] || 'C').toUpperCase());
  readonly logoUrl = computed(() => (this.hasLogo() ? `/api/settings/logo?v=${this.logoVersion()}` : ''));

  async load() {
    try {
      const s = await firstValueFrom(this.api.get<PublicSettings>('/settings'));
      this.apply(s);
      document.title = s.instituteName;
    } catch { /* server not reachable yet: keep defaults */ }
  }
  apply(s: Partial<PublicSettings>) {
    if (s.instituteName !== undefined) this.instituteName.set(s.instituteName);
    if (s.shortName !== undefined) this.shortName.set(s.shortName);
    if (s.address !== undefined) this.address.set(s.address);
    if (s.phone !== undefined) this.phone.set(s.phone);
    if (s.email !== undefined) this.email.set(s.email);
    if (s.website !== undefined) this.website.set(s.website);
    if (s.publicUrl !== undefined) this.publicUrl.set(s.publicUrl);
    if (s.lanUrls !== undefined) this.lanUrls.set(s.lanUrls);
    if (s.motto !== undefined) this.motto.set(s.motto);
    if (s.affiliation !== undefined) this.affiliation.set(s.affiliation);
    if (s.established !== undefined) this.established.set(s.established);
    if (s.bearers !== undefined) this.bearers.set(s.bearers);
    if (s.hasLogo !== undefined) this.hasLogo.set(s.hasLogo);
    if (s.logoVersion !== undefined) this.logoVersion.set(s.logoVersion);
    if (s.demoMode !== undefined) this.demoMode.set(s.demoMode);
    if (s.demoAccounts !== undefined) this.demoAccounts.set(s.demoAccounts);
  }
}
