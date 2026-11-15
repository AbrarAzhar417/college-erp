import { Directive, ElementRef, Input, OnChanges, inject } from '@angular/core';
import JsBarcode from 'jsbarcode';

/** Draws a Code 128 barcode (readable by any barcode scanner) into an <svg>. */
@Directive({ selector: 'svg[appBarcode]' })
export class Barcode implements OnChanges {
  @Input('appBarcode') value = '';
  private el = inject<ElementRef<SVGSVGElement>>(ElementRef);

  ngOnChanges() {
    const svg = this.el.nativeElement;
    try {
      JsBarcode(svg, this.value, { format: 'CODE128', displayValue: false, height: 40, width: 2, margin: 0 });
      const w = svg.getAttribute('width'), h = svg.getAttribute('height');
      if (w && h) { svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('preserveAspectRatio', 'none'); }
    } catch { /* value cannot be encoded: leave blank */ }
  }
}
