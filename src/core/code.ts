import { uid, type BlueprintKind, type ComponentSpec, type TemplateTarget } from 'blueprintsjs';

/**
 * Hand-written JavaScript and CSS, next to the blueprints. Same kinds and
 * the same targets as blueprints, so the build, the preview and the export
 * treat all three alike:
 *
 * - `global`    every page;
 * - `template`  the records in `target.pages` (with grapesjs-site-pages a
 *               page, a layout — every page put into it — or a template —
 *               its entries; without it, ids of `editor.Pages`), plus the
 *               runtime condition `target.when` (a selector);
 * - `component` JS: defines a component (its own type, block, HTML, CSS,
 *               parameters) whose code runs once per instance as
 *               `function (root, params)` and may return a cleanup.
 *               CSS: styles of a component type (`target.componentType`,
 *               a blueprint's or a JS item's), exported only with pages
 *               that use the component.
 */
export type CodeLang = 'js' | 'css';

/** When page JS runs: right away, on DOMContentLoaded, or on window load. */
export type CodeRun = 'now' | 'ready' | 'load';

export interface CodeTarget extends TemplateTarget {
  /** CSS of kind `component`: the component type it styles. */
  componentType?: string;
}

export interface CodeItem {
  id: string;
  name: string;
  lang: CodeLang;
  kind: BlueprintKind;
  enabled: boolean;
  description?: string;
  /** The source. */
  code: string;
  /** JS of kind global/template. Default `ready`. */
  run?: CodeRun;
  /** Kind `template` (pages, when); CSS of kind `component` (componentType). */
  target?: CodeTarget;
  /** JS of kind `component`: the component it defines. */
  component?: ComponentSpec;
}

export interface CreateCodeInit {
  name?: string;
  lang: CodeLang;
  kind?: BlueprintKind;
  code?: string;
  run?: CodeRun;
  target?: CodeTarget;
  component?: Partial<ComponentSpec>;
  description?: string;
}

const KINDS: BlueprintKind[] = ['global', 'template', 'component'];
const RUNS: CodeRun[] = ['now', 'ready', 'load'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

/** Default source of a new item: a short, valid example of each kind. */
export function starterCode(lang: CodeLang, kind: BlueprintKind): string {
  if (lang === 'css') {
    return kind === 'component' ? '/* Styles of the component */\n' : '/* Styles */\n';
  }
  if (kind === 'component') {
    return [
      '// Runs once per instance: `root` is the element, `params` its parameters.',
      "// Return a function to clean up (the preview calls it when it stops).",
      'root.addEventListener("click", onClick);',
      'function onClick() {}',
      'return function () {',
      '  root.removeEventListener("click", onClick);',
      '};',
      '',
    ].join('\n');
  }
  return '// Your JavaScript. `document` is the page.\n';
}

/** Makes any stored value a valid item (junk is fixed or defaulted); `null` if it cannot be one. */
export function normalizeCode(raw: unknown): CodeItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lang: CodeLang | null = r.lang === 'js' || r.lang === 'css' ? r.lang : null;
  if (!lang) return null;
  const kind: BlueprintKind = KINDS.includes(r.kind as BlueprintKind) ? (r.kind as BlueprintKind) : 'global';
  const item: CodeItem = {
    id: str(r.id) || uid(lang),
    name: str(r.name).trim() || (lang === 'css' ? 'Styles' : 'Script'),
    lang,
    kind,
    enabled: r.enabled !== false,
    code: str(r.code),
  };
  const description = str(r.description).trim();
  if (description) item.description = description;
  if (lang === 'js' && kind !== 'component') item.run = RUNS.includes(r.run as CodeRun) ? (r.run as CodeRun) : 'ready';
  const t = (r.target && typeof r.target === 'object' ? r.target : {}) as Record<string, unknown>;
  if (kind === 'template') {
    item.target = { pages: strList(t.pages) };
    const when = str(t.when).trim();
    if (when) item.target.when = when;
  }
  if (kind === 'component' && lang === 'css') {
    item.target = { componentType: str(t.componentType).trim() };
  }
  if (kind === 'component' && lang === 'js' && r.component && typeof r.component === 'object') {
    item.component = JSON.parse(JSON.stringify(r.component)) as ComponentSpec;
  }
  return item;
}

/** The ids a record answers to: itself, its layout, its template (grapesjs-site-pages). */
export interface PageScope {
  /** Id of the page (`editor.Pages` page, or a record of grapesjs-site-pages). */
  id: string;
  layoutId?: string | null;
  templateId?: string | null;
  /** A data record (grapesjs-storage) of that page: rules about the page hold for it too. */
  dataOf?: string | null;
  /** The record is a linked component of grapesjs-site-pages (not a page). */
  kind?: string;
  /** Linked components (grapesjs-site-pages) used on the page. */
  components?: string[];
}

/** The page ids a scope answers to: the page, its layout, its template, the page of a data record (not for a component record). */
export const scopeIds = (s: PageScope | string | undefined): string[] => {
  if (!s) return [];
  if (typeof s === 'string') return [s];
  if (s.kind === 'component') return [];
  return [s.id, s.layoutId, s.templateId, s.dataOf].filter((x): x is string => !!x);
};

/** The linked components a scope answers to: the component record itself and the ones it uses. */
export const scopeComponents = (s: PageScope | string | undefined): string[] => {
  if (!s || typeof s === 'string') return [];
  return [...(s.kind === 'component' ? [s.id] : []), ...(s.components || [])];
};

/**
 * A condition of a "unique" item (blueprint, JS, CSS, library): the page
 * (with its layout and template) or a linked component of grapesjs-site-pages
 * is / is not the given one. "Is" conditions are joined with OR, "is not"
 * ones with AND.
 */
export interface ScopeRule {
  on: 'page' | 'component';
  op: 'eq' | 'ne';
  id: string;
}

/**
 * Rules are stored as strings in `target.pages` (blueprints, code) and
 * `pages` (libraries), so stored data stays valid for blueprintsjs:
 * `<id>` = page is, `!<id>` = page is not, `component:<id>`,
 * `!component:<id>`. A plain id is what older versions stored.
 */
export function parseRule(s: string): ScopeRule {
  const ne = s.startsWith('!');
  const rest = ne ? s.slice(1) : s;
  const comp = rest.startsWith('component:');
  return { on: comp ? 'component' : 'page', op: ne ? 'ne' : 'eq', id: comp ? rest.slice('component:'.length) : rest };
}

export function ruleString(r: ScopeRule): string {
  return `${r.op === 'ne' ? '!' : ''}${r.on === 'component' ? 'component:' : ''}${r.id}`;
}

export const parseRules = (list: string[] | undefined): ScopeRule[] => (list || []).filter(Boolean).map(parseRule);

/**
 * Is an item with these rules meant for this scope? No rules — everywhere.
 * Any "is not" that holds excludes; when there are "is" rules, one must hold.
 */
export function targets(pages: string[] | undefined, scope: PageScope | string | undefined): boolean {
  if (!pages?.length) return true;
  const ids = scopeIds(scope);
  const comps = scopeComponents(scope);
  const holds = (r: ScopeRule) => (r.on === 'page' ? ids : comps).includes(r.id);
  const rules = parseRules(pages);
  if (rules.some((r) => r.op === 'ne' && holds(r))) return false;
  const eqs = rules.filter((r) => r.op === 'eq');
  return !eqs.length || eqs.some(holds);
}

/**
 * A syntax check of JS without running it (`new Function` only parses).
 * Returns the parser's message, or null when it parses. Component code is
 * a function body (`return` allowed), like page code inside its wrapper.
 */
export function jsSyntaxError(code: string): string | null {
  try {
    // eslint-disable-next-line no-new-func
    new Function('root', 'params', code);
    return null;
  } catch (e) {
    return (e as Error)?.message || String(e);
  }
}
