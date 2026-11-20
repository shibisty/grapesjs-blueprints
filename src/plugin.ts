import type { Editor } from 'grapesjs';
import { createRegistry, type Blueprint, type BlueprintKind, type BuildResult, type NodeDef, type NodeRegistry } from 'blueprintsjs';
import { diagnosticText, type GraphEditor } from 'blueprintsjs/editor';
import { ScriptsManager, type BuildPageOptions, type CreateScriptInit, type ScriptsSettings } from './core/ScriptsManager';
import type { CodeItem, CodeLang, CreateCodeInit, PageScope } from './core/code';
import { COMMANDS, EVENTS } from './events';
import { createTranslator, registerMessages, type Translator } from './i18n';
import { META, publicOptions, resolveOptions, type ScriptsPluginOptions } from './options';
import { definePlugin, registerControl } from './contract';
import { h, icon, iconHtml } from './ui/dom';
import { findHostPanel, findSidebarHost } from './ui/host';
import { cdnTools } from './core/output';
import { CanvasRunner } from './integration/canvas';
import { ComponentBlueprints, pagesComponentOf, type ComponentSpecX } from './integration/components';
import { pageIdOf, ScriptsExporter, type PageExport, type SiteExport } from './integration/export';
import type { Library } from './core/libraries';
import { openGraphEditor, graphText, pickSelectorFlow } from './ui/graph';
import { currentWorkspace, docId as blueprintDocId, DOC_PREFIX as BLUEPRINT_DOC_PREFIX, onWorkspace, revealCanvas, type WorkspaceLike } from './integration/workspace';
import { pagesComponents, pagesOf, ScopeTracker, shareWithPages } from './integration/pages';
import { rulesEditor } from './ui/rules';
import { openRecordCodeDialog, recordRule, type RecordRef } from './ui/recordCode';
import { contentSelect } from './ui/content';
import { CssItems } from './integration/cssItems';
import { CSS_NODES, RULE_NODE } from './blueprints/cssNodes';
import { staticCss, type StaticCss } from './blueprints/blueprintCss';
import { PageCss } from './integration/pageCss';
import { PageCssEditorView } from './ui/pageCssEditor';
import { openLibraryDialog } from './ui/libraries';
import { CodeEditorView } from './ui/codeEditor';
import { openCodeDialog, openCreateDialog, openModal } from './ui/modals';
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
  /**
   * What a page needs: files and tags (minified/obfuscated as set). A page id
   * (`editor.Pages`, or a grapesjs-site-pages record id), or a page with its
   * layout/template; default: the page shown.
   */
  exportPage(page?: string | PageScope): Promise<PageExport>;
  /** Every page: files once, tags per page. */
  exportSite(): Promise<SiteExport>;
  /** Start / stop the scripts in the canvas (normally done by the GrapesJS preview). */
  startPreview(): Promise<void>;
  stopPreview(): void;
  openSettings(): void;
  openLibraryDialog(): Promise<Library | null>;
  /** Text lookup used by the graph editor (current editor language). */
  graphText(): ReturnType<typeof graphText>;
  /** Hand-written JS and CSS (same kinds and targets as blueprints). */
  code: {
    list(lang?: CodeLang, kind?: BlueprintKind): CodeItem[];
    get(id: string): CodeItem | undefined;
    create(init: CreateCodeInit): CodeItem;
    update(id: string, patch: Partial<CodeItem> | ((c: CodeItem) => CodeItem)): CodeItem;
    remove(id: string): boolean;
    duplicate(id: string): CodeItem;
    move(id: string, toIndex: number): void;
    /** Enabled items of a language for a page: global ones, then the page's. */
    for(lang: CodeLang, scope?: PageScope | string): CodeItem[];
  };
  readonly registry: NodeRegistry;
  readonly manager: ScriptsManager;
}

type EditorWithScripts = Editor & { Scripts?: ScriptsApi; __gjscrCleanup?: () => void };

export function getScripts(editor: Editor): ScriptsApi | undefined {
  return (editor as EditorWithScripts).Scripts;
}

const scopeFromPage = (id: string | undefined): PageScope | undefined => (id ? { id } : undefined);

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
function scriptsPlugin(editor: Editor, userOpts: ScriptsPluginOptions = {}): void {
  const ed = editor as EditorWithScripts;
  ed.__gjscrCleanup?.();

  const opts = resolveOptions(userOpts);
  const offControl = registerControl(editor, META, () => publicOptions(opts), () => undefined);
  registerMessages(editor);
  const t: Translator = createTranslator(editor, opts.labels);
  const registry = createRegistry([...CSS_NODES, ...opts.nodes]);
  // Static CSS of the blueprints ("Apply to selector"), cached by graph.
  const bpCss = new Map<string, { sig: string; res: StaticCss }>();
  const staticOf = (bp: Blueprint): StaticCss => {
    if (!bp.nodes.some((n) => n.type === RULE_NODE)) return { rules: [], css: '', problems: [] };
    const sig = JSON.stringify([bp.nodes, bp.links, bp.variables]);
    const hit = bpCss.get(bp.id);
    if (hit && hit.sig === sig) return hit.res;
    let root: unknown = null;
    try {
      root = editor.Canvas.getDocument?.() || null;
    } catch {
      root = null;
    }
    const res = staticCss(bp, registry, root || document);
    bpCss.set(bp.id, { sig, res });
    return res;
  };
  const em: any = (editor as any).getModel?.();

  const manager = new ScriptsManager(registry, {
    defaultName: () => t('defaultName'),
    copySuffix: () => t('copySuffix'),
    diagnostics: (bp) =>
      staticOf(bp).problems.map((p) => ({ severity: 'warning' as const, code: 'static-css', message: p.message, args: [p.message], nodeId: p.nodeId })),
    onChange: (type, bp, code) => {
      if (!isAlive(editor)) return;
      if (type !== 'load') em?.changesUp?.({});
      if (type === 'code' && code) editor.trigger(EVENTS.code, code);
      if (type === 'add') editor.trigger(EVENTS.add, bp);
      if (type === 'update') editor.trigger(EVENTS.update, bp);
      if (type === 'remove') editor.trigger(EVENTS.remove, bp);
      if (type === 'settings') editor.trigger(EVENTS.settings, manager.settings);
      if (type === 'libraries' || type === 'load') runner?.syncLibraries();
      if (type !== 'settings' && type !== 'libraries') components?.sync();
      exporter?.refreshSoon();
      editor.trigger(EVENTS.change, { type, id: bp?.id ?? code?.item.id });
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
  // With grapesjs-site-pages: the scripts are site-wide, not copied into every page.
  if (opts.sharedWithPages) shareWithPages(editor, opts.storageKey, (e) => console.error(e));

  // The page shown: grapesjs-site-pages' open record (with its layout and template), else editor.Pages.
  const tracker = new ScopeTracker(editor);
  const scopeOf = (component?: any): PageScope | undefined => (component && !tracker.withPages ? scopeFromPage(pageIdOf(editor, component)) : tracker.scope());
  runner = new CanvasRunner(editor, manager, registry, () => scopeOf());
  // CSS items as GrapesJS rules of the page shown (Style Manager, getCss, publish).
  const cssItems = new CssItems(editor, manager, () => scopeOf(), () =>
    manager
      .list()
      .filter((b) => b.enabled)
      .map((b): CodeItem | null => {
        const { css } = staticOf(b);
        if (!css) return null;
        const target = b.kind === 'component' ? { componentType: b.component?.type } : b.kind === 'template' ? { pages: b.target?.pages || [] } : undefined;
        return { id: `bp:${b.id}`, name: b.name, lang: 'css', kind: b.kind, enabled: true, code: css, target } as CodeItem;
      })
      .filter((c): c is CodeItem => !!c),
  );
  // The page's own GrapesJS styles as CSS, both ways.
  const pageCss = new PageCss(editor);
  components = new ComponentBlueprints(editor, manager, registry, () => opts.blocksCategory || t('blocksCategory'));
  exporter = new ScriptsExporter(editor, manager, opts.output.tools || cdnTools(opts.output.urls), scopeOf);
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
    const init = await openCreateDialog(editor, manager, t, { kind, withPages: tracker.withPages, choices: () => tracker.choices() });
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

  /* ---- JS / CSS items ---- */

  /** Open code editors, by item id (one per item: a tab or the overlay). */
  const codeEditors = new Map<string, CodeEditorView>();
  const CODE_DOC_PREFIX = 'code:';
  const codeDocId = (id: string) => `${CODE_DOC_PREFIX}${id}`;

  const newCodeEditor = (id: string, parent?: HTMLElement): CodeEditorView => {
    if (opts.injectCss) injectCss();
    const view: CodeEditorView = new CodeEditorView(editor, manager, id, {
      t,
      parent,
      choices: () => tracker.choices(),
      withPages: () => tracker.withPages,
      cssRules: (code) => cssItems.ruleCount(code),
      pagesComponents: () => pagesComponents(editor),
      pickSelector: async () => {
        const ws = parent ? currentWorkspace(editor) : null;
        const back = ws ? revealCanvas(ws, codeDocId(id)) : () => undefined;
        try {
          return await pickSelectorFlow(editor, t, view.root);
        } finally {
          back();
        }
      },
      onClosed: () => {
        if (codeEditors.get(id) === view) codeEditors.delete(id);
        const ws = currentWorkspace(editor);
        if (parent && ws?.has(codeDocId(id)) && !closingCodeTab) ws.close(codeDocId(id), { force: true });
      },
    });
    codeEditors.set(id, view);
    return view;
  };
  let closingCodeTab = false;

  /** Opens the editor of a JS/CSS item: a workspace tab with grapesjs-sidebar-tools, else over the page. */
  const editCode = (id: string, activate = true): CodeEditorView | null => {
    const item = manager.getCode(id);
    if (!item) return null;
    const ws = opts.workspaceTabs ? currentWorkspace(editor) : null;
    if (ws) {
      const doc = codeDocId(id);
      if (ws.has(doc)) {
        if (activate) ws.activate(doc);
      } else {
        ws.open(
          {
            id: doc,
            title: item.name,
            tooltip: `${item.lang.toUpperCase()} · ${item.name}`,
            kind: 'element',
            mount: (container) => void newCodeEditor(id, container),
            onShow: () => codeEditors.get(id)?.refresh(),
            onClosed: () => {
              closingCodeTab = true;
              try {
                codeEditors.get(id)?.close();
              } finally {
                closingCodeTab = false;
              }
            },
          },
          { activate },
        );
      }
      return codeEditors.get(id) || null;
    }
    codeEditors.forEach((v) => !v.root.classList.contains('gjscr-ce--embedded') && v.close());
    return newCodeEditor(id);
  };

  /** The page's own CSS: a workspace tab with grapesjs-sidebar-tools, else over the page. */
  let pageCssView: PageCssEditorView | null = null;
  const PAGE_CSS_DOC = 'code:page-css';
  const pageTitle = (): string => {
    const id = (editor as any).PagesManager?.getActiveId?.();
    const name = id ? tracker.choices().find((c) => c.id === id)?.name : '';
    return name ? `${t('pageCss')} · ${name}` : t('pageCss');
  };
  const newPageCss = (parent?: HTMLElement): PageCssEditorView => {
    if (opts.injectCss) injectCss();
    pageCssView = new PageCssEditorView(editor, pageCss, {
      t,
      parent,
      title: pageTitle,
      onClosed: () => {
        pageCssView = null;
        const ws = currentWorkspace(editor);
        if (parent && ws?.has(PAGE_CSS_DOC) && !closingCodeTab) ws.close(PAGE_CSS_DOC, { force: true });
      },
    });
    return pageCssView;
  };
  const editPageCss = (): void => {
    const ws = opts.workspaceTabs ? currentWorkspace(editor) : null;
    if (ws) {
      if (ws.has(PAGE_CSS_DOC)) ws.activate(PAGE_CSS_DOC);
      else
        ws.open(
          {
            id: PAGE_CSS_DOC,
            title: t('pageCss'),
            tooltip: t('pageCssHint'),
            kind: 'element',
            mount: (container) => void newPageCss(container),
            onShow: () => pageCssView?.refresh(),
            onClosed: () => {
              closingCodeTab = true;
              try {
                pageCssView?.close();
              } finally {
                closingCodeTab = false;
              }
            },
          },
          { activate: true },
        );
      return;
    }
    if (pageCssView) return;
    newPageCss();
  };
  const offPageCssList = pageCss.onChange(() => sidebar?.render?.());

  const createCode = (lang: CodeLang, kind?: BlueprintKind): CodeItem => {
    const item = manager.createCode({ lang, kind });
    editCode(item.id);
    return item;
  };
  const renameCode = (id: string) => {
    const c = manager.getCode(id);
    if (!c) return;
    const name = window.prompt(t('promptName'), c.name);
    if (name != null && name.trim()) manager.updateCode(id, { name: name.trim() });
  };
  const removeCode = (id: string) => {
    const c = manager.getCode(id);
    if (c && window.confirm(t('confirmRemoveCode', c.name))) manager.removeCode(id);
  };

  /* ---- with grapesjs-site-pages: components and records ---- */

  /** A component blueprint's content: its HTML, or a linked component of pages. */
  const chooseContent = (id: string): void => {
    const bp = manager.get(id);
    if (!bp || bp.kind !== 'component' || !bp.component) return;
    let value = pagesComponentOf(bp.component);
    const sel = contentSelect(t, pagesComponents(editor), value, (v) => (value = v));
    const done = () => {
      const cur = manager.get(id);
      if (cur?.component) {
        const spec: ComponentSpecX = { ...cur.component };
        if (value) spec.pagesComponent = value;
        else delete spec.pagesComponent;
        manager.update(id, { component: spec });
      }
      (editor.Modal as any).close();
    };
    const body = h(
      'div',
      { class: 'gjscr-modal' },
      h('div', { class: 'gjscr-field' }, h('span', { class: 'gjscr-label' }, t('componentContent')), sel, h('small', { class: 'gjscr-hint' }, t('pagesComponentHint'))),
      h(
        'div',
        { class: 'gjscr-actions' },
        h('button', { type: 'button', class: 'gjscr-secondary', onclick: () => (editor.Modal as any).close() }, t('cancel')),
        h('button', { type: 'button', class: 'gjscr-primary', 'data-role': 'apply', onclick: done }, t('done')),
      ),
    );
    if (opts.injectCss) injectCss();
    openModal(editor, `${t('componentContentAction')}: ${bp.name}`, body);
  };

  /** "Scripts & styles" of a pages record. */
  const recordCode = (rec: RecordRef): void => {
    if (opts.injectCss) injectCss();
    openRecordCodeDialog(editor, manager, t, rec, {
      createHere: (lang) => {
        const item = manager.createCode({ lang, kind: 'template', target: { pages: [recordRule(rec)] } });
        editCode(item.id);
      },
      edit: (id) => editCode(id),
    });
  };
  on('pages-manager:record-actions', ({ record, actions }: { record: RecordRef & { deleted?: boolean }; actions: any[] }) => {
    const kind = record?.kind || 'page';
    if (!record || record.deleted || !['page', 'layout', 'template', 'component'].includes(kind) || !Array.isArray(actions)) return;
    actions.push({ id: 'scripts', label: t('scriptsAndStyles'), icon: '{}', run: (r: RecordRef) => recordCode(r) });
  });
  // The component content action shows only while pages has components.
  on('pages-manager:components', () => sidebar?.renderSoon());

  /** Our component types as starting points of new pages components. */
  const pagesSource = () => {
    const p = pagesOf(editor);
    if (!p?.components?.addSource) return;
    const types = () => [
      ...manager.list('component').filter((b) => b.component?.type).map((b) => ({ id: b.component!.type, name: b.component!.label || b.name })),
      ...manager.listCode('js', 'component').filter((c) => c.component?.type).map((c) => ({ id: c.component!.type, name: c.component!.label || c.name })),
    ];
    const off = p.components.addSource({
      id: 'blueprints',
      label: t('tabBlueprints'),
      list: types,
      build: (type) => ({ type }),
    });
    offs.push(off);
  };

  const addLibraryDialog = () => openLibraryDialog(editor, manager, t, http);
  const libraryScope = () => ({ withPages: tracker.withPages, choices: () => tracker.choices() });
  const openSettings = () =>
    openSettingsDialog(
      editor,
      manager,
      t,
      exporter!,
      () => {
        void addLibraryDialog().then(() => openSettings());
      },
      libraryScope(),
    );

  /** Conditions of a unique item (page / component is / is not) in a small dialog. */
  const openConditions = (title: string, value: string[], save: (pages: string[]) => void): void => {
    if (opts.injectCss) injectCss();
    let next = value.slice();
    const body = h(
      'div',
      { class: 'gjscr-modal gjscr-conditions' },
      rulesEditor({ t, choices: () => tracker.choices(), value, onChange: (v) => (next = v) }),
      h(
        'div',
        { class: 'gjscr-actions' },
        h('button', { type: 'button', class: 'gjscr-secondary', onclick: () => (editor.Modal as any).close() }, t('cancel')),
        h(
          'button',
          {
            type: 'button',
            class: 'gjscr-primary',
            'data-role': 'apply',
            onclick: () => {
              save(next);
              (editor.Modal as any).close();
            },
          },
          t('done'),
        ),
      ),
    );
    openModal(editor, `${t('conditions')}: ${title}`, body);
  };
  const editConditions = (id: string): void => {
    const bp = manager.get(id);
    if (!bp) return;
    openConditions(bp.name, bp.target?.pages || [], (pages) => {
      const cur = manager.get(id);
      if (cur) manager.update(id, { target: { ...(cur.target || {}), pages } });
    });
  };
  /** A new library; a unique one asks for its conditions right after. */
  const addLibrary = async (unique?: boolean): Promise<void> => {
    const lib = await addLibraryDialog();
    if (lib && unique) openConditions(lib.name, [], (pages) => manager.updateLibrary(lib.id, { pages }));
  };

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
    code: {
      list: (lang, kind) => manager.listCode(lang, kind),
      get: (id) => manager.getCode(id),
      create: (init) => manager.createCode(init),
      update: (id, patch) => manager.updateCode(id, patch),
      remove: (id) => manager.removeCode(id),
      duplicate: (id) => manager.duplicateCode(id),
      move: (id, i) => manager.moveCode(id, i),
      for: (lang, scope) => manager.codeFor(lang, typeof scope === 'string' ? { pageId: scope } : { scope }),
    },
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

  /**
   * Our panel button, unless another plugin manages it: a docking plugin
   * (grapesjs-sidebar-tools) gives each view a context of its own, keeps
   * the buttons idle and shows the views itself; following the command
   * with the button there would stop the view again.
   */
  const ownButton = (): any => {
    const b = panelButtons?.get(PANEL_BUTTON_ID);
    return b && !b.get('context') ? b : null;
  };
  editor.Commands.add(COMMANDS.open, {
    run() {
      wantOpen = true;
      if (!sidebar) return;
      // Our view replaces the others, unless they are docked next to it.
      if (ownButton()) panelButtons?.forEach((b: any) => {
        if (b.id === PANEL_BUTTON_ID || b.get('context')) return;
        if (b.get('active')) b.set('active', false);
        // A view opened by a command (not by its button) keeps running: stop it too.
        const cmd = b.get('command');
        if (typeof cmd === 'string' && editor.Commands.isActive(cmd)) editor.stopCommand(cmd);
      });
      sidebar.show();
      const ours = ownButton();
      if (ours && !ours.get('active')) ours.set('active', true);
    },
    stop() {
      wantOpen = false;
      sidebar?.hide();
      const ours = ownButton();
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
  editor.Commands.add(COMMANDS.pageCss, { run: () => editPageCss() });
  editor.Commands.add(COMMANDS.editCode, { run: (_e: Editor, _s: unknown, o: { id?: string } = {}) => (o.id ? editCode(o.id) : null) });
  editor.Commands.add(COMMANDS.createCode, { run: (_e: Editor, _s: unknown, o: { lang?: CodeLang; kind?: BlueprintKind } = {}) => createCode(o.lang === 'css' ? 'css' : 'js', o.kind) });
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
    // Code tabs: the same — back after a reload, renamed and closed with their item.
    let pendingCode: string[] | null = null;
    const restoreCode = () => {
      if (!currentWorkspace(editor) || disposed || !pendingCode?.length) return;
      pendingCode = pendingCode.filter((id) => {
        if (!manager.getCode(id)) return true;
        editCode(id, false);
        return false;
      });
    };
    onWorkspace(editor, (ws) => {
      if (disposed) return;
      pendingCode = ws.remembered(CODE_DOC_PREFIX).map((doc) => doc.slice(CODE_DOC_PREFIX.length));
      restoreCode();
    });
    on(EVENTS.change, restoreCode);
    on(EVENTS.code, (p: { action: string; item: CodeItem }) => {
      const ws = currentWorkspace(editor);
      const doc = p?.item ? codeDocId(p.item.id) : '';
      if (!ws || !doc || !ws.has(doc)) return;
      if (p.action === 'remove') ws.close(doc, { force: true });
      else ws.update(doc, { title: p.item.name, tooltip: `${p.item.lang.toUpperCase()} · ${p.item.name}` });
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
    offControl();
    graph?.close();
    tabEditors.forEach((ge) => ge.close());
    tabEditors.clear();
    codeEditors.forEach((v) => v.close());
    codeEditors.clear();
    runner?.stop();
    cssItems.destroy();
    offPageCssList();
    pageCssView?.close();
    pageCss.destroy();
    tracker.destroy();
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
  on('page:select pages-manager:open', () => runner?.syncLibraries());
  // Libraries limited by "component is / is not" follow linked components added to / removed from the page.
  let libSync: ReturnType<typeof setTimeout> | undefined;
  on('component:add component:remove', () => {
    if (!manager.libraries().some((l) => (l.pages || []).some((r) => r.replace(/^!/, '').startsWith('component:')))) return;
    clearTimeout(libSync);
    libSync = setTimeout(() => !disposed && runner?.syncLibraries(), 50);
  });
  offs.push(() => clearTimeout(libSync));
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
      addLibrary: (unique) => void addLibrary(unique),
      editLibrary: () => void openSettings(),
      withPages: () => tracker.withPages,
      editConditions,
      editLibraryConditions: (id) => {
        const lib = manager.library(id);
        if (lib) openConditions(lib.name, lib.pages || [], (pages) => manager.updateLibrary(id, { pages }));
      },
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
      createCode: (lang, kind) => void createCode(lang, kind),
      editCode: (id) => void editor.runCommand(COMMANDS.editCode, { id }),
      editPageCss: () => editor.runCommand(COMMANDS.pageCss),
      pageCssCount: () => pageCss.count(),
      toggleCode: (id) => {
        const c = manager.getCode(id);
        if (c) manager.updateCode(id, { enabled: !c.enabled });
      },
      renameCode,
      duplicateCode: (id) => void manager.duplicateCode(id),
      removeCode,
      targetNames: () => new Map(tracker.choices().map((c) => [c.id, c.name])),
      cssRules: (code) => cssItems.ruleCount(code),
      canLink: () => pagesComponents(editor).length > 0,
      componentContent: chooseContent,
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
        // A view in another context (docked next to ours) does not replace it.
        if (b.get('context') !== ours?.get('context')) return;
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
    // The command may have run before the sidebar existed; GrapesJS then
    // counts it as active and would skip a second run.
    if (wantOpen) {
      if (editor.Commands.isActive(COMMANDS.open)) sidebar.show();
      else editor.runCommand(COMMANDS.open);
    }
  };

  editor.onReady(() => {
    if (disposed || !isAlive(editor)) return;
    mountUi();
    pagesSource();
    components?.sync();
    runner?.syncLibraries();
  });
}

definePlugin(scriptsPlugin, META);

export default scriptsPlugin;

function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'script';
}
