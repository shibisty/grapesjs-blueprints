import type { Editor } from 'grapesjs';
import type { ScriptsManager } from '../core/ScriptsManager';
import { targets, type CodeItem, type PageScope } from '../core/code';
import { componentInstances } from './components';

/**
 * CSS items as GrapesJS rules (CssComposer).
 *
 * The item's text is the source. Its rules are put into the canvas'
 * CssComposer, marked with `gjscr: <item id>`, so they style the canvas,
 * show in the Style Manager and go out with the page CSS
 * (`editor.getCss()`, a grapesjs-site-pages publish) like any other rule.
 *
 * - Never stored twice: the marked rules are taken out of the project data
 *   (`editor.Css.store` is wrapped), so neither the project nor a page of
 *   grapesjs-site-pages keeps a copy — the item does.
 * - Added as rules of their own, never merged into a rule of the page with
 *   the same selector (`addCollection` would), first in the list: rules made
 *   in the Style Manager come later and win.
 * - The Style Manager (and `getRule`/`setRule`) works on the page's own rule
 *   when there is one with styles for the same selector; on ours otherwise
 *   (`editor.Css.get` is wrapped to prefer unmarked rules).
 * - Which items: global ones, the page's template ones (with
 *   grapesjs-site-pages: its page, layout or template), and component ones
 *   whose component is on the page.
 * - An edit of a marked rule in the Style Manager rewrites the item's text
 *   from its rules (formatting and comments of that item are not kept).
 * - Out of the undo history: putting the rules in is not an edit.
 */

export const RULE_TAG = 'gjscr';

type Rule = any;

const sigOf = (c: CodeItem): string => `${c.id}\u0000${c.code}`;

/** One rule as readable CSS: `selector {` + declarations + `}`. */
function ruleBlock(r: Rule, indent: string): string {
  const style = (r.getStyle?.() || r.get('style') || {}) as Record<string, string>;
  const important = r.get('important');
  const lines = Object.entries(style)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${indent}  ${k}: ${v}${important === true || (Array.isArray(important) && important.includes(k)) ? ' !important' : ''};`);
  const sel = r.get('singleAtRule') ? r.getAtRule() : r.selectorsToString();
  return `${indent}${sel} {\n${lines.join('\n')}\n${indent}}`;
}

/** Rules back to CSS text, at-rules grouped (`@media`, `@keyframes`…). */
export function rulesToCss(rules: Rule[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < rules.length) {
    const r = rules[i];
    const at = r.get('singleAtRule') ? '' : r.getAtRule();
    if (!at) {
      out.push(ruleBlock(r, ''));
      i++;
      continue;
    }
    const group: Rule[] = [];
    while (i < rules.length && !rules[i].get('singleAtRule') && rules[i].getAtRule() === at) group.push(rules[i++]);
    out.push(`${at} {\n${group.map((g) => ruleBlock(g, '  ')).join('\n')}\n}`);
  }
  return out.length ? `${out.join('\n\n')}\n` : '';
}

export class CssItems {
  /** Applied items: id → signature and how many rules they made. */
  private applied = new Map<string, { sig: string; count: number }>();
  private order: string[] = [];
  private applying = false;
  private queued = false;
  private readonly regen = new Set<string>();
  private regenTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly parsed = new Map<string, any[]>();
  private restoreStore: (() => void) | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly manager: ScriptsManager,
    private readonly scopeOf: () => PageScope | undefined,
    /** More CSS to apply like items (the static CSS of the blueprints). */
    private readonly extra: () => CodeItem[] = () => [],
  ) {
    this.wrapStore();
    const on = (ev: string, fn: (...a: any[]) => void) => {
      editor.on(ev, fn);
      this.offs.push(() => editor.off(ev, fn));
    };
    const soon = () => this.applySoon();
    on('scripts:code scripts:change', soon);
    // Another page: its template items (and its components) apply.
    on('page pages-manager:open load', soon);
    // Component CSS, and unique CSS with "component is / is not" conditions, follow what is on the page.
    const byComponent = () =>
      this.manager.listCode('css', 'component').length > 0 ||
      this.manager.listCode('css', 'template').some((c) => (c.target?.pages || []).some((r) => r.replace(/^!/, '').startsWith('component:')));
    on('component:add component:remove', () => byComponent() && this.applySoon());
    const rules = (editor.Css as any).getAll();
    const onStyle = (rule: Rule) => this.ruleEdited(rule);
    rules.on('change:style', onStyle);
    this.offs.push(() => rules.off('change:style', onStyle));
  }

  /**
   * The project data never keeps the marked rules (the items do); a lookup
   * of a rule (Style Manager, getRule, setRule) prefers the page's own.
   */
  private wrapStore(): void {
    const css = this.editor.Css as any;
    const origStore = css.store;
    const origGet = css.get;
    if (typeof origStore === 'function') {
      css.store = function (this: unknown, ...a: unknown[]) {
        const r = origStore.apply(this, a);
        // GrapesJS gives the collection itself (serialized later), or plain rule objects.
        const st = r?.styles;
        if (st && typeof st.filter === 'function') r.styles = st.filter((s: any) => !(typeof s?.get === 'function' ? s.get(RULE_TAG) : s?.[RULE_TAG]));
        return r;
      };
    }
    if (typeof origGet === 'function') {
      css.get = function (this: any, ...a: unknown[]) {
        const found = origGet.apply(this, a);
        if (!found?.get?.(RULE_TAG)) return found;
        // The same lookup over the page's own rules. Empty ones do not count:
        // the Style Manager makes an empty rule just by selecting a component.
        const ctx = Object.create(this);
        ctx.rules = this.rules.filter((r: Rule) => !r.get(RULE_TAG) && Object.keys(r.getStyle?.() || {}).length > 0);
        return origGet.apply(ctx, a) || found;
      };
    }
    this.restoreStore = () => {
      if (origStore) css.store = origStore;
      if (origGet) css.get = origGet;
    };
  }

  /** Parsed rule definitions of a CSS text (cached). */
  private parse(code: string): any[] {
    let defs = this.parsed.get(code);
    if (!defs) {
      try {
        defs = ((this.editor as any).Parser.parseCss(code) || []) as any[];
      } catch {
        defs = [];
      }
      if (this.parsed.size > 100) this.parsed.clear();
      this.parsed.set(code, defs);
    }
    return defs;
  }

  /** How many rules an item's CSS makes. */
  ruleCount(code: string): number {
    return this.parse(code).length;
  }

  /** The CSS items that apply to the page shown, in order: global, the page's, components on it. */
  wanted(): CodeItem[] {
    const scope = this.scopeOf();
    const all = [...this.manager.listCode('css').filter((c) => c.enabled), ...this.extra()];
    const used = (type?: string) => !!type && componentInstances(this.editor, type).length > 0;
    return [
      ...all.filter((c) => c.kind === 'global'),
      ...all.filter((c) => c.kind === 'template' && (!c.target?.pages?.length || targets(c.target.pages, scope))),
      ...all.filter((c) => c.kind === 'component' && used(c.target?.componentType)),
    ];
  }

  applySoon(): void {
    if (this.queued) return;
    this.queued = true;
    // After the current load (GrapesJS clears and reloads every module in one go).
    queueMicrotask(() => {
      this.queued = false;
      this.apply();
    });
  }

  /** Puts the rules of the wanted items into the canvas (only when something differs). */
  apply(): void {
    const css = this.editor.Css as any;
    const all = css?.getAll?.();
    if (!all) return;
    const want = this.wanted();
    const counts = new Map<string, number>();
    all.forEach((r: Rule) => {
      const id = r.get(RULE_TAG);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
    const same =
      want.length === this.order.length &&
      want.every((c, i) => this.order[i] === c.id && this.applied.get(c.id)?.sig === sigOf(c) && (counts.get(c.id) || 0) === this.applied.get(c.id)!.count) &&
      Array.from(counts.keys()).every((id) => this.applied.has(id));
    if (same) return;
    this.applying = true;
    try {
      const run = () => {
        all.remove(all.filter((r: Rule) => r.get(RULE_TAG)));
        this.applied.clear();
        const defs: any[] = [];
        for (const c of want) {
          const d = this.parse(c.code).map((x) => ({ ...JSON.parse(JSON.stringify(x)), [RULE_TAG]: c.id }));
          this.applied.set(c.id, { sig: sigOf(c), count: d.length });
          defs.push(...d);
        }
        if (defs.length) all.add(defs, { at: 0 });
        this.order = want.map((c) => c.id);
      };
      const um = (this.editor as any).UndoManager;
      if (um?.skip) um.skip(run);
      else run();
    } finally {
      this.applying = false;
    }
  }

  /** A marked rule changed (the Style Manager): its item's text follows, a moment later. */
  private ruleEdited(rule: Rule): void {
    if (this.applying) return;
    const id = rule?.get?.(RULE_TAG);
    if (!id) return;
    this.regen.add(id);
    if (this.regenTimer) clearTimeout(this.regenTimer);
    this.regenTimer = setTimeout(() => this.flushEdits(), 150);
  }

  /** Writes the texts of edited items now. */
  flushEdits(): void {
    if (this.regenTimer) clearTimeout(this.regenTimer);
    this.regenTimer = null;
    const all = (this.editor.Css as any).getAll();
    for (const id of Array.from(this.regen)) {
      this.regen.delete(id);
      const item = this.manager.getCode(id);
      if (!item) continue;
      const rules = all.filter((r: Rule) => r.get(RULE_TAG) === id);
      const code = rulesToCss(rules);
      // The rules are the change: keep them (no re-apply) and just record the text.
      this.applied.set(id, { sig: sigOf({ ...item, code }), count: rules.length });
      this.manager.updateCode(id, { code });
    }
  }

  destroy(): void {
    this.flushEdits();
    this.offs.splice(0).forEach((f) => f());
    this.restoreStore?.();
    this.restoreStore = null;
    try {
      const all = (this.editor.Css as any).getAll();
      const um = (this.editor as any).UndoManager;
      const run = () => all.remove(all.filter((r: Rule) => r.get(RULE_TAG)));
      if (um?.skip) um.skip(run);
      else run();
    } catch {
      /* editor gone */
    }
  }
}
