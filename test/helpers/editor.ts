import grapesjs, { type Editor } from 'grapesjs';
import scriptsPlugin, { getScripts, type ScriptsApi, type ScriptsPluginOptions } from '../../src/index';

export interface Setup {
  editor: Editor;
  api: ScriptsApi;
}

/** A real GrapesJS editor in jsdom with the plugin. */
export async function createEditor(o: { plugin?: ScriptsPluginOptions; config?: Record<string, unknown>; html?: string } = {}): Promise<Setup> {
  const container = document.createElement('div');
  container.id = 'gjs';
  document.body.append(container);
  const editor = grapesjs.init({
    container,
    height: '600px',
    storageManager: false,
    telemetry: false,
    components: o.html ?? '<button class="js-popup-open">Open</button><div id="popup" class="popup"><button class="js-popup-close">×</button></div>',
    plugins: [(ed: Editor) => scriptsPlugin(ed, o.plugin)],
    ...o.config,
  } as Parameters<typeof grapesjs.init>[0]);
  // Wait for the editor to be ready (the plugin mounts its UI in onReady).
  for (let i = 0; i < 200 && !(editor as any).getModel().get('ready'); i++) await tick(5);
  await tick();
  return { editor, api: getScripts(editor)! };
}

export async function destroyEditor(editor: Editor | undefined): Promise<void> {
  if (!editor) return;
  try {
    editor.select([]);
  } catch {
    /* gone */
  }
  await tick(30);
  try {
    editor.destroy();
  } catch {
    /* jsdom teardown noise */
  }
  document.body.innerHTML = '';
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function click(el: Element | null | undefined): void {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

export const sidebar = () => document.querySelector<HTMLElement>('.gjscr')!;
export const modal = () => document.querySelector<HTMLElement>('.gjs-mdl-container');
export const modalOpen = () => {
  const m = modal();
  return !!m && getComputedStyle(m).display !== 'none' && m.style.display !== 'none';
};
