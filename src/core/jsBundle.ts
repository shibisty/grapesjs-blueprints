import type { Diagnostic } from 'blueprintsjs';
import { jsSyntaxError, type CodeItem } from './code';

/**
 * Hand-written JS as it goes into a page next to the compiled blueprints.
 *
 * Each item is a function body (so `return`, local `function`s and `var`s
 * stay its own) run once, at its time (`now` / `ready` / `load`), only when
 * `target.when` matches, inside a try/catch: one broken item does not stop
 * the others. An item that does not parse is left out — inside one file it
 * would stop every script of the page — and reported.
 */

export interface CodeDiagnostic extends Diagnostic {
  /** Id of the JS item. */
  codeId: string;
}

const lit = (v: unknown): string =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/** Items that parse, and the problems of those that do not. */
export function checkJs(items: CodeItem[]): { ok: CodeItem[]; diagnostics: CodeDiagnostic[] } {
  const ok: CodeItem[] = [];
  const diagnostics: CodeDiagnostic[] = [];
  for (const c of items) {
    const err = jsSyntaxError(c.code);
    if (err) diagnostics.push({ severity: 'error', code: 'js-syntax', message: err, args: [err], codeId: c.id } as CodeDiagnostic);
    else ok.push(c);
  }
  return { ok, diagnostics };
}

/** A name inside a block comment: cannot close the comment or a <script>. */
const commentText = (s: string): string => s.replace(/\*\//g, '* /').replace(/</g, '‹');

const body = (c: CodeItem): string => `function () {\n${c.code}\n}`;

/** Runtime of page items (ES5, no globals but `__gjscr*` inside the IIFE). */
const RUN_PAGE = `function __gjscrRun(o, fn) {
    function go() {
      if (o.when) {
        try { if (!document.querySelector(o.when)) return; } catch (e) { return; }
      }
      try { fn.call(window); } catch (e) { if (window.console) console.error('[script ' + o.name + ']', e); }
    }
    if (o.run === 'now') go();
    else if (o.run === 'load') { if (document.readyState === 'complete') go(); else window.addEventListener('load', go); }
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }`;

/** The page JS of the items: a self-running IIFE, or '' when there is nothing. */
export function pageJs(items: CodeItem[]): string {
  if (!items.length) return '';
  const calls = items.map((c) => `  /* ${commentText(c.name)} */\n  __gjscrRun(${lit({ name: c.name, run: c.run || 'ready', when: c.target?.when || null })}, ${body(c)});`);
  return `(function () {\n  ${RUN_PAGE}\n${calls.join('\n')}\n})();\n`;
}

/**
 * The same items for the canvas preview: an expression that evaluates to
 * `function start(document) → stop`. Everything runs at once (the page is
 * loaded); a function an item returns is its cleanup, called by stop.
 */
export function previewJs(items: CodeItem[]): string {
  const list = items.map((c) => `{ o: ${lit({ name: c.name, when: c.target?.when || null })}, fn: ${body(c)} }`);
  return `(function () {
  var items = [${list.join(',\n')}];
  return function start(doc) {
    var stops = [];
    items.forEach(function (it) {
      if (it.o.when) {
        try { if (!doc.querySelector(it.o.when)) return; } catch (e) { return; }
      }
      try {
        var r = it.fn.call(window);
        if (typeof r === 'function') stops.push(r);
      } catch (e) { if (window.console) console.error('[script ' + it.o.name + ']', e); }
    });
    return function () {
      stops.splice(0).forEach(function (s) { try { s(); } catch (e) {} });
    };
  };
})()`;
}

/**
 * A component's JS as `function (root, ctx) → cleanup`, like a compiled
 * component blueprint: the item's code runs with `root` (the instance
 * element, also `this`) and `params`; a function it returns is the cleanup.
 */
export function componentJs(c: CodeItem): string {
  return `function (root, ctx) {
  var params = (ctx && ctx.params) || {};
  var r;
  try {
    r = (function (root, params) {\n${c.code}\n}).call(root, root, params);
  } catch (e) { if (window.console) console.error('[script ' + ${lit(c.name)} + ']', e); }
  return typeof r === 'function' ? r : function () {};
}`;
}

/**
 * Joins the compiled blueprints (`blueprintScript`, from buildScript) and
 * the items' JS into one file for a page; `banner` stays on top.
 */
export function joinPageJs(blueprintScript: string | null, items: CodeItem[]): string {
  const own = pageJs(items);
  if (!blueprintScript) return own;
  if (!own) return blueprintScript;
  return `${blueprintScript.replace(/\s*$/, '')}\n\n${own}`;
}

/** Joins two preview starters (`start(doc) → stop`) into one. */
export function joinPreview(a: string, b: string): string {
  return `(function () {
  var a = (${a});
  var b = (${b});
  return function start(doc) {
    var sa = a(doc), sb = b(doc);
    return function () { try { sa(); } finally { sb(); } };
  };
})()`;
}
