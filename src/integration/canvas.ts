import type { Editor } from 'grapesjs';
import { buildStandalone, type NodeRegistry } from '../blueprint';
import type { Library } from '../core/libraries';
import type { ScriptsManager } from '../core/ScriptsManager';
import { componentInstances } from './components';
import { pageIdOf } from './export';

export const CANVAS_ATTR = 'data-gjs-scripts';

/** Loads library files into a frame document; resolves when the JS files have run. */
export function loadIntoFrame(doc: Document, libs: Library[], { js = true, css = true } = {}): Promise<void> {
  const head = doc.head;
  const present = new Set(Array.from(head.querySelectorAll(`[${CANVAS_ATTR}]`)).map((el) => el.getAttribute('src') || el.getAttribute('href')));
  if (css) {
    for (const lib of libs) {
      for (const f of lib.files) {
        if (f.type !== 'css' || present.has(f.url)) continue;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = f.url;
        link.setAttribute(CANVAS_ATTR, 'lib');
        head.appendChild(link);
        present.add(f.url);
      }
    }
  }
  if (!js) return Promise.resolve();
  // JS files one after another (a plugin needs its library first).
  const files = libs.flatMap((l) => l.files.filter((f) => f.type === 'js').map((f) => ({ f, module: l.load === 'module' })));
  return files.reduce<Promise<void>>(
    (prev, { f, module }) =>
      prev.then(
        () =>
          new Promise<void>((resolve) => {
            if (present.has(f.url)) return resolve();
            const s = doc.createElement('script');
            if (module) s.type = 'module';
            s.src = f.url;
            s.setAttribute(CANVAS_ATTR, 'lib');
            s.onload = s.onerror = () => resolve();
            head.appendChild(s);
            present.add(f.url);
          }),
      ),
    Promise.resolve(),
  );
}

/** Removes library CSS links that are no longer wanted from a frame. */
export function syncCanvasCss(doc: Document | null | undefined, libs: Library[]): void {
  if (!doc?.head) return;
  const wanted = new Set(libs.flatMap((l) => l.files.filter((f) => f.type === 'css').map((f) => f.url)));
  doc.head.querySelectorAll<HTMLLinkElement>(`link[${CANVAS_ATTR}]`).forEach((l) => !wanted.has(l.getAttribute('href') || '') && l.remove());
  void loadIntoFrame(doc, libs, { js: false });
}

/**
 * Scripts in the canvas: never while editing (a click must select, not open a popup), only in
 * the GrapesJS preview. Leaving the preview stops them and re-renders the page from its
 * components, so nothing the scripts changed stays behind.
 */
export class CanvasRunner {
  private stops: (() => void)[] = [];
  private running = false;

  constructor(
    private readonly editor: Editor,
    private readonly manager: ScriptsManager,
    private readonly registry: NodeRegistry,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  private frame(): { doc: Document; win: Window & Record<string, any> } | null {
    const doc = this.editor.Canvas.getDocument?.() as Document | undefined;
    const win = this.editor.Canvas.getWindow?.() as (Window & Record<string, any>) | undefined;
    return doc && win ? { doc, win } : null;
  }

  /** Library CSS (and JS marked `inCanvas`) for editing. */
  syncLibraries(): void {
    const f = this.frame();
    if (!f) return;
    const libs = this.manager.librariesFor(pageIdOf(this.editor));
    syncCanvasCss(f.doc, libs);
    const always = libs.filter((l) => l.inCanvas);
    if (always.length) void loadIntoFrame(f.doc, always, { css: false });
  }

  /** Evaluates code inside the frame (so the scripts use the frame's window and document). */
  private evalInFrame(f: { doc: Document; win: Window & Record<string, any> }, code: string): void {
    const s = f.doc.createElement('script');
    s.setAttribute(CANVAS_ATTR, 'run');
    s.textContent = code;
    f.doc.body.appendChild(s);
    s.remove();
  }

  async start(): Promise<void> {
    if (this.running) return;
    const f = this.frame();
    if (!f) return;
    this.running = true;
    const pageId = pageIdOf(this.editor);
    await loadIntoFrame(f.doc, this.manager.librariesFor(pageId));
    if (!this.running) return; // stopped while loading
    const page = this.manager.build({ target: 'preview', pageId });
    const fns = this.manager
      .list('component')
      .filter((b) => b.enabled && b.component?.type)
      .map((b) => `${JSON.stringify(b.component!.type)}: ${buildStandalone(b, this.registry, { comments: false }).code}`);
    f.win.__bpPreview = null;
    this.evalInFrame(f, `window.__bpPreview = { page: ${page.code}, components: { ${fns.join(',\n')} } };`);
    const api = f.win.__bpPreview as { page: (d: Document) => () => void; components: Record<string, (el: Element, ctx: unknown) => () => void> } | null;
    if (!api) {
      this.running = false;
      return;
    }
    try {
      this.stops.push(api.page(f.doc));
    } catch (e) {
      console.error('[grapesjs-scripts] preview', e);
    }
    for (const [type, run] of Object.entries(api.components)) {
      for (const m of componentInstances(this.editor, type)) {
        const el = m.getEl?.();
        if (!el) continue;
        try {
          const params = typeof m.__getScriptProps === 'function' ? m.__getScriptProps() : {};
          this.stops.push(run(el, { params }));
        } catch (e) {
          console.error('[grapesjs-scripts] preview', type, e);
        }
      }
    }
    this.editor.trigger('scripts:preview', { running: true });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stops.splice(0).forEach((s) => {
      try {
        if (typeof s === 'function') s();
      } catch {
        /* ignore */
      }
    });
    // Whatever the scripts changed in the DOM (classes, text, styles) goes back to the model state.
    try {
      const wrapper = this.editor.getWrapper() as any;
      wrapper?.view?.render?.();
      this.editor.refresh?.();
    } catch {
      /* ignore */
    }
    this.editor.trigger('scripts:preview', { running: false });
  }
}
