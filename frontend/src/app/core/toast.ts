import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal<{ text: string; kind: 'ok' | 'error' } | null>(null);
  private timer: any;

  show(text: string, kind: 'ok' | 'error' = 'ok') {
    clearTimeout(this.timer);
    this.message.set({ text, kind });
    this.timer = setTimeout(() => this.message.set(null), 4000);
  }
}
