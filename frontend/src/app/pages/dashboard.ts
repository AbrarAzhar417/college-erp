import { NoticeCard } from '../notice/notice-card';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, GraduationCap, Users, Layers, Briefcase, UserPlus } from 'lucide-angular';
import { Api, errorText } from '../core/api';
import { AuthService } from '../core/auth';
import { SettingsService } from '../core/settings';
import { DashboardData } from '../core/models';
import { TodayCard } from './today-card';
import { GlobalSearch } from './global-search';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, LucideAngularModule, TodayCard, NoticeCard, GlobalSearch],
  template: `
  <div class="space-y-8 pb-16 max-w-7xl mx-auto">

    <section class="bg-white dark:bg-slate-900/40 p-8 md:p-12 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise relative overflow-hidden">
      <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-[120px] -mr-48 -mt-48"></div>
      <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div class="flex items-center gap-5">
          <div class="p-4 bg-indigo-600 text-white rounded-[1.8rem] shadow-indigo-glow animate-float">
            <lucide-icon [img]="capIcon" [size]="30" [strokeWidth]="2.5" />
          </div>
          <div>
            <p class="text-xs font-bold text-slate-400 mb-1">{{ settings.instituteName() }}</p>
            <h2 class="text-3xl md:text-4xl font-black tracking-tighter leading-none">Welcome, {{ auth.user()?.name }}</h2>
          </div>
        </div>
        @if (auth.canWriteStudents()) {
          <a routerLink="/students" [queryParams]="{ new: 1 }" class="btn-primary self-start md:self-auto">
            <lucide-icon [img]="addIcon" [size]="16" [strokeWidth]="3" /> New admission
          </a>
        }
      </div>
    </section>

    <app-global-search />

    <app-today-card />
    <app-notice-card />

    @if (error()) {
      <p role="alert" class="p-5 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-sm">{{ error() }}</p>
    }

    @if (d(); as d) {
      <section class="grid grid-cols-2 xl:grid-cols-4 gap-5 md:gap-8">
        @for (s of stats(); track s.label) {
          <div class="bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
            <div class="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 text-white" [class]="s.bg">
              <lucide-icon [img]="s.icon" [size]="22" [strokeWidth]="2.5" />
            </div>
            <p class="text-3xl md:text-4xl font-black tracking-tighter">{{ s.value }}</p>
            <p class="text-xs font-bold text-slate-400 mt-1">{{ s.label }}</p>
            @if (s.sub) { <p class="text-[11px] font-bold text-slate-400 mt-3">{{ s.sub }}</p> }
          </div>
        }
      </section>

      @if (fac(); as f) {
        <a routerLink="/teachers" class="block bg-white dark:bg-slate-900/40 p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <div class="flex flex-wrap items-center gap-6">
            <div><p class="text-3xl font-black tracking-tighter">{{ f.total }}</p><p class="text-xs font-bold text-slate-400 mt-1">Teachers</p></div>
            <div class="flex flex-wrap gap-2 flex-1">
              @for (r of f.byRank; track r.key) { <span class="px-3 py-1 rounded-full bg-slate-500/5 text-xs font-black">{{ r.label }}: {{ r.count }}</span> }
              @if (f.noRank) { <span class="px-3 py-1 rounded-full bg-amber-500/10 text-amber-700 text-xs font-black">Rank not set: {{ f.noRank }}</span> }
            </div>
            <span class="text-xs font-black text-indigo-600">{{ f.noLogin }} without login. Manage teachers</span>
          </div>
        </a>
      }

      <section class="grid grid-cols-1 xl:grid-cols-3 gap-5 md:gap-8">
        <div class="xl:col-span-2 bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <h3 class="text-xl font-black tracking-tight mb-8">Students per class</h3>
          <div class="space-y-4">
            @for (c of d.byClass; track c.grade) {
              <a routerLink="/classes" class="flex items-center gap-4 group">
                <span class="w-20 text-sm font-bold text-slate-500 group-hover:text-indigo-500 transition-colors">{{ c.name }}</span>
                <div class="flex-1 h-4 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden">
                  <div class="h-full bg-indigo-600 rounded-full transition-all duration-700" [style.width.%]="pct(c.students)"></div>
                </div>
                <span class="w-10 text-right text-sm font-black">{{ c.students }}</span>
              </a>
            }
          </div>
        </div>

        <div class="bg-white dark:bg-slate-900/40 p-8 md:p-10 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-enterprise">
          <h3 class="text-xl font-black tracking-tight mb-6">Latest admissions</h3>
          @if (d.recent.length === 0) {
            <p class="text-sm font-bold text-slate-400">No students yet. Use "New admission" to add the first one.</p>
          }
          <ul class="space-y-3">
            @for (r of d.recent; track r.id) {
              <li class="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
                <div class="w-10 h-10 shrink-0 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm">{{ r.name[0] }}</div>
                <div class="min-w-0">
                  <p class="text-sm font-black truncate">{{ r.name }}</p>
                  <p class="text-[11px] font-bold text-slate-400">{{ r.class_name }}-{{ r.section_name }} · {{ r.reg_no }}</p>
                </div>
              </li>
            }
          </ul>
        </div>
      </section>
    } @else if (!error()) {
      <p class="text-sm font-bold text-slate-400">Loading dashboard…</p>
    }
  </div>
  `
})
export class Dashboard {
  private api = inject(Api);
  auth = inject(AuthService);
  settings = inject(SettingsService);

  d = signal<DashboardData | null>(null);
  fac = signal<{ total: number; byRank: { key: string; label: string; count: number }[]; noRank: number; noLogin: number } | null>(null);
  error = signal('');
  capIcon = GraduationCap; addIcon = UserPlus;

  max = computed(() => Math.max(1, ...(this.d()?.byClass.map(c => c.students) ?? [1])));
  pct(n: number) { return Math.round((n / this.max()) * 100); }

  stats = computed(() => {
    const d = this.d();
    if (!d) return [];
    return [
      { label: 'Active students', value: d.students, sub: `${d.boys} boys · ${d.girls} girls`, icon: Users, bg: 'bg-indigo-600' },
      { label: 'Classes', value: d.classes, sub: 'Class 6 to 12', icon: GraduationCap, bg: 'bg-emerald-600' },
      { label: 'Sections', value: d.sections, sub: 'A to E in every class', icon: Layers, bg: 'bg-amber-500' },
      { label: 'Staff accounts', value: d.staff, sub: '', icon: Briefcase, bg: 'bg-rose-500' }
    ];
  });

  constructor() {
    this.api.get<any>('/faculty/summary').subscribe({ next: r => this.fac.set(r), error: () => this.fac.set(null) });
    this.api.get<DashboardData>('/dashboard').subscribe({
      next: d => this.d.set(d),
      error: e => this.error.set(errorText(e))
    });
  }
}
