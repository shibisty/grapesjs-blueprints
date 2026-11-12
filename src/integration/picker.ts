import type { Editor } from 'grapesjs';

/** GrapesJS editor-only classes, never part of a selector. */
const EDITOR_CLASS = /^(gjs-|gjs$|selected|hovered)/;
/** Ids GrapesJS generates (`i3kd`, `ixa9-2`, `c1234`): they change when components are copied. */
export const AUTO_ID = /^(i[a-z0-9]{2,5}(-\d+)*|c\d+|[a-z]{1,2}\d{3,})$/i;

export interface SelectorCandidate {
  selector: string;
  /** Matches in the current page. */
  count: number;
  /** `unstable`: an id GrapesJS made up; `generic`: a tag name. */
  note?: 'unstable' | 'generic';
}

const cssIdent = (s: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');

function count(doc: Document, sel: string): number {
  try {
    return doc.querySelectorAll(sel).length;
  } catch {
    return 0;
  }
}

/**
 * Selectors that match an element, best first: a `js-`/`data-` hook, own classes, a stable id,
 * attribute hooks, a class combination, the tag. Each with how many elements it matches.
 */
export function selectorCandidates(el: Element, doc: Document = el.ownerDocument): SelectorCandidate[] {
  const out: SelectorCandidate[] = [];
  const seen = new Set<string>();
  const add = (selector: string, note?: SelectorCandidate['note']) => {
    if (!selector || seen.has(selector)) return;
    const n = count(doc, selector);
    if (!n) return;
    seen.add(selector);
    out.push({ selector, count: n, ...(note ? { note } : {}) });
  };
  const classes = Array.from(el.classList).filter((c) => !EDITOR_CLASS.test(c));
  const hooks = classes.filter((c) => /^js-/.test(c));
  hooks.forEach((c) => add(`.${cssIdent(c)}`));
  for (const a of Array.from(el.attributes)) {
    if (/^data-(?!gjs)/.test(a.name) && a.name !== 'data-bp') add(a.value ? `[${a.name}="${a.value.replace(/"/g, '\\"')}"]` : `[${a.name}]`);
  }
  const id = el.getAttribute('id');
  if (id && !AUTO_ID.test(id)) add(`#${cssIdent(id)}`);
  classes.filter((c) => !hooks.includes(c)).forEach((c) => add(`.${cssIdent(c)}`));
  if (classes.length > 1) add(classes.map((c) => `.${cssIdent(c)}`).join(''));
  for (const name of ['name', 'role', 'aria-controls', 'href', 'type']) {
    const v = el.getAttribute(name);
    if (v && v.length < 60) add(`${el.tagName.toLowerCase()}[${name}="${v.replace(/"/g, '\\"')}"]`);
  }
  if (id && AUTO_ID.test(id)) add(`#${cssIdent(id)}`, 'unstable');
  add(el.tagName.toLowerCase(), 'generic');
  return out;
}

/** A class name for a "js-" hook from the element (text, tag). */
export function suggestHookClass(el: Element, taken: (cls: string) => boolean): string {
  const text = (el.textContent || el.getAttribute('aria-label') || el.tagName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const base = `js-${text || el.tagName.toLowerCase()}`;
  let name = base;
  let i = 2;
  while (taken(name)) name = `${base}-${i++}`;
  return name;
}

export interface PickOptions {
  /** Banner text. */
  message: string;
  /** Called with the hovered element (for a live preview); may be null. */
  onHover?: (el: Element | null) => void;
}

/**
 * Lets the user click an element in the GrapesJS canvas. Resolves to the element, or null on
 * Escape / right-click. GrapesJS does not see the click (no selection change).
 */
export function pickElement(editor: Editor, o: PickOptions): Promise<Element | null> {
  const doc = editor.Canvas.getDocument?.() as Document | undefined;
  if (!doc?.body) return Promise.resolve(null);
  return new Promise((resolve) => {
    const style = doc.createElement('style');
    style.setAttribute('data-gjs-scripts', 'pick');
    style.textContent = '[data-bp-pick]{outline:2px solid #ffb300 !important;outline-offset:1px;cursor:crosshair !important}*{cursor:crosshair !important}';
    doc.head.appendChild(style);
    const banner = document.createElement('div');
    banner.className = 'gjscr-pick-banner';
    banner.textContent = o.message;
    document.body.appendChild(banner);
    let hovered: Element | null = null;
    const mark = (el: Element | null) => {
      hovered?.removeAttribute('data-bp-pick');
      hovered = el && el !== doc.body && el !== doc.documentElement ? el : null;
      hovered?.setAttribute('data-bp-pick', '');
      o.onHover?.(hovered);
    };
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
    };
    const onMove = (e: Event) => {
      stop(e);
      mark(e.target as Element);
    };
    const onClick = (e: Event) => {
      stop(e);
      const el = (e as MouseEvent).button === 2 ? null : hovered || (e.target as Element);
      finish(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      stop(e);
      finish(null);
    };
    const swallow = (e: Event) => stop(e);
    const events: [EventTarget, string, EventListener][] = [
      [doc, 'mouseover', onMove],
      [doc, 'mousemove', onMove],
      [doc, 'mousedown', swallow],
      [doc, 'mouseup', swallow],
      [doc, 'pointerdown', swallow],
      [doc, 'click', onClick],
      [doc, 'contextmenu', onClick],
      [doc, 'keydown', onKey as EventListener],
      [document, 'keydown', onKey as EventListener],
    ];
    events.forEach(([t, n, f]) => t.addEventListener(n, f, true));
    const finish = (el: Element | null) => {
      events.forEach(([t, n, f]) => t.removeEventListener(n, f, true));
      mark(null);
      style.remove();
      banner.remove();
      resolve(el);
    };
  });
}

/** The GrapesJS component of a canvas element (walks up to the nearest one). */
export function componentOf(el: Element | null): any {
  let cur: any = el;
  while (cur) {
    const view = cur.__gjsv;
    if (view?.model) return view.model;
    cur = cur.parentElement;
  }
  return null;
}
