import type { Editor } from 'grapesjs';
import { libraryTags } from '../core/libraries';
import { inlineSafe, processCode, type OutputTools } from '../core/output';
import type { ScriptsManager } from '../core/ScriptsManager';

export interface PageExport {
  pageId?: string;
  /** Script files to publish next to the page (file mode). */
  files: { name: string; code: string }[];
  /** `<link>`/`<script src>` tags of the CDN libraries. */
  libraries: string;
  /** Tags of the page script (inline code or `<script src>`). */
  scripts: string;
  /** Problems of the scripts and of the post-processing. */
  warnings: string[];
}

export interface SiteExport {
  files: { name: string; code: string }[];
  pages: Record<string, { libraries: string; scripts: string }>;
  warnings: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Page id of a component (the page whose main component contains it), or the selected page. */
export function pageIdOf(editor: Editor, component?: any): string | undefined {
  const Pages = (editor as any).Pages;
  if (!Pages) return undefined;
  try {
    if (component) {
      let root = component;
      while (root?.parent?.()) root = root.parent();
      const page = Pages.getAll().find((p: any) => p.getMainComponent?.() === root);
      if (page) return String(page.getId());
    }
    const sel = Pages.getSelected?.();
    return sel ? String(sel.getId()) : undefined;
  } catch {
    return undefined;
  }
}

/** File name for the script of one page: `scripts.js` → `scripts-<page>.js`. */
export function pageFileName(fileName: string, pageId: string): string {
  const safe = pageId.replace(/[^\w-]+/g, '-');
  return /\.js$/i.test(fileName) ? fileName.replace(/\.js$/i, `-${safe}.js`) : `${fileName}-${safe}.js`;
}

/**
 * Turns the scripts into what a page needs: files and tags. Minify/obfuscate are async, so the
 * processed code is cached; `editor.getHtml()` (sync) uses the cache and falls back to the
 * readable code until the processing is done (`refresh()` runs it after each change).
 */
export class ScriptsExporter {
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWarnings: string[] = [];

  constructor(
    private readonly editor: Editor,
    private readonly manager: ScriptsManager,
    private readonly tools: OutputTools,
  ) {}

  /** Raw (readable) code of the shared script and of a page's own script. */
  private raw(pageId?: string): { shared: string | null; page: string | null; warnings: string[] } {
    const shared = this.manager.build({ only: 'shared' });
    const page = pageId ? this.manager.build({ only: 'page', pageId }) : null;
    const warnings = [...shared.diagnostics, ...(page?.diagnostics || [])]
      .filter((d) => d.severity === 'error')
      .map((d) => `${this.manager.get(d.blueprintId)?.name || d.blueprintId}: ${d.message}`);
    return {
      shared: shared.blueprints.length ? shared.code : null,
      page: page && page.blueprints.length ? page.code : null,
      warnings,
    };
  }

  private key(code: string): string {
    const s = this.manager.settings;
    return `${s.minify ? 1 : 0}${s.obfuscate ? 1 : 0}|${code}`;
  }

  private needsProcessing(): boolean {
    const s = this.manager.settings;
    return s.minify || s.obfuscate;
  }

  private async process(code: string): Promise<string> {
    if (!this.needsProcessing()) return code;
    const k = this.key(code);
    const hit = this.cache.get(k);
    if (hit != null) return hit;
    let p = this.pending.get(k);
    if (!p) {
      p = processCode(code, this.manager.settings, this.tools).then((r) => {
        this.lastWarnings = r.warnings;
        if (this.cache.size > 30) this.cache.clear();
        this.cache.set(k, r.code);
        this.pending.delete(k);
        return r.code;
      });
      this.pending.set(k, p);
    }
    return p;
  }

  private processedSync(code: string): string {
    if (!this.needsProcessing()) return code;
    const hit = this.cache.get(this.key(code));
    if (hit == null) void this.process(code);
    return hit ?? code;
  }

  private assemble(pageId: string | undefined, shared: string | null, page: string | null, warnings: string[]): PageExport {
    const s = this.manager.settings;
    const out: PageExport = { pageId, files: [], libraries: libraryTags(this.manager.librariesFor(pageId)), scripts: '', warnings };
    const tags: string[] = [];
    if (s.output === 'inline') {
      for (const code of [shared, page]) if (code) tags.push(`<script>\n${inlineSafe(code.trim())}\n</script>`);
    } else {
      if (shared) {
        out.files.push({ name: s.fileName, code: shared });
        tags.push(`<script src="${esc(s.fileName)}" defer></script>`);
      }
      if (page && pageId) {
        const name = pageFileName(s.fileName, pageId);
        out.files.push({ name, code: page });
        tags.push(`<script src="${esc(name)}" defer></script>`);
      }
    }
    out.scripts = tags.join('\n');
    return out;
  }

  /** Everything one page needs, post-processed. */
  async exportPage(pageId: string | undefined = pageIdOf(this.editor)): Promise<PageExport> {
    const r = this.raw(pageId);
    const [shared, page] = await Promise.all([r.shared ? this.process(r.shared) : null, r.page ? this.process(r.page) : null]);
    return this.assemble(pageId, shared, page, [...r.warnings, ...this.lastWarnings]);
  }

  /** Same, synchronously: post-processed code if ready, the readable code otherwise. */
  exportPageSync(pageId: string | undefined = pageIdOf(this.editor)): PageExport {
    const r = this.raw(pageId);
    return this.assemble(pageId, r.shared ? this.processedSync(r.shared) : null, r.page ? this.processedSync(r.page) : null, r.warnings);
  }

  /** All pages: files (each once) and the tags of every page. */
  async exportSite(): Promise<SiteExport> {
    const pages = ((this.editor as any).Pages?.getAll?.() || []).map((p: any) => String(p.getId()));
    const ids: (string | undefined)[] = pages.length ? pages : [undefined];
    const files = new Map<string, string>();
    const out: SiteExport = { files: [], pages: {}, warnings: [] };
    for (const id of ids) {
      const e = await this.exportPage(id);
      e.files.forEach((f) => files.set(f.name, f.code));
      out.pages[id ?? ''] = { libraries: e.libraries, scripts: e.scripts };
      e.warnings.forEach((w) => !out.warnings.includes(w) && out.warnings.push(w));
    }
    out.files = Array.from(files, ([name, code]) => ({ name, code }));
    return out;
  }

  /** Re-run post-processing soon (after changes). */
  refreshSoon(delay = 400): void {
    if (!this.needsProcessing()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.exportPage().catch(() => undefined);
    }, delay);
  }

  /** Make `editor.getHtml()` include the tags (when `includeInHtml`). Returns the undo function. */
  wrapGetHtml(): () => void {
    const ed = this.editor as any;
    const original = ed.__gjscrGetHtml || ed.getHtml;
    ed.__gjscrGetHtml = original;
    ed.getHtml = (opts?: any) => {
      const html = original.call(ed, opts);
      if (!this.manager.settings.includeInHtml || typeof html !== 'string') return html;
      const e = this.exportPageSync(pageIdOf(this.editor, opts?.component));
      const tags = [e.libraries, e.scripts].filter(Boolean).join('\n');
      if (!tags) return html;
      const i = html.lastIndexOf('</body>');
      return i >= 0 ? `${html.slice(0, i)}${tags}\n${html.slice(i)}` : `${html}\n${tags}`;
    };
    return () => {
      if (ed.__gjscrGetHtml === original) {
        ed.getHtml = original;
        delete ed.__gjscrGetHtml;
      }
    };
  }
}
