/** Turns the { filename, mime, base64 } the server sends into a file the browser saves. */
export function saveBase64(r: { filename: string; mime: string; base64: string }) {
  const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: r.mime })), a = document.createElement('a');
  a.href = url; a.download = r.filename; a.click(); URL.revokeObjectURL(url);
}
export function saveText(filename: string, text: string, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: `${mime};charset=utf-8` })), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
export const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Phone photos of a page are huge; a 1800 px JPEG reads just as well and uploads quickly on weak internet. */
export function shrinkImage(f: File, maxSide = 1800): Promise<Blob> {
  return new Promise(done => {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => done(b ?? f), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); done(f); };
    img.src = url;
  });
}
