import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { ToastService } from '../core/toast';
import { ATT_LABEL, Balance, EMPLOYMENT, EMP_LABEL, HrFiles, HrLookup, LeaveRow, STAFF_TYPES, Staff, TYPE_LABEL, fmtDate, initials, leaveBadge, money, shrinkPhoto, today } from './hr';

interface FileRow { id: number; label: string | null; name: string; size: number; expires: string | null }
interface Detail { staff: Staff; files: FileRow[]; balances: Balance[]; leaves: LeaveRow[]; month: Record<string, number | string>; login: { username: string; role: string; active: number } | null }
const DEFAULT_DEPT: Record<string, string> = { teacher: 'Teaching', office: 'Administration', accounts: 'Accounts', driver: 'Transport', conductor: 'Transport', support: 'Support', lab_attendant: 'Support' };
const blank = (): Partial<Staff> => ({ name: '', father_name: '', gender: null, cnic: '', dob: '', phone: '', email: '', address: '', emergency_name: '', emergency_phone: '', qualification: '', staff_type: 'teacher', department: 'Teaching',
  designation: 'Teacher', employment: 'permanent', joining_date: today(), contract_end: '', license_no: '', license_expiry: '', photo: null, bank_name: '', account_no: '', basic_salary: 0, house_allow: 0, medical_allow: 0, conveyance_allow: 0, other_allow: 0, fixed_deduction: 0 });

@Component({
  selector: 'app-hr-profile',
  imports: [FormsModule, RouterLink],
  template: `
  <div class="space-y-6">
    <a routerLink="/hr/staff" class="text-xs font-black uppercase tracking-widest text-indigo-600">← All staff</a>
    @if (error()) { <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 font-bold text-sm">{{ error() }}</p> }

    @if (d(); as x) {
      <div class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise flex flex-wrap items-center gap-5">
        @if (x.staff.photo) { <img [src]="x.staff.photo" alt="" class="w-20 h-20 rounded-full object-cover"> } @else { <span class="w-20 h-20 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xl font-black">{{ ini(x.staff.name) }}</span> }
        <div class="flex-1 min-w-48"><h3 class="text-2xl font-black tracking-tight">{{ x.staff.name }}</h3>
          <p class="text-sm font-bold text-slate-400">{{ x.staff.emp_no }} · {{ tl[x.staff.staff_type] }} · {{ x.staff.designation || '-' }} · {{ el[x.staff.employment] }}</p>
          @if (x.staff.status !== 'active') { <p class="text-sm font-black text-rose-500 capitalize mt-1">{{ x.staff.status }} on {{ fd(x.staff.left_date) }} {{ x.staff.left_reason ? '· ' + x.staff.left_reason : '' }}</p> }</div>
        <div class="flex flex-wrap gap-2">
          @if (x.staff.status === 'active') { <button type="button" class="btn-ghost" (click)="showExit.set(!showExit())">Left or resigned</button> } @else { <button type="button" class="btn-ghost" (click)="rejoin()">Back to work</button> }
        </div>
      </div>

      @if (showExit()) {
        <form (ngSubmit)="exit()" class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div><label class="label" for="xs">What happened</label><select id="xs" name="xs" class="field" [(ngModel)]="exitF.status"><option value="left">Left (removed)</option><option value="resigned">Resigned</option></select></div>
          <div><label class="label" for="xd">Last day</label><input id="xd" name="xd" type="date" class="field" [(ngModel)]="exitF.date"></div>
          <div class="col-span-2"><label class="label" for="xr">Reason</label><input id="xr" name="xr" class="field" [(ngModel)]="exitF.reason"></div>
          <p class="col-span-2 md:col-span-3 text-xs font-bold text-slate-400">The record stays. Their login stops working and they come off the timetable and the bus.</p><button class="btn-primary" type="submit">Confirm</button>
        </form>
      }
    }

    <form (ngSubmit)="save()" class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-6">
      <h3 class="text-xl font-black tracking-tight">{{ isNew ? 'New staff member' : 'Details' }}</h3>
      <div class="flex items-center gap-4">
        @if (f.photo) { <img [src]="f.photo" alt="" class="w-16 h-16 rounded-full object-cover"> } @else { <span class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800"></span> }
        <label class="btn-ghost cursor-pointer">Choose photo<input type="file" accept="image/*" class="hidden" (change)="pickPhoto($event)"></label>
        @if (f.photo) { <button type="button" class="btn-ghost" (click)="f.photo = null">Remove photo</button> }
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="col-span-2"><label class="label" for="pn">Name</label><input id="pn" name="pn" class="field" required [(ngModel)]="f.name"></div>
        <div class="col-span-2"><label class="label" for="pf">Father's name</label><input id="pf" name="pf" class="field" [(ngModel)]="f.father_name"></div>
        <div><label class="label" for="pg">Gender</label><select id="pg" name="pg" class="field" [(ngModel)]="f.gender"><option [ngValue]="null">-</option><option value="male">Male</option><option value="female">Female</option></select></div>
        <div><label class="label" for="pc">CNIC</label><input id="pc" name="pc" class="field" [(ngModel)]="f.cnic"></div>
        <div><label class="label" for="pd">Date of birth</label><input id="pd" name="pd" type="date" class="field" [(ngModel)]="f.dob"></div>
        <div><label class="label" for="pp">Phone</label><input id="pp" name="pp" class="field" [(ngModel)]="f.phone"></div>
        <div><label class="label" for="pe">Email</label><input id="pe" name="pe" type="email" class="field" [(ngModel)]="f.email"></div>
        <div class="col-span-2"><label class="label" for="pa">Address</label><input id="pa" name="pa" class="field" [(ngModel)]="f.address"></div>
        <div><label class="label" for="pq">Qualification</label><input id="pq" name="pq" class="field" [(ngModel)]="f.qualification"></div>
        <div><label class="label" for="pen">Emergency contact</label><input id="pen" name="pen" class="field" [(ngModel)]="f.emergency_name"></div>
        <div><label class="label" for="pep">Emergency phone</label><input id="pep" name="pep" class="field" [(ngModel)]="f.emergency_phone"></div>
      </div>

      <h4 class="text-sm font-black uppercase tracking-widest text-slate-400">Job</h4>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div><label class="label" for="jt">Staff type</label><select id="jt" name="jt" class="field" [ngModel]="f.staff_type" (ngModelChange)="typeChanged($event)">@for (t of types; track t.key) { <option [value]="t.key">{{ t.label }}</option> }</select></div>
        <div><label class="label" for="jd">Department</label><input id="jd" name="jd" class="field" list="hr-depts" [(ngModel)]="f.department"></div>
        <div><label class="label" for="jg">Designation</label><input id="jg" name="jg" class="field" list="hr-desig" [(ngModel)]="f.designation"></div>
        <div><label class="label" for="je">Employment</label><select id="je" name="je" class="field" [(ngModel)]="f.employment">@for (e of emps; track e.key) { <option [value]="e.key">{{ e.label }}</option> }</select></div>
        <div><label class="label" for="jj">Joining date</label><input id="jj" name="jj" type="date" class="field" [(ngModel)]="f.joining_date"></div>
        <div><label class="label" for="jc">Contract / probation ends</label><input id="jc" name="jc" type="date" class="field" [(ngModel)]="f.contract_end"></div>
        @if (f.staff_type === 'driver') {
          <div><label class="label" for="jl">Licence no.</label><input id="jl" name="jl" class="field" [(ngModel)]="f.license_no"></div>
          <div><label class="label" for="jx">Licence expires</label><input id="jx" name="jx" type="date" class="field" [(ngModel)]="f.license_expiry"></div>
        }
      </div>
      <datalist id="hr-depts">@for (n of look()?.departments ?? []; track n) { <option [value]="n"></option> }</datalist>
      <datalist id="hr-desig">@for (n of look()?.designations ?? []; track n) { <option [value]="n"></option> }</datalist>

      @if (pay) {
        <h4 class="text-sm font-black uppercase tracking-widest text-slate-400">Salary (Rs per month)</h4>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div><label class="label" for="s1">Basic</label><input id="s1" name="s1" type="number" min="0" class="field" [(ngModel)]="f.basic_salary"></div>
          <div><label class="label" for="s2">House</label><input id="s2" name="s2" type="number" min="0" class="field" [(ngModel)]="f.house_allow"></div>
          <div><label class="label" for="s3">Medical</label><input id="s3" name="s3" type="number" min="0" class="field" [(ngModel)]="f.medical_allow"></div>
          <div><label class="label" for="s4">Conveyance</label><input id="s4" name="s4" type="number" min="0" class="field" [(ngModel)]="f.conveyance_allow"></div>
          <div><label class="label" for="s5">Other</label><input id="s5" name="s5" type="number" min="0" class="field" [(ngModel)]="f.other_allow"></div>
          <div><label class="label" for="s6">Fixed deduction</label><input id="s6" name="s6" type="number" min="0" class="field" [(ngModel)]="f.fixed_deduction"></div>
          <div class="col-span-2 md:col-span-3"><label class="label" for="s7">Bank name</label><input id="s7" name="s7" class="field" [(ngModel)]="f.bank_name"></div>
          <div class="col-span-2 md:col-span-3"><label class="label" for="s8">Account no. / IBAN</label><input id="s8" name="s8" class="field" [(ngModel)]="f.account_no"></div>
        </div>
      }
      <div class="flex gap-3"><button class="btn-primary" type="submit" [disabled]="busy()">{{ isNew ? 'Add staff member' : 'Save changes' }}</button></div>
    </form>

    @if (d(); as x) {
      <div class="grid lg:grid-cols-2 gap-6">
        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
          <h3 class="text-lg font-black tracking-tight">Documents</h3>
          @for (fl of x.files; track fl.id) {
            <div class="flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800 text-sm">
              <button type="button" class="text-left font-bold hover:text-indigo-500" (click)="files.open(fl.id)">{{ fl.label || fl.name }}<span class="block text-[11px] text-slate-400">{{ fl.name }}{{ fl.expires ? ' · expires ' + fd(fl.expires) : '' }}</span></button>
              <button type="button" class="px-3 py-1.5 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-500/10" (click)="removeFile(fl)">Delete</button></div>
          } @empty { <p class="text-sm font-bold text-slate-400">No documents yet (CNIC copy, degree, contract...).</p> }
          <div class="grid grid-cols-2 gap-3 items-end">
            <div><label class="label" for="dl">Name of document</label><input id="dl" class="field" placeholder="CNIC copy" [(ngModel)]="docLabel" name="dl"></div>
            <div><label class="label" for="dx">Expires (optional)</label><input id="dx" type="date" class="field" [(ngModel)]="docExpires" name="dx"></div>
            <label class="btn-ghost cursor-pointer text-center col-span-2">Upload file (PDF, Word, JPG, PNG)<input type="file" class="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" (change)="upload($event)"></label>
          </div>
        </section>

        <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
          <h3 class="text-lg font-black tracking-tight">Leave balance ({{ year }})</h3>
          @for (b of x.balances; track b.type_id) {
            <div class="flex items-center justify-between text-sm font-bold py-1.5 border-b border-slate-100 dark:border-slate-800"><span>{{ b.name }}{{ b.paid ? '' : ' (unpaid)' }}</span>
              <span>{{ b.quota ? b.used + ' of ' + b.quota + ' used · ' + b.left + ' left' : b.used + ' days taken' }}{{ b.pending ? ' · ' + b.pending + ' waiting' : '' }}</span></div>
          }
          <h3 class="text-lg font-black tracking-tight pt-2">This month</h3>
          <div class="flex flex-wrap gap-2">@for (k of attKeys; track k) { <span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800">{{ al[k] }}: {{ x.month[k] }}</span> }<span class="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800">School days: {{ x.month['working_days'] }}</span></div>
          @if (x.leaves.length) { <h3 class="text-lg font-black tracking-tight pt-2">Recent leaves</h3>
            @for (l of x.leaves; track l.id) { <p class="text-sm font-bold flex justify-between gap-2"><span>{{ l.type }} · {{ fd(l.from_date) }}{{ l.to_date !== l.from_date ? ' to ' + fd(l.to_date) : '' }} ({{ l.days }})</span><span class="px-2 py-0.5 rounded-lg text-[11px] font-black capitalize" [class]="lb(l.status)">{{ l.status }}</span></p> } }
        </section>
      </div>

      <section class="bg-white dark:bg-slate-900/40 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise space-y-4">
        <h3 class="text-lg font-black tracking-tight">Login account</h3>
        @if (x.login) { <p class="text-sm font-bold">Username <b>{{ x.login.username }}</b> · {{ x.login.role }} {{ x.login.active ? '' : '(stopped)' }}. This person sees their own profile, attendance, leaves and payslips under HR.</p> }
        @else if (leader) {
          <form (ngSubmit)="makeLogin()" class="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
            <div><label class="label" for="lu">Username</label><input id="lu" name="lu" class="field" required [(ngModel)]="loginF.username"></div>
            <div><label class="label" for="lr">Role</label><select id="lr" name="lr" class="field" [(ngModel)]="loginF.role"><option value="teacher">Teacher</option><option value="admin">Front desk admin</option><option value="accountant">Accountant</option></select></div>
            <div><label class="label" for="lp">Password (empty = ChangeMe&#64;123)</label><input id="lp" name="lp" class="field" [(ngModel)]="loginF.password"></div>
            <button class="btn-primary" type="submit">Create login</button>
          </form>
        } @else { <p class="text-sm font-bold text-slate-400">No login yet. The principal or director can create one.</p> }
      </section>
    }
  </div>
  `
})
export class HrProfile {
  private api = inject(Api);
  private toast = inject(ToastService);
  private router = inject(Router);
  files = inject(HrFiles);
  pay = inject(AuthService).canHrPay(); leader = inject(AuthService).isLeadership();
  id = this.route().snapshot.paramMap.get('id') ?? 'new';
  isNew = this.id === 'new';
  types = STAFF_TYPES; emps = EMPLOYMENT; tl = TYPE_LABEL; el = EMP_LABEL; al = ATT_LABEL; attKeys = ['P', 'LT', 'A', 'L', 'HD']; year = today().slice(0, 4);
  ini = initials; fd = fmtDate; m = money; lb = leaveBadge;
  d = signal<Detail | null>(null); look = signal<HrLookup | null>(null); error = signal(''); busy = signal(false); showExit = signal(false);
  f: Partial<Staff> = blank(); exitF = { status: 'left', date: today(), reason: '' }; loginF = { username: '', role: 'teacher', password: '' };
  docLabel = ''; docExpires = '';
  private route() { return inject(ActivatedRoute); }
  constructor() {
    this.api.get<HrLookup>('/hr/lookup').subscribe({ next: l => this.look.set(l) });
    if (!this.isNew) this.load();
  }
  load() {
    this.api.get<Detail>(`/hr/staff/${this.id}`).subscribe({ next: x => { this.d.set(x); this.f = { ...x.staff }; }, error: e => this.error.set(errorText(e)) });
  }
  typeChanged(t: Staff['staff_type']) {
    this.f.staff_type = t;
    if (this.isNew) { this.f.department = DEFAULT_DEPT[t]; this.f.designation = t === 'teacher' ? 'Teacher' : t === 'driver' ? 'Driver' : t === 'conductor' ? 'Conductor' : t === 'accounts' ? 'Accountant' : t === 'lab_attendant' ? 'Lab Attendant' : t === 'support' ? 'Naib Qasid' : 'Clerk'; }
  }
  async pickPhoto(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
    try { this.f.photo = await shrinkPhoto(file); } catch (e) { this.error.set((e as Error).message); }
  }
  save() {
    this.error.set(''); this.busy.set(true);
    const req = this.isNew ? this.api.post<{ id: number }>('/hr/staff', this.f) : this.api.put<unknown>(`/hr/staff/${this.id}`, this.f);
    req.subscribe({
      next: (r: any) => { this.busy.set(false); this.toast.show('Saved.'); if (this.isNew) this.router.navigate(['/hr/staff', r.id]); else this.load(); },
      error: e => { this.busy.set(false); this.error.set(errorText(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  }
  exit() { this.api.post(`/hr/staff/${this.id}/exit`, this.exitF).subscribe({ next: () => { this.showExit.set(false); this.toast.show('Saved.'); this.load(); }, error: e => this.error.set(errorText(e)) }); }
  rejoin() { if (!confirm('Bring this person back to work?')) return; this.api.post(`/hr/staff/${this.id}/rejoin`, {}).subscribe({ next: () => { this.toast.show('Back at work.'); this.load(); }, error: e => this.error.set(errorText(e)) }); }
  async upload(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
    try { await this.files.upload('staff', Number(this.id), file, this.docLabel, this.docExpires); this.docLabel = ''; this.docExpires = ''; this.toast.show('Uploaded.'); this.load(); } catch (e) { this.error.set(errorText(e)); }
    input.value = '';
  }
  removeFile(fl: FileRow) { if (!confirm(`Delete ${fl.label || fl.name}?`)) return; this.api.delete(`/hr/files/${fl.id}`).subscribe({ next: () => this.load(), error: e => this.error.set(errorText(e)) }); }
  makeLogin() {
    this.api.post<{ username: string; password: string }>(`/hr/staff/${this.id}/login`, this.loginF).subscribe({
      next: r => { this.toast.show(`Login created: ${r.username} / ${r.password}`); this.load(); }, error: e => this.error.set(errorText(e))
    });
  }
}
