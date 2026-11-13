import type { Editor } from 'grapesjs';
import { createRegistry, diagnosticText, type GraphEditor, type Blueprint, type BlueprintKind, type BuildResult, type NodeDef, type NodeRegistry } from './blueprint';
import { ScriptsManager, type BuildPageOptions, type CreateScriptInit, type ScriptsSettings } from './core/ScriptsManager';
import { COMMANDS, EVENTS } from './events';
import { createTranslator, registerMessages, type Translator } from './i18n';
import { resolveOptions, type ScriptsPluginOptions } from './options';
import { h, icon, iconHtml } from './ui/dom';
import { findHostPanel, findSidebarHost } from './ui/host';
import { cdnTools } from './core/output';
import { CanvasRunner } from './integration/canvas';
import { ComponentBlueprints } from './integration/components';
import { ScriptsExporter, type PageExport, type SiteExport } from './integration/export';
import type { Library } from './core/libraries';
import { openGraphEditor, graphText } from './ui/graph';
import { currentWorkspace, docId as blueprintDocId, DOC_PREFIX as BLUEPRINT_DOC_PREFIX, onWorkspace, revealCanvas, type WorkspaceLike } from './integration/workspace';
import { openLibraryDialog } from './ui/libraries';
import { openCodeDialog, openCreateDialog } from './ui/modals';
import { openSettingsDialog } from './ui/settings';
import { Sidebar } from './ui/Sidebar';
import { injectCss } from './ui/styles';

export const PANEL_BUTTON_ID = 'scripts';

/** Public API, also available as `editor.Scripts`. */
export interface ScriptsApi {
  list(kind?: BlueprintKind): Blueprint[];
  get(id: string): Blueprint | undefined;
  create(init?: CreateScriptInit): Blueprint;
  update(id: string, patch: Partial<Blueprint> | ((bp: Blueprint) => Blueprint)): Blueprint;
  rename(id: string, name: string): Blueprint;
  setEnabled(id: string, enabled: boolean): Blueprint;
  duplicate(id: string): Blueprint;
  remove(id: string): boolean;
  /** The page script (global + template scripts for `pageId`). */
  build(options?: BuildPageOptions): BuildResult;
  /** JavaScript of one script (for viewing). */
  codeOf(id: string): string;
  getSettings(): ScriptsSettings;
  setSettings(patch: Partial<ScriptsSettings>): ScriptsSettings;
  /** Add (or replace) a node type. */
  addNode(def: NodeDef): void;
  /** Open the sidebar / new-script dialog / code view / editor. */
  open(): void;
  openCreate(kind?: BlueprintKind): Promise<Blueprint | null>;
  openCode(id?: string): void;
  edit(id: string): GraphEditor | null;
  /** The open blueprint editor, if any. */
  getGraphEditor(): GraphEditor | null;
  /** CDN libraries of the project. */
  libraries(): Library[];
  addLibrary(init: Partial<Library>): Library;
  updateLibrary(id: string, patch: Partial<Library>): Library;
  removeLibrary(id: string): boolean;
  /** What a page needs: files and tags (minified/obfuscated as set). */
  exportPage(pageId?: string): Promise<PageExport>;
  /** Every page: files once, tags per page. */
  exportSite(): Promise<SiteExport>;
  /** Start / stop the scripts in the canvas (normally done by the GrapesJS preview). */
  startPreview(): Promise<void>;
  stopPreview(): void;
  openSettings(): void;
  openLibraryDialog(): Promise<Library | null>;
  /** Text lookup used by the graph editor (current editor language). */
  graphText(): ReturnType<typeof graphText>;
  readonly registry: NodeRegistry;
  readonly manager: ScriptsManager;
}

type EditorWithScripts = Editor & { Scripts?: ScriptsApi; __gjscrCleanup?: () => void };

export function getScripts(editor: Editor): ScriptsApi | undefined {
  return (editor as EditorWithScripts).Scripts;
}

const isAlive = (editor: Editor) => {
  try {
    return !!(editor as any).getModel?.() && !!editor.getContainer?.();
  } catch {
    return false;
  }
};

/**
 * grapesjs-scripts: a "Scripts" view next to Layers/Styles. Scripts are blueprints (node graphs)
 * stored in the project data and compiled to plain JavaScript.
 */
export default function scriptsPlugin(editor: Editor, userOpts: ScriptsPluginOptions = {}): void {
  const ed = editor as EditorWithScripts;
  ed.__gjscrCleanup?.();

  const opts = resolveOptions(userOpts);
  registerMessages(editor);
  const t: Translator = createTranslator(editor, opts.labels);
  const registry = createRegistry(opts.nodes);
  const em: any = (editor as any).getModel?.();

  const manager = new ScriptsManager(registry, {
    defaultName: () => t('defaultName'),
    copySuffix: () => t('copySuffix'),
    onChange: (type, bp) => {
      if (!isAlive(editor)) return;
      if (type !== 'load') em?.changesUp?.({});
      if (type === 'add') editor.trigger(EVENTS.add, bp);
      if (type === 'update') editor.trigger(EVENTS.update, bp);
      if (type === 'remove') editor.trigger(EVENTS.remove, bp);
      if (type === 'settings') editor.trigger(EVENTS.settings, manager.settings);
      if (type === 'libraries' || type === 'load') runner?.syncLibraries();
      if (type !== 'settings' && type !== 'libraries') components?.sync();
      exporter?.refreshSoon();
      editor.trigger(EVENTS.change, { type, id: bp?.id });
    },
  });
  // eslint-disable-next-line prefer-const
  let runner: CanvasRunner | undefined;
  // eslint-disable-next-line prefer-const
  let components: ComponentBlueprints | undefined;
  // eslint-disable-next-line prefer-const
  let exporter: ScriptsExporter | undefined;

  // Project data: getProjectData / loadProjectData / the Storage Manager.
  const storables: any[] | undefined = em?.storables || em?.get?.('storables');
  const storable = {
    name: 'ScriptsPlugin',
    storageKey: opts.storageKey,
    store: () => ({ [opts.storageKey]: manager.toJSON() }),
    load: (data: Record<string, unknown>) => manager.load(data?.[opts.storageKey]),
    clear: () => manager.clear(),
  };
  if (Array.isArray(storables)) {
    const old = storables.findIndex((s) => s?.name === storable.name);
    if (old >= 0) storables.splice(old, 1);
    // First: component scripts register their GrapesJS types before the pages are parsed.
    storables.unshift(storable);
  } else {
    console.warn('[grapesjs-scripts] Editor storables not found: scripts will not be saved with the project.');
  }

  runner = new CanvasRunner(editor, manager, registry);
  components = new ComponentBlueprints(editor, manager, registry, () => opts.blocksCategory || t('blocksCategory'));
  exporter = new ScriptsExporter(editor, manager, opts.output.tools || cdnTools(opts.output.urls));
  const http = { fetch: opts.libraries.fetch || ((u: string, i?: RequestInit) => fetch(u, i)), proxy: opts.libraries.proxy ?? false, timeout: opts.libraries.timeout };

  let sidebar: Sidebar | null = null;
  let toggleBtn: HTMLButtonElement | null = null;
  let wantOpen = false;
  let reopenAfterPreview = false;
  let disposed = false;
  const offs: (() => void)[] = [];
  const on = (ev: string, fn: (...a: any[]) => void) => {
    editor.on(ev, fn);
    offs.push(() => editor.off(ev, fn));
  };

  /* ----------------------------------------------------------- actions */

  const openCreate = async (kind?: BlueprintKind): Promise<Blueprint | null> => {
    const init = await openCreateDialog(editor, manager, t, { kind });
    if (!init) return null;
    const bp = manager.create(init);
    editor.runCommand(COMMANDS.edit, { id: bp.id });
    return bp;
  };

  const openCode = (id?: string) => {
    if (id) {
      const bp = manager.get(id);
      if (!bp) return;
      const { code, diagnostics } = manager.codeOf(id);
      const gt = graphText(editor, opts.graphLabels);
      const names = new Map(bp.nodes.map((n) => [n.id, gt(`node.${n.type}`, registry.get(n.type)?.title || n.type)]));
      const translated = diagnostics.map((d) => ({ ...d, message: diagnosticText(gt, d) }));
      openCodeDialog(editor, t, { title: t('codeOf', bp.name), code, diagnostics: translated, fileName: `${fileSafe(bp.name)}.js`, names });
    } else {
      const res = manager.build();
      // Problems of every script, prefixed with its name.
      const diagnostics = manager
        .list()
        .filter((b) => b.kind !== 'component' && b.enabled)
        .flatMap((b) => manager.diagnostics(b.id).map((d) => ({ ...d, nodeId: undefined, message: `${b.name}: ${diagnosticText(graphText(editor, opts.graphLabels), d)}` })));
      openCodeDialog(editor, t, { title: t('allScripts'), code: res.code, diagnostics, fileName: manager.settings.fileName });
    }
  };

  const rename = (id: string) => {
    const bp = manager.get(id);
    if (!bp) return;
    const name = window.prompt(t('promptName'), bp.name);
    if (name != null && name.trim()) manager.rename(id, name);
  };

  const remove = (id: string) => {
    const bp = manager.get(id);
    if (!bp) return;
    if (window.confirm(t('confirmRemove', bp.name))) manager.remove(id);
  };

  const addLibraryDialog = () => openLibraryDialog(editor, manager, t, http);
  const openSettings = () =>
    openSettingsDialog(editor, manager, t, exporter!, () => {
      void addLibraryDialog().then(() => openSettings());
    });

  const api: ScriptsApi = {
    list: (k) => manager.list(k),
    get: (id) => manager.get(id),
    create: (init) => manager.create(init),
    update: (id, p) => manager.update(id, p),
    rename: (id, n) => manager.rename(id, n),
    setEnabled: (id, v) => manager.setEnabled(id, v),
    duplicate: (id) => manager.duplicate(id),
    remove: (id) => manager.remove(id),
    build: (o) => manager.build(o),
    codeOf: (id) => manager.codeOf(id).code,
    getSettings: () => manager.settings,
    setSettings: (p) => manager.setSettings(p),
    addNode: (def) => {
      registry.add(def);
      sidebar?.renderSoon();
    },
    open: () => editor.runCommand(COMMANDS.open),
    openCreate,
    openCode,
    edit: (id) => editor.runCommand(COMMANDS.edit, { id }) || null,
    getGraphEditor: () => graph,
    libraries: () => manager.libraries(),
    addLibrary: (i) => manager.addLibrary(i),
    updateLibrary: (id, p) => manager.updateLibrary(id, p),
    removeLibrary: (id) => manager.removeLibrary(id),
    exportPage: (pageId) => exporter!.exportPage(pageId),
    exportSite: () => exporter!.exportSite(),
    startPreview: () => runner!.start(),
    stopPreview: () => runner!.stop(),
    openSettings: () => void openSettings(),
    openLibraryDialog: () => addLibraryDialog(),
    graphText: () => graphText(editor, opts.graphLabels),
    registry,
    manager,
  };
  ed.Scripts = api;

  /* ------------------------------------------------- panel and commands */

  const hostPanel = findHostPanel(editor, opts.panelId);
  const panelButtons: any = hostPanel?.get('buttons');
  if (panelButtons) {
    panelButtons.add({
      id: PANEL_BUTTON_ID,
      label: iconHtml('graph', 20),
      command: COMMANDS.open,
      togglable: false,
      listen: true,
      attributes: { title: t('scripts') },
    });
  }

  editor.Commands.add(COMMANDS.open, {
    run() {
      wantOpen = true;
      if (!sidebar) return;
      panelButtons?.forEach((b: any) => {
        if (b.id === PANEL_BUTTON_ID) return;
        if (b.get('active')) b.set('active', false);
        // A view opened by a command (not by its button) keeps running: stop it too.
        const cmd = b.get('command');
        if (typeof cmd === 'string' && editor.Commands.isActive(cmd)) editor.stopCommand(cmd);
      });
      sidebar.show();
      const ours = panelButtons?.get(PANEL_BUTTON_ID);
      if (ours && !ours.get('active')) ours.set('active', true);
    },
    stop() {
      wantOpen = false;
      sidebar?.hide();
      const ours = panelButtons?.get(PANEL_BUTTON_ID);
      if (ours?.get('active')) ours.set('active', false);
    },
  });
  editor.Commands.add(COMMANDS.toggle, {
    run(e: Editor) {
      if (sidebar?.isOpen) e.stopCommand(COMMANDS.open);
      else e.runCommand(COMMANDS.open);
    },
  });
  editor.Commands.add(COMMANDS.create, {
    run: (_e: Editor, _s: unknown, o: { kind?: BlueprintKind } = {}) => openCreate(o.kind),
  });
  editor.Commands.add(COMMANDS.code, { run: (_e: Editor, _s: unknown, o: { id?: string } = {}) => openCode(o.id) });
  editor.Commands.add(COMMANDS.settings, { run: () => openSettings() });
  editor.Commands.add(COMMANDS.libraries, { run: () => addLibraryDialog() });
  editor.Commands.add(COMMANDS.export, { run: (_e: Editor, _s: unknown, o: { pageId?: string } = {}) => (o.pageId === undefined ? exporter!.exportSite() : exporter!.exportPage(o.pageId)) });
  editor.Commands.add(COMMANDS.build, { run: (_e: Editor, _s: unknown, o: BuildPageOptions = {}) => manager.build(o) });
  let graph: GraphEditor | null = null;

  /* ---- blueprint editors as workspace tabs (grapesjs-sidebar-tools 2.2+) ---- */

  /** Open editors of workspace tabs, by script id. */
  const tabEditors = new Map<string, GraphEditor>();
  let closingFromTab = false;

  const openTab = (ws: WorkspaceLike, id: string, activate: boolean) => {
    const bp = manager.get(id);
    if (!bp) return;
    const doc = blueprintDocId(id);
    ws.open(
      {
        id: doc,
        title: bp.name,
        icon: iconHtml('graph', 14),
        kind: 'element',
        mount: (host) => {
          if (opts.injectCss) injectCss();
          let back: (() => void) | null = null;
          const ge = openGraphEditor(editor, manager, registry, id, {
            labels: opts.graphLabels,
            t,
            parent: host,
            onPick: (picking) => {
              if (picking) back = revealCanvas(ws, doc);
              else back?.();
            },
          });
          if (!ge) return;
          tabEditors.set(id, ge);
          graph = ge;
          // "Done" in the editor closes the tab
          ge.root.addEventListener(
            'bpe:closed',
            () => {
              if (tabEditors.get(id) === ge) tabEditors.delete(id);
              if (graph === ge) graph = null;
              if (!closingFromTab && ws.has(doc)) ws.close(doc, { force: true });
            },
            { once: true },
          );
        },
        onShow: () => tabEditors.get(id)?.renderWires(),
        onClose: () => {
          const ge = tabEditors.get(id);
          if (!ge) return;
          closingFromTab = true;
          try {
            ge.close(); // saves
          } finally {
            closingFromTab = false;
          }
        },
        onClosed: () => {
          const ge = tabEditors.get(id);
          if (!ge) return;
          closingFromTab = true;
          try {
            ge.close();
          } finally {
            closingFromTab = false;
          }
        },
      },
      { activate },
    );
  };

  if (opts.workspaceTabs) {
    // Tabs of the last session come back in the background (the editor is
    // created when a tab is shown). The scripts may be loaded later than the
    // workspace (project data of a page), so retry on every change.
    let pending: string[] | null = null;
    const restore = () => {
      const ws = currentWorkspace(editor);
      if (!ws || disposed || !pending?.length) return;
      pending = pending.filter((id) => {
        if (!manager.has(id)) return true;
        if (!ws.has(blueprintDocId(id))) openTab(ws, id, false);
        return false;
      });
    };
    onWorkspace(editor, (ws) => {
      if (disposed) return;
      pending = ws.remembered(BLUEPRINT_DOC_PREFIX).map((doc) => doc.slice(BLUEPRINT_DOC_PREFIX.length));
      restore();
    });
    on(EVENTS.change, restore);
    on(EVENTS.update, (bp: Blueprint) => {
      const ws = currentWorkspace(editor);
      if (bp?.id && ws?.has(blueprintDocId(bp.id))) ws.update(blueprintDocId(bp.id), { title: bp.name });
    });
    on(EVENTS.remove, (bp: Blueprint) => {
      const ws = currentWorkspace(editor);
      if (bp?.id && ws?.has(blueprintDocId(bp.id))) ws.close(blueprintDocId(bp.id), { force: true });
    });
  }

  editor.Commands.add(COMMANDS.edit, {
    run: (_e: Editor, _s: unknown, o: { id?: string } = {}) => {
      if (!o.id || !manager.has(o.id)) return null;
      const ws = opts.workspaceTabs ? currentWorkspace(editor) : null;
      if (ws) {
        openTab(ws, o.id, true);
        editor.trigger(EVENTS.edit, { id: o.id });
        return tabEditors.get(o.id) || null;
      }
      graph?.close();
      if (opts.injectCss) injectCss();
      graph = openGraphEditor(editor, manager, registry, o.id, { labels: opts.graphLabels, t });
      const opened = graph;
      const offClose = () => {
        if (graph === opened) graph = null;
      };
      opened?.root.addEventListener('bpe:closed', offClose, { once: true });
      editor.trigger(EVENTS.edit, { id: o.id });
      return graph;
    },
  });

  /* --------------------------------------------------------- lifecycle */

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    graph?.close();
    tabEditors.forEach((ge) => ge.close());
    tabEditors.clear();
    runner?.stop();
    undoGetHtml?.();
    sidebar?.destroy();
    toggleBtn?.remove();
    offs.splice(0).forEach((f) => f());
    if (Array.isArray(storables)) {
      const i = storables.indexOf(storable);
      if (i >= 0) storables.splice(i, 1);
    }
    if (ed.__gjscrCleanup === cleanup) delete ed.__gjscrCleanup;
  };
  ed.__gjscrCleanup = cleanup;
  on('destroy', cleanup);

  // Canvas: library CSS while editing; the scripts only in the preview.
  on('canvas:frame:load', () => runner?.syncLibraries());
  on('page:select', () => runner?.syncLibraries());
  if (opts.preview) {
    on('run:core:preview', () => void runner?.start().catch((e) => console.error('[grapesjs-scripts]', e)));
    on('stop:core:preview', () => {
      runner?.stop();
      if (reopenAfterPreview) {
        reopenAfterPreview = false;
        setTimeout(() => !disposed && editor.runCommand(COMMANDS.open), 0);
      }
    });
  }
  const undoGetHtml = opts.exportHtml ? exporter.wrapGetHtml() : null;

  on('i18n:locale i18n:update', () =>
    setTimeout(() => {
      const btn = panelButtons?.get(PANEL_BUTTON_ID);
      btn?.set('attributes', { ...(btn.get('attributes') || {}), title: t('scripts') });
      if (toggleBtn) toggleBtn.title = t('scripts');
    }, 0),
  );

  const mountUi = () => {
    if (opts.injectCss) injectCss();
    sidebar = new Sidebar(editor, manager, t, {
      create: (kind) => void openCreate(kind),
      settings: () => void openSettings(),
      addLibrary: () => void addLibraryDialog(),
      editLibrary: () => void openSettings(),
      removeLibrary: (id) => {
        const lib = manager.library(id);
        if (lib && window.confirm(t('confirmRemove', lib.name))) manager.removeLibrary(id);
      },
      toggleLibrary: (id) => {
        const lib = manager.library(id);
        if (lib) manager.updateLibrary(id, { enabled: !lib.enabled });
      },
      preview: () => {
        // Back to the Scripts view when the preview ends.
        reopenAfterPreview = true;
        editor.stopCommand(COMMANDS.open);
        editor.runCommand('core:preview');
      },
      edit: (id) => editor.runCommand(COMMANDS.edit, { id }),
      code: (id) => openCode(id),
      rename,
      duplicate: (id) => manager.duplicate(id),
      remove,
      toggle: (id) => {
        const bp = manager.get(id);
        if (bp) manager.setEnabled(id, !bp.enabled);
      },
      close: () => editor.stopCommand(COMMANDS.open),
    });
    const container = editor.getContainer() as HTMLElement;
    const { el, mode } = findSidebarHost(editor, opts.sidebarContainer);
    if (mode === 'floating') {
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      sidebar.root.classList.add('gjscr-floating');
    } else {
      sidebar.root.classList.add('gjscr-docked');
    }
    el.appendChild(sidebar.root);

    if (panelButtons) {
      const ours = panelButtons.get(PANEL_BUTTON_ID);
      // Another view was activated (click, or a preset opening the Style Manager on select).
      const onActive = (b: any) => {
        if (b.id === PANEL_BUTTON_ID || !b.get('active')) return;
        if (ours?.get('active')) ours.set('active', false);
        if (sidebar?.isOpen) editor.stopCommand(COMMANDS.open);
      };
      panelButtons.on('change:active', onActive);
      offs.push(() => panelButtons.off('change:active', onActive));
    } else {
      toggleBtn = h('button', { class: 'gjscr-toggle', type: 'button', title: t('scripts'), onclick: () => editor.runCommand(COMMANDS.toggle) }, icon('graph', 18));
      const groups = container.querySelectorAll('.gjs-pn-buttons');
      const host = groups[groups.length - 1];
      if (host) {
        toggleBtn.classList.add('gjs-pn-btn', 'gjscr-btn-inline');
        host.appendChild(toggleBtn);
      } else {
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        container.appendChild(toggleBtn);
      }
    }
    if (wantOpen) editor.runCommand(COMMANDS.open);
  };

  editor.onReady(() => {
    if (disposed || !isAlive(editor)) return;
    mountUi();
    components?.sync();
    runner?.syncLibraries();
  });
}

function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'script';
}
