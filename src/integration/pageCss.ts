import type { Editor } from 'grapesjs';
import { RULE_TAG, rulesToCss } from './cssItems';

type Rule = any;

/** Rules of grapesjs-site-pages' linked components (regenerated from the components). */
const COMPONENT_TAG = 'gjspc';

/**
 * The page's own GrapesJS styles as one CSS text, both ways: the text is
 * made from the CssComposer rules the Style Manager makes (not those of CSS
 * items, not those of linked components), and a new text replaces exactly
 * those rules. What is styled in one is what the other shows.
 */
export class PageCss {
  private applying = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void> = [];

  constructor(private readonly editor: Editor) {
    const all = (editor.Css as any).getAll();
    const changed = (): void => {
      if (this.applying) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.listeners.forEach((fn) => fn()), 120);
    };
    all.on('add remove reset change', changed);
    this.offs.push(() => all.off('add remove reset change', changed));
    // Another page / project: other rules.
    editor.on('load pages-manager:open', changed);
    this.offs.push(() => editor.off('load pages-manager:open', changed));
  }

  /** The page's own rules (with styles), in CssComposer order. */
  rules(): Rule[] {
    const all = (this.editor.Css as any).getAll();
    return all.filter((r: Rule) => !r.get(RULE_TAG) && !r.get(COMPONENT_TAG) && Object.keys(r.getStyle?.() || r.get('style') || {}).length > 0);
  }

  text(): string {
    return rulesToCss(this.rules());
  }

  count(): number {
    return this.rules().length;
  }

  /** Replaces the page's own rules with those of `code` (one undo step). */
  setText(code: string): void {
    const css = this.editor.Css as any;
    const all = css.getAll();
    let defs: any[] = [];
    try {
      defs = ((this.editor as any).Parser.parseCss(code) || []) as any[];
    } catch {
      return; // half typed: wait for more
    }
    const current = this.rules();
    if (rulesToCss(current) === code) return;
    this.applying = true;
    try {
      // Empty rules the Style Manager made for a selection stay (they hold no styles).
      all.remove(current);
      if (defs.length) all.add(JSON.parse(JSON.stringify(defs)));
      this.editor.trigger('scripts:page-css', { count: defs.length });
    } finally {
      this.applying = false;
    }
  }

  /** Called a moment after the page's rules changed (the Style Manager, another page). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.offs.splice(0).forEach((f) => f());
    this.listeners.clear();
  }
}
