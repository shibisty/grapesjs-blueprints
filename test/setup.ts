import { afterEach } from 'vitest';

/*
 * jsdom quirk (same as grapesjs-pages): GrapesJS renders the canvas from the iframe's `onload`,
 * and that render makes jsdom dispatch `load` again and again. A browser fires it once.
 */
Object.defineProperty(HTMLIFrameElement.prototype, 'onload', {
  configurable: true,
  get(this: HTMLIFrameElement & { __gjsOnload?: EventListener | null }) {
    return this.__gjsOnload || null;
  },
  set(this: HTMLIFrameElement & { __gjsOnload?: EventListener | null; __gjsOnloadBound?: boolean }, fn: EventListener | null) {
    this.__gjsOnload = fn;
    if (this.__gjsOnloadBound) return;
    this.__gjsOnloadBound = true;
    let done = false;
    this.addEventListener('load', (e) => {
      if (done || !this.__gjsOnload) return;
      done = true;
      this.__gjsOnload.call(this, e);
    });
  },
});

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
if (!(globalThis as any).CSS?.escape) (globalThis as any).CSS = { ...(globalThis as any).CSS, escape: (s: string) => s.replace(/["\\]/g, '\\$&') };

afterEach(() => {
  document.getElementById('gjscr-style')?.remove();
});
