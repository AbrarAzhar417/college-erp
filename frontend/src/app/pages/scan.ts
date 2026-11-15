import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, errorText } from '../core/api';

/** Reached by scanning the QR on a student's card: finds the student by admission number and opens the profile. */
@Component({
  selector: 'app-scan',
  template: `<div class="max-w-md mx-auto py-24 text-center">@if (error()) { <p role="alert" class="p-4 rounded-2xl bg-rose-500/10 text-rose-600 font-bold">{{ error() }}</p> } @else { <p class="font-bold text-slate-400">Opening the student...</p> }</div>`
})
export class Scan {
  error = signal('');
  constructor() {
    const reg = inject(ActivatedRoute).snapshot.paramMap.get('reg') ?? '', router = inject(Router);
    inject(Api).get<{ id: number }>(`/students/by-reg/${encodeURIComponent(reg)}`).subscribe({ next: r => router.navigate(['/students', r.id], { replaceUrl: true }), error: e => this.error.set(errorText(e)) });
  }
}
