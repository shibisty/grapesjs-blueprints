import type { PluginMeta } from './contract';
import type { NodeDef } from 'blueprintsjs';
import type { OutputTools } from './core/output';
import type { FetchLike } from './libs/providers';
import type { ScriptsLabels } from './i18n/types';

export interface ScriptsPluginOptions {
  /** Panel with the view buttons (Layers/Styles…); auto-detected when null. */
  panelId?: string | null;
  /** CSS selector of the element the sidebar goes into; auto-detected when null. */
  container?: string | null;
  /** Older name of `container`. */
  sidebarContainer?: string | null;
  /** Your own nodes (same `type` as a built-in replaces it). */
  nodes?: NodeDef[];
  /** Label overrides (win over `editor.I18n`). */
  labels?: Partial<ScriptsLabels>;
  /** Graph editor text overrides by key (`ui.*`, `node.<type>`, `desc.<type>`, `cat.<id>`, `label.<English>`). */
  graphLabels?: Record<string, string>;
  /** Inject the plugin CSS. @default true */
  injectCss?: boolean;
  /** Key in the project data. @default 'scripts' */
  storageKey?: string;
  /** CDN library search. */
  libraries?: {
    /** CORS proxy URL (`proxy/libs-proxy.php`); requests go to `<proxy>?url=…`. @default false */
    proxy?: string | false;
    fetch?: FetchLike;
    /** @default 15000 */
    timeout?: number;
  };
  /** Minify/obfuscate tools: your own functions, or other URLs of the CDN builds. */
  output?: { tools?: OutputTools; urls?: { terser?: string; obfuscator?: string } };
  /** Run the scripts in the GrapesJS preview (`core:preview`). @default true */
  preview?: boolean;
  /** Wrap `editor.getHtml()` so it carries the script/library tags (see the `includeInHtml` setting). @default true */
  exportHtml?: boolean;
  /** Block Manager category of component scripts (default: translated "Scripts"). */
  blocksCategory?: string;
  /**
   * With grapesjs-sidebar-tools 2.2+: open the blueprint editor as a tab of
   * its workspace (next to the canvas, several at once) instead of over the
   * whole page. Without sidebar-tools the editor covers the page as before.
   * @default true
   */
  workspaceTabs?: boolean;
  /**
   * With grapesjs-site-pages 2.7+ (every record a whole project): keep the
   * scripts once per site instead of in every page (`shared.register`).
   * Default true; false keeps the old per-page copies.
   */
  sharedWithPages?: boolean;
}

export type ResolvedOptions = Required<Omit<ScriptsPluginOptions, 'labels' | 'nodes' | 'graphLabels' | 'libraries' | 'output' | 'blocksCategory' | 'container'>> & {
  libraries: NonNullable<ScriptsPluginOptions['libraries']>;
  output: NonNullable<ScriptsPluginOptions['output']>;
  blocksCategory?: string;
  labels: Partial<ScriptsLabels>;
  graphLabels: Record<string, string>;
  nodes: NodeDef[];
};

export function resolveOptions(o: ScriptsPluginOptions = {}): ResolvedOptions {
  return {
    panelId: o.panelId ?? null,
    sidebarContainer: o.container ?? o.sidebarContainer ?? null,
    nodes: Array.isArray(o.nodes) ? o.nodes : [],
    labels: { ...(o.labels || {}) },
    graphLabels: o.graphLabels || {},
    injectCss: o.injectCss !== false,
    storageKey: o.storageKey || 'scripts',
    libraries: o.libraries || {},
    output: o.output || {},
    preview: o.preview !== false,
    exportHtml: o.exportHtml !== false,
    workspaceTabs: o.workspaceTabs !== false,
    sharedWithPages: o.sharedWithPages !== false,
    blocksCategory: o.blocksCategory,
  } as ResolvedOptions;
}

export const PLUGIN_ID = 'grapesjs-blueprints';
/** Version of this package (a test checks it against package.json). */
export const VERSION = '0.3.0';

/** Options for forms (plugin contract). Changes apply after a reload. */
export const META: PluginMeta = {
  id: PLUGIN_ID,
  version: VERSION,
  title: 'Blueprints',
  description: 'Visual scripts (blueprints), JavaScript and CSS of the site, CDN libraries.',
  options: [
    {
      key: 'libraries',
      type: 'json',
      default: {},
      title: 'Library search',
      description: '{ "proxy": "/plugins/grapesjs-scripts/proxy/libs-proxy.php", "timeout": 15000 }',
    },
    { key: 'preview', type: 'boolean', default: true, title: 'Run scripts in the preview' },
    { key: 'exportHtml', type: 'boolean', default: true, title: 'Script tags in getHtml()' },
    { key: 'workspaceTabs', type: 'boolean', default: true, title: 'Editors as workspace tabs', description: 'With grapesjs-sidebar-tools.' },
    { key: 'sharedWithPages', type: 'boolean', default: true, title: 'One set of scripts per site', description: 'With grapesjs-site-pages 2.7+.' },
    { key: 'blocksCategory', type: 'string', default: '', title: 'Block category of components', description: 'Empty — "Scripts".' },
    { key: 'output', type: 'json', default: {}, title: 'Minify/obfuscate tools', description: '{ "urls": { "terser": "…", "obfuscator": "…" } }', advanced: true },
    { key: 'storageKey', type: 'string', default: 'scripts', title: 'Key in the project data', advanced: true },
    { key: 'panelId', type: 'string', default: '', title: 'Panel of the "Scripts" button', description: 'Empty — auto.', advanced: true },
    { key: 'container', type: 'string', default: '', title: 'Sidebar container (CSS selector)', description: 'Empty — auto.', aliases: ['sidebarContainer'], advanced: true },
    { key: 'labels', type: 'json', default: {}, title: 'Texts', advanced: true },
    { key: 'graphLabels', type: 'json', default: {}, title: 'Graph editor texts', advanced: true },
    { key: 'injectCss', type: 'boolean', default: true, title: 'Inject CSS', advanced: true },
  ],
};

/** The options a form can show (no functions or node definitions). */
export function publicOptions(o: ResolvedOptions): Record<string, unknown> {
  const libs = o.libraries || {};
  const out = o.output || {};
  return {
    libraries: {
      ...(libs.proxy !== undefined ? { proxy: libs.proxy } : {}),
      ...(libs.timeout !== undefined ? { timeout: libs.timeout } : {}),
    },
    preview: o.preview,
    exportHtml: o.exportHtml,
    workspaceTabs: o.workspaceTabs,
    sharedWithPages: o.sharedWithPages,
    blocksCategory: o.blocksCategory || '',
    output: out.urls ? { urls: { ...out.urls } } : {},
    storageKey: o.storageKey,
    panelId: o.panelId || '',
    container: o.sidebarContainer || '',
    labels: { ...o.labels },
    graphLabels: { ...o.graphLabels },
    injectCss: o.injectCss,
  };
}
