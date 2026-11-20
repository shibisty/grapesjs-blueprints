import type { Editor } from 'grapesjs';
import type { PageScope } from '../core/code';

/**
 * grapesjs-site-pages (grapesjs-pages 2.7+) integration, without a
 * dependency on it: only the parts of `editor.PagesManager` used here are
 * typed. Every record of pages is a whole GrapesJS project, so our
 * storable key would be copied into every page; registered as a shared key
 * it is kept once per site (local: the store's meta; remote: the site
 * record) and given to whatever record is opened.
 */
export interface PagesLike {
  shared?: {
    register(key: string): Promise<void>;
    keys(): string[];
  };
  hooks?: {
    onLoad(fn: (data: any, rec: any) => any): () => void;
    onSave(fn: (data: any, rec: any) => any): () => void;
    onPublish(fn: (out: { html: string; css: string; record: any; kind: string }) => any): () => void;
  };
  list?(): Promise<Array<{ id: string; name: string; kind?: string; deleted?: boolean; templateId?: string | null; layoutId?: string | null }>>;
  getActiveId?(): string | null;
  /** Linked components (grapesjs-site-pages 2.7+ for `addSource`). */
  components?: {
    list(): Array<{ id: string; name: string }>;
    addSource?(source: {
      id: string;
      label: string;
      list(): Array<{ id: string; name: string }>;
      build(itemId: string): unknown;
    }): () => void;
  };
}

/** A linked component of grapesjs-site-pages, as a component definition. */
export const PAGES_COMPONENT_TYPE = 'gjsp-component';
export const PAGES_COMPONENT_ATTR = 'data-gjsp-component';
export const pagesComponentDef = (id: string): Record<string, unknown> => ({
  type: PAGES_COMPONENT_TYPE,
  attributes: { [PAGES_COMPONENT_ATTR]: id },
});

/** The linked components grapesjs-site-pages has (none without it). */
export function pagesComponents(editor: Editor): Array<{ id: string; name: string }> {
  try {
    const list = pagesOf(editor)?.components?.list?.() || [];
    return list.map((m) => ({ id: m.id, name: m.name }));
  } catch {
    return [];
  }
}

export const pagesOf = (editor: Editor): PagesLike | null => ((editor as any).PagesManager as PagesLike) || null;

/** Does this pages version keep shared keys? (older ones copy them per page) */
export const canShare = (p: PagesLike | null): p is PagesLike & Required<Pick<PagesLike, 'shared'>> =>
  !!p?.shared && typeof p.shared.register === 'function';

/**
 * Registers our storable key as shared as soon as pages is there: now, or
 * when the editor is ready (pages may be listed after this plugin).
 * Returns whether it was registered (for tests and diagnostics).
 */
export function shareWithPages(editor: Editor, key: string, report: (e: unknown) => void): () => boolean {
  let done = false;
  const tryNow = (): boolean => {
    if (done) return true;
    const p = pagesOf(editor);
    if (!canShare(p)) return false;
    done = true;
    p.shared.register(key).catch(report);
    return true;
  };
  if (!tryNow()) editor.onReady(() => tryNow());
  return () => done;
}

/** Record fields the scope needs (what `pages-manager:open` sends). */
interface RecordLike {
  id: string;
  kind?: string;
  layoutId?: string | null;
  templateId?: string | null;
}

/**
 * The page the editor shows, for picking the template items that apply:
 * with grapesjs-site-pages the open record (and its layout and template),
 * otherwise the selected `editor.Pages` page. Kept from the
 * `pages-manager:open` / `pages-manager:detach` events, so it is
 * synchronous (`editor.getHtml()` needs it).
 */
/** A place a template item can target. */
export interface TargetChoice {
  id: string;
  name: string;
  /** `page` also for `editor.Pages` pages (without grapesjs-site-pages). */
  group: 'page' | 'layout' | 'template' | 'component';
}

export class ScopeTracker {
  private rec: RecordLike | null = null;
  private readonly offs: Array<() => void> = [];
  private recs: TargetChoice[] = [];
  private loading = false;
  private again = false;

  constructor(private readonly editor: Editor) {
    const on = (ev: string, fn: (...a: any[]) => void) => {
      editor.on(ev, fn);
      this.offs.push(() => editor.off(ev, fn));
    };
    on('pages-manager:open', (r: RecordLike) => {
      this.rec = r && typeof r.id === 'string' ? { id: r.id, kind: r.kind, layoutId: r.layoutId ?? null, templateId: r.templateId ?? null } : null;
    });
    on('pages-manager:detach', () => (this.rec = null));
    // The records change (created, renamed, deleted, synced): read the list again.
    on('pages-manager:change', () => void this.refresh());
    on('pages-manager:ready', () => void this.refresh());
    void this.refresh();
  }

  /** Reads the pages, layouts and templates of grapesjs-site-pages (entries and components left out). */
  async refresh(): Promise<void> {
    const pm = pagesOf(this.editor);
    if (!pm?.list) return;
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    try {
      const list = await pm.list();
      const groups = new Set(['page', 'layout', 'template', 'component']);
      const next = list
        .filter((r) => !r.deleted && !r.templateId && groups.has(r.kind || 'page'))
        .map((r) => ({ id: r.id, name: r.name, group: (r.kind || 'page') as TargetChoice['group'] }));
      if (JSON.stringify(next) !== JSON.stringify(this.recs)) {
        this.recs = next;
        this.editor.trigger('scripts:targets', this.choices());
      }
    } catch {
      /* pages not ready yet: the next change event reads again */
    } finally {
      this.loading = false;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    }
  }

  /**
   * What a template item can target: with grapesjs-site-pages its pages,
   * layouts and templates; otherwise the `editor.Pages` pages. Synchronous
   * (a cached copy of the records).
   */
  choices(): TargetChoice[] {
    if (this.withPages) return this.recs.map((c) => ({ ...c }));
    try {
      const all = ((this.editor as any).Pages?.getAll?.() || []) as any[];
      return all.map((p, i) => ({ id: String(p.getId?.() ?? p.id), name: String(p.getName?.() || p.get?.('name') || p.id || `#${i + 1}`), group: 'page' as const }));
    } catch {
      return [];
    }
  }

  /** Is grapesjs-site-pages managing the pages? */
  get withPages(): boolean {
    return !!pagesOf(this.editor);
  }

  /** The open record (grapesjs-site-pages), if any. */
  get record(): RecordLike | null {
    return this.rec ? { ...this.rec } : null;
  }

  /** The page as a scope; `pageId` (an `editor.Pages` id) when given wins. */
  scope(pageId?: string): PageScope | undefined {
    if (pageId) return { id: pageId };
    if (this.rec) {
      const s: PageScope = { id: this.rec.id, layoutId: this.rec.layoutId, templateId: this.rec.templateId, components: this.usedComponents() };
      if (this.rec.kind === 'component') s.kind = 'component';
      return s;
    }
    if (this.withPages) return undefined;
    const p = (this.editor as any).Pages?.getSelected?.();
    const id = p?.getId?.() ?? p?.id;
    return id ? { id: String(id) } : undefined;
  }

  /** Linked components (grapesjs-site-pages) inserted in the open record. */
  usedComponents(): string[] {
    const ids = new Set<string>();
    try {
      (this.editor.getWrapper()?.find(`[${PAGES_COMPONENT_ATTR}]`) || []).forEach((c: any) => {
        const id = c.getAttributes?.()[PAGES_COMPONENT_ATTR];
        if (id) ids.add(String(id));
      });
    } catch {
      /* no wrapper yet */
    }
    return [...ids];
  }

  destroy(): void {
    this.offs.splice(0).forEach((f) => f());
  }
}
