import { Component, ElementRef, OnInit, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Passport-style crop: the shape the printed forms and ID cards use (about 4 : 5). */
export const PHOTO_W = 240, PHOTO_H = 300;

@Component({
  selector: 'app-photo-cropper',
  imports: [FormsModule],
  template: `
  <div class="no-print fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Adjust photo">
    <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 w-full max-w-sm space-y-4 max-h-full overflow-y-auto">
      <h2 class="font-black text-lg">Adjust photo</h2>
      <p class="text-xs font-bold text-slate-400">Drag the picture to move it, use the slider to zoom. Only the framed part is saved, the same shape as on the form and the card.</p>
      <div class="flex justify-center">
        <canvas #cv [width]="W" [height]="H" class="rounded-xl border-2 border-indigo-500 touch-none cursor-grab bg-slate-200" [style.width.px]="W" [style.height.px]="H"
          (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)"></canvas>
      </div>
      @if (error()) { <p role="alert" class="text-sm font-bold text-rose-600">{{ error() }}</p> }
      <div><label class="label" for="pc-zoom">Zoom</label>
        <input id="pc-zoom" type="range" min="1" max="4" step="0.01" class="w-full" [ngModel]="zoom()" (ngModelChange)="setZoom($event)"></div>
      <div class="flex gap-2 justify-end">
        <button type="button" class="btn-ghost" (click)="cancel.emit()">Cancel</button>
        <button type="button" class="btn-primary" [disabled]="!ready()" (click)="save()">Use this photo</button>
      </div>
    </div>
  </div>`
})
export class PhotoCropper implements OnInit {
  file = input.required<File>();
  done = output<string>();
  cancel = output<void>();
  readonly W = PHOTO_W; readonly H = PHOTO_H;
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  zoom = signal(1); ready = signal(false); error = signal('');
  private img: HTMLImageElement | null = null;
  private ox = 0; private oy = 0;
  private drag: { id: number; x: number; y: number } | null = null;

  private base() { return Math.max(PHOTO_W / this.img!.width, PHOTO_H / this.img!.height); }
  private scale() { return this.base() * this.zoom(); }
  private clamp() {
    const s = this.scale(), iw = this.img!.width * s, ih = this.img!.height * s;
    this.ox = Math.min(0, Math.max(PHOTO_W - iw, this.ox)); this.oy = Math.min(0, Math.max(PHOTO_H - ih, this.oy));
  }
  private paint(ctx: CanvasRenderingContext2D, k: number) {
    const s = this.scale(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PHOTO_W * k, PHOTO_H * k);
    ctx.drawImage(this.img!, this.ox * k, this.oy * k, this.img!.width * s * k, this.img!.height * s * k);
  }
  private draw() { if (this.img) this.paint(this.cv().nativeElement.getContext('2d')!, 1); }

  ngOnInit() {
    const url = URL.createObjectURL(this.file()), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url); this.img = img;
      this.ox = (PHOTO_W - img.width * this.base()) / 2; this.oy = (PHOTO_H - img.height * this.base()) / 2;
      this.ready.set(true); this.draw();
    };
    img.onerror = () => { URL.revokeObjectURL(url); this.error.set('This picture cannot be read.'); };
    img.src = url;
  }
  setZoom(z: number | string) {
    if (!this.img) return;
    const old = this.scale(), cx = (PHOTO_W / 2 - this.ox) / old, cy = (PHOTO_H / 2 - this.oy) / old;
    this.zoom.set(Math.min(4, Math.max(1, Number(z) || 1)));
    const s = this.scale(); this.ox = PHOTO_W / 2 - cx * s; this.oy = PHOTO_H / 2 - cy * s; this.clamp(); this.draw();
  }
  down(e: PointerEvent) { if (!this.img) return; this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }
  move(e: PointerEvent) {
    if (!this.drag || !this.img || e.pointerId !== this.drag.id) return;
    this.ox += e.clientX - this.drag.x; this.oy += e.clientY - this.drag.y; this.drag.x = e.clientX; this.drag.y = e.clientY; this.clamp(); this.draw();
  }
  up(e: PointerEvent) { if (this.drag && e.pointerId === this.drag.id) this.drag = null; }
  save() {
    if (!this.img) return;
    const k = 4 / 3, c = document.createElement('canvas'); c.width = Math.round(PHOTO_W * k); c.height = Math.round(PHOTO_H * k);
    this.paint(c.getContext('2d')!, k); this.done.emit(c.toDataURL('image/jpeg', 0.85));
  }
}
