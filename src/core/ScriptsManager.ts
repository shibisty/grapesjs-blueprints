import {
  buildScript,
  buildStandalone,
  compileBlueprint,
  normalizeBlueprint,
  uid,
  validateBlueprint,
  type Blueprint,
  type BlueprintKind,
  type BuildResult,
  type ComponentSpec,
  type Diagnostic,
  type NodeRegistry,
  type TemplateTarget,
} from '../blueprint';
import { normalizeLibrary, type Library } from './libraries';

export type OutputMode = 'file' | 'inline';

/** How the page script is delivered (used by export and preview, phase 4). */
export interface ScriptsSettings {
  /** `file`: a separate script file; `inline`: a `<script>` in the page HTML. */
  output: OutputMode;
  /** File name for `output: 'file'`. */
  fileName: string;
  /** Minify the output (terser, loaded on demand). */
  minify: boolean;
  /** Obfuscate the output (javascript-obfuscator, loaded on demand). */
  obfuscate: boolean;
  /** Keep `// node · Title` comments in the readable output. */
  comments: boolean;
  /** Add the `<script>`/`<link>` tags to `editor.getHtml()`. */
  includeInHtml: boolean;
}

export const DEFAULT_SETTINGS: ScriptsSettings = {
  output: 'file',
  fileName: 'scripts.js',
  minify: false,
  obfuscate: false,
  comments: true,
  includeInHtml: true,
};

/** What the plugin keeps in the project data under `scripts`. */
export interface ScriptsData {
  schema: 1;
  blueprints: Blueprint[];
  settings: ScriptsSettings;
  libraries: Library[];
}

export interface CreateScriptInit {
  name?: string;
  kind?: BlueprintKind;
  target?: TemplateTarget;
  component?: Partial<ComponentSpec>;
  description?: string;
  /** Start with these nodes/links instead of the default starter node. */
  nodes?: Blueprint['nodes'];
  links?: Blueprint['links'];
  variables?: Blueprint['variables'];
}

export interface BuildPageOptions {
  /** Id of an `editor.Pages` page: template scripts not targeting it are left out. */
  pageId?: string;
  target?: 'page' | 'preview';
  includeDisabled?: boolean;
  comments?: boolean;
  /**
   * `shared`: global scripts and template scripts for every page (one file for the site);
   * `page`: only template scripts limited to `pageId`. Default: both.
   */
  only?: 'shared' | 'page';
}

export type ChangeType = 'add' | 'update' | 'remove' | 'load' | 'settings' | 'libraries';

export interface ManagerHooks {
  /** Something changed (payload for `scripts:*` events). */
  onChange?(type: ChangeType, bp?: Blueprint): void;
  /** Base for automatic names ("Script" → "Script 1"). */
  defaultName?(): string;
  /** Suffix of duplicated names ("copy"). */
  copySuffix?(): string;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A valid custom-element-like component type: lower-case, starts with a letter, has a dash. */
export function componentTypeFrom(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `bp-${slug || fallback}`;
}

export function isValidComponentType(type: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(type);
}

/**
 * All scripts of the project. No DOM and no GrapesJS here: the plugin wires the hooks to editor
 * events and the storable.
 */
export class ScriptsManager {
  private items: Blueprint[] = [];
  private _settings: ScriptsSettings = { ...DEFAULT_SETTINGS };
  private libs: Library[] = [];

  constructor(
    readonly registry: NodeRegistry,
    private readonly hooks: ManagerHooks = {},
  ) {}

  /* ------------------------------------------------------------ read */

  list(kind?: BlueprintKind): Blueprint[] {
    return clone(kind ? this.items.filter((b) => b.kind === kind) : this.items);
  }

  get(id: string): Blueprint | undefined {
    const b = this.items.find((x) => x.id === id);
    return b ? clone(b) : undefined;
  }

  has(id: string): boolean {
    return this.items.some((x) => x.id === id);
  }

  get size(): number {
    return this.items.length;
  }

  get settings(): ScriptsSettings {
    return { ...this._settings };
  }

  /** Component types used by component scripts (except `exceptId`). */
  componentTypes(exceptId?: string): string[] {
    return this.items.filter((b) => b.id !== exceptId && b.component?.type).map((b) => b.component!.type);
  }

  /* ----------------------------------------------------------- write */

  create(init: CreateScriptInit = {}): Blueprint {
    const kind: BlueprintKind = init.kind === 'template' || init.kind === 'component' ? init.kind : 'global';
    const name = init.name?.trim() || this.nextName();
    const id = uid('bp');
    const starter =
      kind === 'component'
        ? [{ id: 'start', type: 'event.start', pos: [80, 80] as [number, number] }]
        : [{ id: 'event', type: 'event.element', pos: [80, 80] as [number, number], props: { selector: '', event: 'click' } }];
    const raw: Partial<Blueprint> = {
      id,
      name,
      kind,
      enabled: true,
      description: init.description,
      variables: init.variables || [],
      nodes: init.nodes || starter,
      links: init.links || [],
    };
    if (kind === 'template') raw.target = { pages: init.target?.pages || [], ...(init.target?.when ? { when: init.target.when } : {}) };
    if (kind === 'component') raw.component = this.componentSpec(name, id, init.component);
    const bp = normalizeBlueprint(raw);
    this.items.push(bp);
    this.hooks.onChange?.('add', clone(bp));
    return clone(bp);
  }

  /** Replace a script (or patch it). Id, schema and kind-specific invariants are kept. */
  update(id: string, patch: Partial<Blueprint> | ((bp: Blueprint) => Blueprint)): Blueprint {
    const i = this.indexOf(id);
    const prev = this.items[i];
    const next = typeof patch === 'function' ? patch(clone(prev)) : { ...clone(prev), ...clone(patch) };
    const bp = normalizeBlueprint({ ...next, id: prev.id });
    if (bp.kind === 'component') {
      const type = bp.component?.type;
      if (!type || !isValidComponentType(type) || this.componentTypes(id).includes(type)) {
        bp.component = this.componentSpec(bp.name, bp.id, { ...bp.component, type: prev.component?.type });
      }
    } else {
      delete bp.component;
    }
    if (bp.kind !== 'template') delete bp.target;
    if (JSON.stringify(bp) === JSON.stringify(prev)) return clone(prev);
    this.items[i] = bp;
    this.hooks.onChange?.('update', clone(bp));
    return clone(bp);
  }

  rename(id: string, name: string): Blueprint {
    const n = name.trim();
    if (!n) return this.get(id)!;
    return this.update(id, { name: n });
  }

  setEnabled(id: string, enabled: boolean): Blueprint {
    return this.update(id, { enabled });
  }

  duplicate(id: string): Blueprint {
    const src = this.items[this.indexOf(id)];
    const copy = clone(src);
    copy.id = uid('bp');
    copy.name = this.uniqueName(`${src.name} ${this.hooks.copySuffix?.() || 'copy'}`);
    if (copy.component) copy.component = this.componentSpec(copy.name, copy.id, { ...copy.component, type: undefined });
    const i = this.indexOf(id);
    this.items.splice(i + 1, 0, normalizeBlueprint(copy));
    this.hooks.onChange?.('add', clone(this.items[i + 1]));
    return clone(this.items[i + 1]);
  }

  remove(id: string): boolean {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const [bp] = this.items.splice(i, 1);
    this.hooks.onChange?.('remove', clone(bp));
    return true;
  }

  /** Move a script to another position in the list. */
  move(id: string, toIndex: number): void {
    const i = this.indexOf(id);
    const [bp] = this.items.splice(i, 1);
    this.items.splice(Math.max(0, Math.min(this.items.length, toIndex)), 0, bp);
    this.hooks.onChange?.('update', clone(bp));
  }

  setSettings(patch: Partial<ScriptsSettings>): ScriptsSettings {
    const s = { ...this._settings, ...patch };
    s.output = s.output === 'inline' ? 'inline' : 'file';
    s.fileName = String(s.fileName || DEFAULT_SETTINGS.fileName).trim() || DEFAULT_SETTINGS.fileName;
    s.minify = !!s.minify;
    s.obfuscate = !!s.obfuscate;
    s.comments = s.comments !== false;
    s.includeInHtml = s.includeInHtml !== false;
    if (JSON.stringify(s) !== JSON.stringify(this._settings)) {
      this._settings = s;
      this.hooks.onChange?.('settings');
    }
    return this.settings;
  }

  /* ------------------------------------------------------ persistence */

  toJSON(): ScriptsData {
    return { schema: 1, blueprints: clone(this.items), settings: { ...this._settings }, libraries: clone(this.libs) };
  }

  /* -------------------------------------------------------- libraries */

  libraries(): Library[] {
    return clone(this.libs);
  }

  library(id: string): Library | undefined {
    const l = this.libs.find((x) => x.id === id);
    return l ? clone(l) : undefined;
  }

  /** Enabled libraries for a page (all pages when `pageId` is not given). */
  librariesFor(pageId?: string): Library[] {
    return clone(this.libs.filter((l) => l.enabled && (!pageId || !l.pages?.length || l.pages.includes(pageId))));
  }

  addLibrary(init: Partial<Library>): Library {
    const lib = normalizeLibrary({ ...init, id: undefined });
    if (!lib) throw new Error('[grapesjs-scripts] a library needs at least one http(s) file URL');
    this.libs.push(lib);
    this.hooks.onChange?.('libraries');
    return clone(lib);
  }

  updateLibrary(id: string, patch: Partial<Library>): Library {
    const i = this.libs.findIndex((l) => l.id === id);
    if (i < 0) throw new Error(`[grapesjs-scripts] no library "${id}"`);
    const lib = normalizeLibrary({ ...this.libs[i], ...clone(patch), id });
    if (!lib) throw new Error('[grapesjs-scripts] a library needs at least one http(s) file URL');
    if (JSON.stringify(lib) !== JSON.stringify(this.libs[i])) {
      this.libs[i] = lib;
      this.hooks.onChange?.('libraries');
    }
    return clone(lib);
  }

  removeLibrary(id: string): boolean {
    const i = this.libs.findIndex((l) => l.id === id);
    if (i < 0) return false;
    this.libs.splice(i, 1);
    this.hooks.onChange?.('libraries');
    return true;
  }

  moveLibrary(id: string, toIndex: number): void {
    const i = this.libs.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [l] = this.libs.splice(i, 1);
    this.libs.splice(Math.max(0, Math.min(this.libs.length, toIndex)), 0, l);
    this.hooks.onChange?.('libraries');
  }

  /** Replace everything with stored data (junk is normalized or dropped). */
  load(data: unknown, { silent = false } = {}): void {
    const d = (data && typeof data === 'object' ? data : {}) as Partial<ScriptsData>;
    const seen = new Set<string>();
    const types = new Set<string>();
    this.items = [];
    for (const raw of Array.isArray(d.blueprints) ? d.blueprints : []) {
      if (!raw || typeof raw !== 'object') continue;
      const bp = normalizeBlueprint(raw);
      if (seen.has(bp.id)) bp.id = uid('bp');
      seen.add(bp.id);
      if (bp.kind === 'component') {
        if (!bp.component?.type || !isValidComponentType(bp.component.type) || types.has(bp.component.type)) {
          bp.component = this.componentSpec(bp.name, bp.id, { ...bp.component, type: undefined }, types);
        }
        types.add(bp.component!.type);
      }
      this.items.push(bp);
    }
    this._settings = { ...DEFAULT_SETTINGS };
    if (d.settings && typeof d.settings === 'object') this.setSettingsSilently(d.settings);
    const libIds = new Set<string>();
    this.libs = (Array.isArray(d.libraries) ? d.libraries : [])
      .map((l) => normalizeLibrary(l))
      .filter((l): l is Library => !!l && !libIds.has(l.id) && !!libIds.add(l.id));
    if (!silent) this.hooks.onChange?.('load');
  }

  clear(): void {
    this.items = [];
    this.libs = [];
    this._settings = { ...DEFAULT_SETTINGS };
  }

  /* ----------------------------------------------------------- output */

  /** The page script: global scripts plus the template scripts for `pageId`. */
  build(o: BuildPageOptions = {}): BuildResult {
    const list = this.items.filter((b) => {
      const pages = b.kind === 'template' ? b.target?.pages || [] : [];
      if (o.only === 'shared') return !pages.length;
      if (o.only === 'page') return !!pages.length && !!o.pageId && pages.includes(o.pageId);
      if (b.kind !== 'template' || !o.pageId) return true;
      return !pages.length || pages.includes(o.pageId);
    });
    return buildScript(list, this.registry, {
      target: o.target,
      includeDisabled: o.includeDisabled,
      comments: o.comments ?? this._settings.comments,
    });
  }

  /** JavaScript of one script, for viewing (disabled ones too). */
  codeOf(id: string): { code: string; diagnostics: Diagnostic[] } {
    const bp = this.items[this.indexOf(id)];
    if (bp.kind === 'component') {
      const c = buildStandalone(bp, this.registry);
      return { code: `/* ${bp.component?.type}: script of each instance */\n(${c.code});\n`, diagnostics: this.diagnostics(id) };
    }
    const res = buildScript([bp], this.registry, { includeDisabled: true });
    return { code: res.code, diagnostics: this.diagnostics(id) };
  }

  /** Validation + compiler problems of a script (duplicates merged). */
  diagnostics(id: string): Diagnostic[] {
    const bp = this.items[this.indexOf(id)];
    const all = [...validateBlueprint(bp, this.registry), ...compileBlueprint(bp, this.registry).diagnostics];
    const seen = new Set<string>();
    return all.filter((d) => {
      const k = `${d.code}|${d.nodeId || ''}|${d.pinId || ''}|${d.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* ---------------------------------------------------------- private */

  private indexOf(id: string): number {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`[grapesjs-scripts] no script "${id}"`);
    return i;
  }

  private nextName(): string {
    const base = this.hooks.defaultName?.() || 'Script';
    let n = this.items.length + 1;
    while (this.items.some((b) => b.name === `${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  private uniqueName(name: string): string {
    if (!this.items.some((b) => b.name === name)) return name;
    let n = 2;
    while (this.items.some((b) => b.name === `${name} ${n}`)) n++;
    return `${name} ${n}`;
  }

  private componentSpec(name: string, id: string, init: Partial<ComponentSpec> = {}, taken?: Set<string>): ComponentSpec {
    const used = taken || new Set(this.componentTypes(id));
    let type = init.type && isValidComponentType(init.type) && !used.has(init.type) ? init.type : '';
    if (!type) {
      const base = componentTypeFrom(name, id.replace(/^bp_/, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
      type = base;
      let n = 2;
      while (used.has(type)) type = `${base}-${n++}`;
    }
    return {
      type,
      label: init.label?.trim() || name,
      html: init.html ?? '<div class="bp-component"></div>',
      ...(init.css ? { css: init.css } : {}),
      params: Array.isArray(init.params) ? clone(init.params) : [],
    };
  }

  private setSettingsSilently(patch: Partial<ScriptsSettings>) {
    const hooks = this.hooks.onChange;
    (this.hooks as ManagerHooks).onChange = undefined;
    try {
      this.setSettings(patch);
    } finally {
      (this.hooks as ManagerHooks).onChange = hooks;
    }
  }
}
