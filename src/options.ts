import type { NodeDef } from './blueprint';
import type { OutputTools } from './core/output';
import type { FetchLike } from './libs/providers';
import type { ScriptsLabels } from './i18n/types';

export interface ScriptsPluginOptions {
  /** Panel with the view buttons (Layers/Styles…); auto-detected when null. */
  panelId?: string | null;
  /** CSS selector of the element the sidebar goes into; auto-detected when null. */
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
}

export type ResolvedOptions = Required<Omit<ScriptsPluginOptions, 'labels' | 'nodes' | 'graphLabels' | 'libraries' | 'output' | 'blocksCategory'>> & {
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
    sidebarContainer: o.sidebarContainer ?? null,
    nodes: Array.isArray(o.nodes) ? o.nodes : [],
    labels: o.labels || {},
    graphLabels: o.graphLabels || {},
    injectCss: o.injectCss !== false,
    storageKey: o.storageKey || 'scripts',
    libraries: o.libraries || {},
    output: o.output || {},
    preview: o.preview !== false,
    exportHtml: o.exportHtml !== false,
    workspaceTabs: o.workspaceTabs !== false,
    blocksCategory: o.blocksCategory,
  } as ResolvedOptions;
}
