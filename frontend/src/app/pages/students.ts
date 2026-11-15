import { StudentAvatar } from './student-avatar';
import { TransportPicker, TrRoute } from './transport-picker';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Plus, Search, Pencil, Trash2, X } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { HttpClient } from '@angular/common/http';
import { shrinkImage } from '../core/files';
import { ToastService } from '../core/toast';
import { initials } from '../hr/hr';
import { PhotoCropper } from './photo-cropper';
import { fmtCnic, fmtPhone } from './admission/form-data';
import { CatPreview } from '../fee/fee-categories';
import { money } from '../fee/fee';
import { ClassInfo, Student, StudentPage } from '../core/models';

export interface Sibling { id: number; name: string; father_name: string; reg_no: string; roll_no: number | null; photo: string | null; gender: string; section_name: string; class_name: string; grade: number }
interface Form {
  name: string; father_name: string; gender: 'male' | 'female'; dob: string; phone: string; address: string;
  class_id: number | null; section_id: number | null; roll_no: number | null; father_cnic: string;
  category: string; p_number: string; father_phone: string; mother_phone: string; photo?: string | null;
  tr_route_id: number | null; tr_stop_id: number | null; tr_mode: string;
}
const emptyForm = (): Form => ({ name: '', father_name: '', gender: 'male', dob: '', phone: '', address: '', class_id: null, section_id: null, roll_no: null, father_cnic: '', category: '', p_number: '', father_phone: '', mother_phone: '', photo: undefined, tr_route_id: null, tr_stop_id: null, tr_mode: 'both' });

@Component({
  selector: 'app-students',
  imports: [FormsModule, RouterLink, LucideAngularModule, StudentAvatar, TransportPicker, PhotoCropper],
  template: `
  <div class="space-y-8 pb-16 max-w-7xl mx-auto">
    @if (realNew() > 0) {
      <a routerLink="/import" class="block rounded-2xl border border-amber-400/40 bg-amber-500/10 px-5 py-4 text-sm font-black text-amber-700 dark:text-amber-300">The real KMCB list (classes XI and XII) has {{ realNew() }} students that are not in this database yet. Open Import data and press Add.</a>
    }
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-5">
      <div>
        <h2 class="text-3xl font-black tracking-tighter">Students & admissions</h2>
        <p class="text-sm font-bold text-slate-400 mt-2">{{ data()?.total ?? 0 }} students found</p>
      </div>
      @if (auth.canWriteStudents()) {
        <div class="flex flex-wrap gap-3 self-start">
          <a routerLink="/import" class="btn-ghost">Import CSV</a>
          @if (auth.canFee()) { <a routerLink="/students/categories" class="btn-ghost">Categories &amp; reports</a> }
          <a routerLink="/students/form/blank" [queryParams]="{ type: 'registration' }" class="btn-ghost">Blank: Registration (all students)</a>
          <a routerLink="/students/form/blank" class="btn-ghost">Blank: Application (VI-IX)</a>
          <a routerLink="/students/form/blank" [queryParams]="{ type: 'college' }" class="btn-ghost">Blank: College (HSSC)</a>
          <button type="button" class="btn-primary" (click)="openNew()">
            <lucide-icon [img]="plusIcon" [size]="16" [strokeWidth]="3" /> New admission
          </button>
        </div>
      }
    </div>

    <div class="bg-white dark:bg-slate-900/40 p-5 md:p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="relative md:col-span-2">
        <lucide-icon [img]="searchIcon" [size]="18" class="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input class="field !pl-12" type="search" placeholder="Search by name, father's name, reg no or phone" aria-label="Search students"
               [ngModel]="q()" (ngModelChange)="onSearch($event)">
      </div>
      <select class="field" aria-label="Filter by class" [ngModel]="classId()" (ngModelChange)="setClass($event)">
        <option [ngValue]="null">All classes</option>
        @for (c of classes(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
      </select>
      <select class="field" aria-label="Filter by section" [ngModel]="sectionId()" (ngModelChange)="setSection($event)" [disabled]="!classId()">
        <option [ngValue]="null">All sections</option>
        @for (s of filterSections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }
      </select>
    </div>

    @if (error()) {
      <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-sm">{{ error() }}</p>
    }

    <div class="bg-white dark:bg-slate-900/40 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
              <th class="px-6 py-5">Roll</th><th class="px-6 py-5">Admission no</th><th class="px-6 py-5">Cat.</th><th class="px-6 py-5">Bus</th><th class="px-6 py-5">Student</th><th class="px-6 py-5">Father</th>
              <th class="px-6 py-5">Class</th><th class="px-6 py-5">Phone</th>
              @if (auth.canWriteStudents() || auth.canFee()) { <th class="px-6 py-5 text-right">Actions</th> }
            </tr>
          </thead>
          <tbody>
            @for (s of data()?.items ?? []; track s.id) {
              <tr class="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                <td class="px-6 py-4 font-black whitespace-nowrap">{{ s.roll_no ?? '-' }}</td>
                <td class="px-6 py-4 font-bold text-slate-400 whitespace-nowrap">{{ s.reg_no }}</td>
                <td class="px-6 py-4 whitespace-nowrap">@if (s.category) { <span class="px-2.5 py-1 rounded-lg text-[11px] font-black" [class]="s.category === 'A' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : s.category === 'B' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-slate-500/15 text-slate-600 dark:text-slate-300'">{{ s.category }}</span> } @else { <span class="text-slate-300">-</span> }</td>
                <td class="px-6 py-4 whitespace-nowrap text-xs font-black text-slate-500">{{ s.bus_route || '-' }}</td>
                <td class="px-6 py-4 font-black whitespace-nowrap">
                  <a [routerLink]="['/students', s.id]" class="inline-flex items-center gap-3 hover:text-indigo-600">
                    <app-student-avatar [id]="s.id" [name]="s.name" [has]="!!s.has_photo" [gender]="s.gender" />
                    <span class="underline decoration-dotted underline-offset-4">{{ s.name }}</span>
                  </a>
                  <span class="ml-2 text-[10px] font-black px-2 py-1 rounded-lg"
                        [class]="s.gender === 'male' ? 'bg-sky-500/10 text-sky-600' : 'bg-pink-500/10 text-pink-600'">{{ s.gender === 'male' ? 'Boy' : 'Girl' }}</span></td>
                <td class="px-6 py-4 font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">{{ s.father_name }}</td>
                <td class="px-6 py-4 font-black whitespace-nowrap">{{ s.class_name }}-{{ s.section_name }}</td>
                <td class="px-6 py-4 font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">{{ s.phone || '-' }}</td>
                @if (auth.canWriteStudents() || auth.canFee()) {
                  <td class="px-6 py-4 text-right whitespace-nowrap">
                    <a [routerLink]="['/students', s.id]" class="px-3 py-2 rounded-xl text-xs font-black text-slate-600 dark:text-slate-300 hover:bg-slate-500/10">Profile</a>
                    @if (auth.canWriteStudents()) { <a [routerLink]="['/students/form', s.id]" class="px-3 py-2 rounded-xl text-xs font-black text-slate-600 dark:text-slate-300 hover:bg-slate-500/10">Form</a> }
                    @if (auth.canWriteStudents()) { <a [routerLink]="['/attendance/student', s.id]" class="px-3 py-2 rounded-xl text-xs font-black text-emerald-600 hover:bg-emerald-500/10">Attendance</a> }
                    @if (auth.canFee()) { <a [routerLink]="['/fee/student', s.id]" class="px-3 py-2 rounded-xl text-xs font-black text-indigo-600 hover:bg-indigo-500/10">Fee</a> }
                    @if (auth.canWriteStudents()) {
                    <button type="button" class="p-2 rounded-xl text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10" (click)="openEdit(s)" [attr.aria-label]="'Edit ' + s.name"><lucide-icon [img]="editIcon" [size]="16" /></button>
                    <button type="button" class="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10" (click)="remove(s)" [attr.aria-label]="'Remove ' + s.name"><lucide-icon [img]="trashIcon" [size]="16" /></button>
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (data() && data()!.items.length === 0) {
        <p class="p-10 text-center text-sm font-bold text-slate-400">No students match these filters.</p>
      }
      <div class="flex items-center justify-between gap-4 p-5 border-t border-slate-100 dark:border-slate-800">
        <button type="button" class="btn-ghost" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span class="text-xs font-bold text-slate-400">Page {{ page() }} of {{ pages() }}</span>
        <button type="button" class="btn-ghost" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next</button>
      </div>
    </div>
  </div>

  @if (chooser()) {
    <div class="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="wing-title">
      <div class="w-full max-w-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-[2.5rem] p-8 md:p-10 shadow-enterprise-lg space-y-5">
        <div class="flex items-center justify-between"><h3 id="wing-title" class="text-2xl font-black tracking-tight">New admission: which student?</h3>
          <button type="button" class="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" (click)="chooser.set(false)" aria-label="Close"><lucide-icon [img]="closeIcon" [size]="20" /></button></div>
        <p class="text-sm font-bold text-slate-500">The form opens on its own screen. You fill it in the order of the paper form, it is written on the form as you type, and then you print it.</p>
        <div class="grid gap-4">
          <button type="button" class="p-5 rounded-3xl border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-500 text-left" (click)="startNew('school', 'school')"><div class="text-lg font-black">School student · Application form</div><div class="text-xs font-bold text-slate-400 mt-1">Classes VI to X. Application form for admission to classes VI - IX</div></button>
          <button type="button" class="p-5 rounded-3xl border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-500 text-left" (click)="startNew('school', 'registration')"><div class="text-lg font-black">Registration form · any student</div><div class="text-xs font-bold text-slate-400 mt-1">For every student, school or college (classes VI to XII), with the test result table</div></button>
          <button type="button" class="p-5 rounded-3xl border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-500 text-left" (click)="startNew('college', 'college')"><div class="text-lg font-black">College student · HSSC form</div><div class="text-xs font-bold text-slate-400 mt-1">Classes XI and XII. Application form for admission in HSSC</div></button>
        </div>
      </div>
    </div>
  }

  @if (showForm()) {
    <div class="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="form-title">
      <form (ngSubmit)="save()" class="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-[2.5rem] p-8 md:p-10 shadow-enterprise-lg space-y-5">
        <div class="flex items-center justify-between">
          <h3 id="form-title" class="text-2xl font-black tracking-tight">{{ editingId() ? 'Edit student' : 'New admission · ' + (wing() === 'college' ? 'College (HSSC)' : 'School (VI - X)') }}</h3>
          <button type="button" class="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" (click)="showForm.set(false)" aria-label="Close"><lucide-icon [img]="closeIcon" [size]="20" /></button>
        </div>

        <div class="flex items-center gap-4">
          @if (form.photo) { <img [src]="form.photo" alt="Student photo" class="w-20 h-20 rounded-2xl object-cover border border-slate-200 dark:border-slate-700"> }
          @else { <span class="w-20 h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 grid place-items-center text-xs font-black text-slate-400">No photo</span> }
          <div class="space-y-2">
            <label class="btn-ghost cursor-pointer inline-block">Choose photo<input type="file" accept="image/*" class="hidden" (change)="pickPhoto($event)"></label>
            @if (form.photo) { <button type="button" class="btn-ghost ml-2" (click)="form.photo = ''">Remove</button> }
            @if (!editingId()) { <label class="btn-ghost cursor-pointer inline-block ml-2">{{ scanning() ? 'Reading…' : 'Fill from photo of filled form' }}<input type="file" accept="image/*" class="hidden" [disabled]="scanning()" (change)="scanForm($event)"></label> }
            <p class="text-[11px] font-bold text-slate-400">It is shrunk automatically. The photo is printed on result cards and certificates.</p>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div><label class="label" for="f-name">Student name</label><input id="f-name" name="name" class="field" required [(ngModel)]="form.name"></div>
          <div><label class="label" for="f-father">Father's name</label><input id="f-father" name="father" class="field" required [(ngModel)]="form.father_name"></div>
          <div><label class="label" for="f-gender">Gender</label>
            <select id="f-gender" name="gender" class="field" [(ngModel)]="form.gender"><option value="male">Boy</option><option value="female">Girl</option></select></div>
          <div><label class="label" for="f-dob">Date of birth</label><input id="f-dob" name="dob" type="date" class="field" [(ngModel)]="form.dob"></div>
          <div><label class="label" for="f-class">Class</label>
            <select id="f-class" name="class" class="field" required [(ngModel)]="form.class_id" (ngModelChange)="form.section_id = null; loadPreview()">
              <option [ngValue]="null" disabled>Choose class</option>
              @for (c of formClasses(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
            </select></div>
          <div><label class="label" for="f-sec">Section</label>
            <select id="f-sec" name="section" class="field" required [(ngModel)]="form.section_id" [disabled]="!form.class_id" (ngModelChange)="loadPreview()">
              <option [ngValue]="null" disabled>Choose section</option>
              @for (s of formSections(); track s.id) { <option [ngValue]="s.id">Section {{ s.name }}</option> }
            </select></div>
          <div><label class="label" for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" class="field" [ngModel]="form.phone" (ngModelChange)="form.phone = fp($event); soon()" inputmode="numeric" maxlength="12" placeholder="0300-1234567"></div>
          <div><label class="label" for="f-addr">Address</label><input id="f-addr" name="address" class="field" [(ngModel)]="form.address"></div>
          <div><label class="label" for="f-roll">Roll number (empty = next number)</label><input id="f-roll" name="roll" type="number" min="1" class="field" [(ngModel)]="form.roll_no"></div>
          <div><label class="label" for="f-cnic">Father's CNIC (optional)</label><input id="f-cnic" name="cnic" class="field" [ngModel]="form.father_cnic" (ngModelChange)="form.father_cnic = fc($event); soon()" inputmode="numeric" maxlength="15"></div>
          <div><label class="label" for="f-cat">Category (father's job)</label>
            <select id="f-cat" name="cat" class="field" [(ngModel)]="form.category" (ngModelChange)="loadPreview()"><option value="">Not set</option><option value="A">A - working in KRL</option><option value="B">B - retired from KRL</option><option value="C">C - private job</option></select></div>
          @if (form.category === 'A' || form.category === 'B') { <div><label class="label" for="f-pn">P number (parents' special code)</label><input id="f-pn" name="pn" class="field" placeholder="e.g. P-12345" [(ngModel)]="form.p_number"></div> }
          <div><label class="label" for="f-fp">Father's phone</label><input id="f-fp" name="fp" type="tel" class="field" [ngModel]="form.father_phone" (ngModelChange)="form.father_phone = fp($event); soon()" inputmode="numeric" maxlength="12" placeholder="0300-1234567"></div>
          <div><label class="label" for="f-mp">Mother's phone</label><input id="f-mp" name="mp" type="tel" class="field" [ngModel]="form.mother_phone" (ngModelChange)="form.mother_phone = fp($event); soon()" inputmode="numeric" maxlength="12" placeholder="0300-1234567"></div>
          <div class="md:col-span-2 space-y-3" aria-live="polite">
            @if (siblings().length) {
              <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <p class="text-sm font-black text-amber-800 dark:text-amber-300">{{ siblings().length }} {{ siblings().length === 1 ? 'sibling is' : 'siblings are' }} already studying here ({{ siblings().length + 1 }} children in total with this admission)</p>
                <ul class="mt-2 space-y-1">
                  @for (b of siblings(); track b.id) {
                    <li class="flex items-center gap-3 text-sm">
                      <span class="w-8 h-8 rounded-full bg-amber-500/20 grid place-items-center text-[10px] font-black">{{ ini(b.name) }}</span>
                      <a [routerLink]="['/students', b.id]" target="_blank" class="font-black underline decoration-dotted hover:text-indigo-600">{{ b.name }}</a>
                      <span class="text-xs font-bold text-slate-500">{{ b.class_name }}-{{ b.section_name }} &middot; Adm. {{ b.reg_no }}</span>
                    </li>
                  }
                </ul>
              </div>
            } @else if (sibChecked()) {
              <p class="text-xs font-bold text-slate-400">No brother or sister found with this CNIC / phone number.</p>
            }
            @if (preview(); as pv) {
              <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
                <p class="label !ml-0">Fee for this student{{ form.category ? ' (category ' + form.category + ')' : '' }}</p>
                @if (!pv.rows.length) { <p class="text-xs font-bold text-slate-400">No fee amounts are set for this class yet (Fee management &rarr; Fee structure).</p> }
                @else {
                  <table class="w-full text-sm mt-1">
                    @for (r of pv.rows; track r.head_id) { <tr><td class="py-0.5 font-bold">{{ r.name }} <span class="text-[10px] text-slate-400">{{ r.frequency === 'monthly' ? 'monthly' : r.frequency === 'annual' ? 'yearly' : 'one time' }}</span></td><td class="py-0.5 text-right font-bold">{{ mny(r.amount) }}</td></tr> }
                    @for (l of pv.lines; track $index) { <tr class="text-emerald-700 dark:text-emerald-300"><td class="py-0.5 font-bold">{{ l.text }}</td><td class="py-0.5 text-right font-bold">- {{ mny(l.amount) }}</td></tr> }
                    <tr class="border-t border-slate-200 dark:border-slate-700"><td class="pt-1 font-black">Monthly fee</td><td class="pt-1 text-right font-black">Rs {{ mny(pv.monthly) }}</td></tr>
                    @if (pv.once) { <tr><td class="font-black">One-time / yearly charges</td><td class="text-right font-black">Rs {{ mny(pv.once) }}</td></tr> }
                  </table>
                }
              </div>
            }
          </div>
          @if (trRoutes().length) {
            <app-transport-picker class="md:col-span-2" [routes]="trRoutes()" [savedRouteId]="savedRouteId()" [routeId]="form.tr_route_id" (routeIdChange)="form.tr_route_id = $event; form.tr_stop_id = null"
              [stopId]="form.tr_stop_id" (stopIdChange)="form.tr_stop_id = $event" [mode]="form.tr_mode || 'both'" (modeChange)="form.tr_mode = $event" />
          }
        </div>

        @if (formError()) { <p role="alert" class="text-sm font-bold text-rose-500">{{ formError() }}</p> }

        <div class="flex justify-end gap-3 pt-2">
          <button type="button" class="btn-ghost" (click)="showForm.set(false)">Cancel</button>
          @if (editingId()) { <a [routerLink]="['/students/form', editingId()]" class="btn-ghost">Print form</a> }
          @else { <button type="button" class="btn-ghost" [disabled]="saving()" (click)="save(true)">Save &amp; open admission form</button> }
          <button type="submit" class="btn-primary" [disabled]="saving()">{{ editingId() ? 'Save changes' : 'Add student' }}</button>
        </div>
      </form>
    </div>
  }
  @if (cropFile(); as cf) { <app-photo-cropper [file]="cf" (done)="onCrop($event)" (cancel)="cropFile.set(null)" /> }
  `
})
export class Students {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private router = inject(Router);
  auth = inject(AuthService);

  plusIcon = Plus; searchIcon = Search; editIcon = Pencil; trashIcon = Trash2; closeIcon = X;

  classes = signal<ClassInfo[]>([]);
  classId = signal<number | null>(null);
  sectionId = signal<number | null>(null);
  q = signal('');
  page = signal(1);
  data = signal<StudentPage | null>(null);
  realNew = signal(0);
  error = signal('');

  showForm = signal(false); chooser = signal(false); wing = signal<'school' | 'college'>('school');
  formClasses = computed(() => this.editingId() ? this.classes() : this.classes().filter(c => (this.wing() === 'college') === (c.grade >= 11)));
  editingId = signal<number | null>(null);
  saving = signal(false);
  formError = signal('');
  form: Form = emptyForm();

  trRoutes = signal<TrRoute[]>([]); savedRouteId = signal<number | null>(null);
  trStops = () => this.trRoutes().find(r => r.id === this.form.tr_route_id)?.stops ?? [];
  trFee = () => {
    const r = this.trRoutes().find(x => x.id === this.form.tr_route_id); if (!r) return 0;
    const p = r.stops.find(x => x.id === this.form.tr_stop_id), both = p?.fee_both ?? r.fee_both ?? 0;
    return this.form.tr_mode === 'both' ? both : (p?.fee_one ?? r.fee_one ?? both);
  };
  filterSections = computed(() => this.classes().find(c => c.id === this.classId())?.sections ?? []);
  formSections = () => this.classes().find(c => c.id === this.form.class_id)?.sections ?? [];
  pages = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / (this.data()?.limit ?? 25))));

  private timer: any;

  constructor() {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('classId')) this.classId.set(Number(qp.get('classId')));
    if (qp.get('sectionId')) this.sectionId.set(Number(qp.get('sectionId')));
    this.api.get<ClassInfo[]>('/classes').subscribe({
      next: c => { this.classes.set(c); if (qp.get('new') && this.auth.canWriteStudents()) this.openNew(); },
      error: e => this.error.set(errorText(e))
    });
    if (this.auth.canWriteStudents()) this.api.get<any[]>('/transport/lookup').subscribe({ next: r => this.trRoutes.set(r), error: () => { /* transport not available */ } });
    if (this.auth.canWriteStudents()) this.api.get<{ counts: { new: number } }>('/import/real-students').subscribe({ next: r => this.realNew.set(r.counts?.new ?? 0), error: () => { /* the list is only a hint */ } });
    this.load();
  }

  load() {
    this.api.get<StudentPage>('/students', {
      classId: this.classId() ?? undefined, sectionId: this.sectionId() ?? undefined, q: this.q(), page: this.page()
    }).subscribe({
      next: d => { this.data.set(d); this.error.set(''); },
      error: e => this.error.set(errorText(e))
    });
  }

  setClass(id: number | null) { this.classId.set(id); this.sectionId.set(null); this.page.set(1); this.load(); }
  setSection(id: number | null) { this.sectionId.set(id); this.page.set(1); this.load(); }
  onSearch(v: string) {
    this.q.set(v);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.page.set(1); this.load(); }, 300);
  }
  go(p: number) { this.page.set(p); this.load(); }

  ini = initials; mny = money;
  siblings = signal<Sibling[]>([]); sibChecked = signal(false); preview = signal<CatPreview | null>(null);
  private sibTimer: any;
  soon() { clearTimeout(this.sibTimer); this.sibTimer = setTimeout(() => this.lookupSiblings(), 400); }
  lookupSiblings() {
    const f = this.form;
    if (f.father_cnic.replace(/\D/g, '').length < 13 && ![f.father_phone, f.mother_phone, f.phone].some(p => p.replace(/\D/g, '').length >= 10)) { this.siblings.set([]); this.sibChecked.set(false); return; }
    this.api.get<Sibling[]>('/students/siblings', { cnic: f.father_cnic, phone1: f.father_phone, phone2: f.mother_phone, phone3: f.phone, exclude: this.editingId() ?? undefined }).subscribe({
      next: r => { this.siblings.set(r); this.sibChecked.set(true); this.loadPreview(); }, error: () => { /* the list is only a help */ }
    });
  }
  loadPreview() {
    if (!this.form.class_id) { this.preview.set(null); return; }
    this.api.get<CatPreview>('/fee/category-preview', { classId: this.form.class_id, category: this.form.category || undefined, transport: this.form.tr_route_id ? 1 : undefined, order: this.siblings().length + 1 }).subscribe({
      next: p => this.preview.set(p), error: () => this.preview.set(null)
    });
  }
  private http = inject(HttpClient);
  scanning = signal(false);
  /** A photo of a filled admission form fills the empty boxes; the person checks every field and presses Save. */
  async scanForm(ev: Event) {
    const input = ev.target as HTMLInputElement, f = input.files?.[0]; input.value = ''; if (!f) return;
    this.scanning.set(true); this.formError.set('');
    const blob = await shrinkImage(f);
    this.http.post<Record<string, string>>('/api/ocr/admission', blob, { headers: { 'Content-Type': 'application/octet-stream' } }).subscribe({
      next: r => {
        this.scanning.set(false);
        const fm = this.form as any, put = (k: string, v: string) => { if (v && !fm[k]) fm[k] = v; };
        put('name', r['name']); put('father_name', r['father_name']); put('father_cnic', r['father_cnic']); put('dob', r['dob']); put('phone', r['phone']);
        put('father_phone', r['father_phone']); put('mother_phone', r['mother_phone']); put('address', r['address']); put('p_number', r['p_number']);
        if (r['gender']) this.form.gender = r['gender'].toLowerCase() === 'female' ? 'female' : 'male';
        const want = (r['class'] ?? '').toLowerCase().replace(/\s+/g, '');
        const c = want ? this.classes().find(x => x.name.toLowerCase().replace(/\s+/g, '') === want || x.name.toLowerCase().replace(/\s+/g, '').includes(want) || want.includes(x.name.toLowerCase().replace(/\s+/g, ''))) : null;
        if (c && !this.form.class_id) { this.form.class_id = c.id; this.form.section_id = null; }
        this.toast.show('Form read. Check every box before saving.');
      },
      error: e => { this.scanning.set(false); this.formError.set(errorText(e)); }
    });
  }

  pickPhoto(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    this.cropFile.set(f); (ev.target as HTMLInputElement).value = '';
  }
  cropFile = signal<File | null>(null);
  fp = fmtPhone; fc = fmtCnic;
  onCrop(url: string) { this.form.photo = url; this.cropFile.set(null); }

  openNew() { this.chooser.set(true); }
  startNew(_w: 'school' | 'college', type: 'school' | 'registration' | 'college') {
    this.chooser.set(false);
    this.router.navigate(['/students/form/new'], { queryParams: { type } });
  }
  openEdit(s: Student) {
    if (s.has_photo) this.api.get<{ photo: string | null }>(`/students/${s.id}/photo`).subscribe({ next: r => { if (this.editingId() === s.id && this.form.photo === undefined) this.form.photo = r.photo ?? undefined; } });
    this.form = { name: s.name, father_name: s.father_name, gender: s.gender, dob: s.dob ?? '', phone: s.phone ?? '', address: s.address ?? '', class_id: s.class_id, section_id: s.section_id, roll_no: s.roll_no, father_cnic: s.father_cnic ?? '', category: s.category ?? '', p_number: s.p_number ?? '', father_phone: s.father_phone ?? '', mother_phone: s.mother_phone ?? '', photo: s.photo ?? undefined, tr_route_id: s.tr_route_id, tr_stop_id: s.tr_stop_id, tr_mode: s.tr_mode ?? 'both' };
    this.editingId.set(s.id); this.savedRouteId.set(s.tr_route_id ?? null); this.formError.set(''); this.siblings.set([]); this.sibChecked.set(false); this.lookupSiblings(); this.loadPreview(); this.showForm.set(true);
  }

  save(print = false, force = false) {
    this.formError.set('');
    if (!this.form.section_id) { this.formError.set('Choose a class and section.'); return; }
    this.saving.set(true);
    const body = { ...this.form, force: force || undefined };
    const id = this.editingId();
    const req = id ? this.api.put(`/students/${id}`, body) : this.api.post<{ reg_no: string }>('/students', body);
    req.subscribe({
      next: (r: any) => {
        this.saving.set(false); this.showForm.set(false);
        this.toast.show(id ? 'Student updated.' : `Student added. Reg no: ${r.reg_no}`);
        if (print && r?.id) this.router.navigate(['/students/form', r.id], { queryParams: { type: this.wing() } });
        if (r?.warning) this.toast.show(r.warning, 'error');
        if (r?.voucher_id) this.toast.show('First fee voucher was made. Print it from Fee management.');
        else if (r?.voucher_note) this.toast.show('No first voucher: ' + r.voucher_note, 'error');
        this.load();
      },
      error: e => {
        this.saving.set(false);
        if (e?.status === 409 && e?.error?.duplicate && confirm(e.error.message)) { this.save(print, true); return; }   // same name + father + date of birth: ask, then save anyway
        this.formError.set(errorText(e));
      }
    });
  }

  remove(s: Student) {
    if (!confirm(`Remove ${s.name} from the active student list? The record is kept in the database.`)) return;
    this.api.delete(`/students/${s.id}`).subscribe({
      next: () => { this.toast.show('Student removed.'); this.load(); },
      error: e => this.toast.show(errorText(e), 'error')
    });
  }
}
