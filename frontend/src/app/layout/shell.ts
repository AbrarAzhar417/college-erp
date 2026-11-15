import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { LucideAngularModule, Menu, Moon, Sun, LogOut, X, UserRound } from 'lucide-angular';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth';
import { SettingsService } from '../core/settings';
import { ThemeService } from '../core/theme';
import { OfflineQueue } from '../core/offline';
import { ToastService } from '../core/toast';
import { NAV, TEACHER_NAV, ALL_ITEMS } from '../core/modules';
import { ROLE_LABEL } from '../core/models';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
  <div class="flex h-screen w-screen overflow-hidden bg-[#f8fafc] dark:bg-brand-dark text-slate-900 dark:text-slate-100 transition-colors duration-500">

    @if (open()) {
      <div class="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm lg:hidden" (click)="open.set(false)"></div>
    }

    <aside class="fixed inset-y-0 left-0 z-[60] w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform lg:static lg:translate-x-0"
           [class.-translate-x-full]="!open()">
      <div class="flex flex-col h-full">
        <div class="p-8 flex items-center gap-4">
          @if (settings.logoUrl()) {
            <img [src]="settings.logoUrl()" alt="" class="w-12 h-12 shrink-0 rounded-xl object-contain bg-white p-0.5 shadow-lg">
          } @else {
            <div class="w-12 h-12 shrink-0 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg font-black text-2xl italic">{{ settings.initial() }}</div>
          }
          <div class="min-w-0">
            <h1 class="text-base font-black text-slate-800 dark:text-white uppercase leading-tight tracking-tight line-clamp-2">{{ settings.instituteName() }}</h1>
            <p class="text-[9px] font-bold text-indigo-500 uppercase tracking-widest mt-1">Management Portal</p>
          </div>
        </div>

        <nav class="flex-1 px-4 pb-6 overflow-y-auto no-scrollbar space-y-6" aria-label="Main navigation">
          @for (g of nav(); track g.title) {
            <div>
              <p class="px-4 mb-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">{{ g.title }}</p>
              <div class="space-y-1">
                @for (item of g.items; track item.key) {
                  <a [routerLink]="item.link" routerLinkActive="!bg-indigo-600 !text-white shadow-lg shadow-indigo-600/30"
                     [routerLinkActiveOptions]="{ exact: item.link === '/' }" (click)="open.set(false)"
                     class="flex items-center gap-4 px-4 py-3 rounded-2xl text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                    <lucide-icon [img]="item.icon" [size]="18" [strokeWidth]="2.5" />
                    <span class="flex-1 truncate">{{ item.label }}</span>
                  </a>
                }
              </div>
            </div>
          }
        </nav>

        <div class="p-4 border-t border-slate-100 dark:border-slate-800">
          <div class="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/50">
            <a routerLink="/profile" (click)="open.set(false)" class="flex items-center gap-3 flex-1 min-w-0" title="My profile">
              <div class="w-10 h-10 shrink-0 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <lucide-icon [img]="userIcon" [size]="18" />
              </div>
              <div class="min-w-0">
                <p class="text-xs font-black truncate">{{ auth.user()?.name }}</p>
                <p class="text-[10px] font-bold text-slate-400 truncate">{{ roleLabel() }}</p>
              </div>
            </a>
            <button type="button" (click)="auth.logout()" aria-label="Log out"
                    class="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors">
              <lucide-icon [img]="logoutIcon" [size]="18" />
            </button>
          </div>
        </div>
      </div>
    </aside>

    <div class="flex-1 flex flex-col min-w-0">
      <header class="no-print h-20 shrink-0 px-5 md:px-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/40 backdrop-blur-md">
        <div class="flex items-center gap-4 min-w-0">
          <button type="button" class="lg:hidden p-3 rounded-2xl bg-slate-100 dark:bg-slate-800" (click)="open.set(true)" aria-label="Open menu">
            <lucide-icon [img]="menuIcon" [size]="20" />
          </button>
          <h2 class="text-lg md:text-xl font-black tracking-tight truncate">{{ title() }}</h2>
        </div>
        <button type="button" (click)="theme.toggle($event)" class="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-500 transition-colors"
                [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
          <lucide-icon [img]="theme.theme() === 'dark' ? sunIcon : moonIcon" [size]="20" />
        </button>
      </header>

      <main class="flex-1 overflow-y-auto p-5 md:p-10">
        @if (!offline.online() || offline.count() > 0) {
          <div role="status" class="no-print mb-4 p-3 rounded-2xl bg-amber-500/15 text-amber-800 dark:text-amber-300 text-sm font-bold flex flex-wrap items-center gap-3">
            <span>@if (!offline.online()) { No internet. } @if (offline.count() > 0) { {{ offline.count() }} saved on this phone, waiting to be sent. }</span>
            @if (offline.count() > 0 && offline.online()) { <button type="button" class="btn-ghost" (click)="offline.flush()">Send now</button> }
          </div>
        }
        <router-outlet />
      </main>
    </div>

    @if (toast.message(); as t) {
      <div role="status" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-4 rounded-2xl text-sm font-bold shadow-enterprise-lg text-white"
           [class.bg-emerald-600]="t.kind === 'ok'" [class.bg-rose-600]="t.kind === 'error'">{{ t.text }}</div>
    }
  </div>
  `
})
export class Shell {
  auth = inject(AuthService);
  offline = inject(OfflineQueue);
  settings = inject(SettingsService);
  theme = inject(ThemeService);
  toast = inject(ToastService);
  private router = inject(Router);

  nav = computed(() => {
    const u = this.auth.user(), role = u?.role, duties = u?.duties ?? [];
    if (role === 'teacher') return TEACHER_NAV.map(g => ({ ...g, items: g.items.filter(i => !i.duties || i.duties.some(d => duties.includes(d))) })).filter(g => g.items.length);
    return NAV.map(g => ({ ...g, items: g.items.filter(i => !i.roles || (role && i.roles.includes(role))) })).filter(g => g.items.length);
  });
  open = signal(false);
  menuIcon = Menu; moonIcon = Moon; sunIcon = Sun; logoutIcon = LogOut; closeIcon = X; userIcon = UserRound;
  roleLabel = computed(() => ROLE_LABEL[this.auth.user()?.role ?? 'teacher']);

  private url = signal(this.router.url);
  title = computed(() => {
    const u = this.url().split('?')[0];
    if (u === '/profile') return 'My Profile';
    const hit = ALL_ITEMS.filter(i => i.link !== '/' && (u === i.link || u.startsWith(i.link + '/'))).sort((a, b) => b.link.length - a.link.length)[0] ?? ALL_ITEMS.find(i => i.link === u);
    return hit?.label ?? 'Dashboard';
  });

  constructor() {
    this.auth.refresh();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.url.set(this.router.url));
  }
}
