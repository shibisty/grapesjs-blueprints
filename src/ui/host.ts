import type { Editor } from 'grapesjs';

type Panel = ReturnType<Editor['Panels']['getPanels']>['models'][number];

/** Commands of the usual "views" switcher buttons across GrapesJS builds and presets. */
const SWITCH_CMD_RE = /^(open|show)-(sm|styles?|layers?|blocks?|tm|traits?)$/i;

/**
 * The panel holding the view-switcher buttons — found by the commands of its buttons (its id
 * differs between builds), falling back to well-known ids. Same logic as grapesjs-pages.
 */
export function findHostPanel(editor: Editor, panelId: string | null): Panel | undefined {
  const Panels = editor.Panels;
  if (panelId) return Panels.getPanel(panelId) || undefined;
  const byCommand = Panels.getPanels().find((p: Panel) =>
    (p.get('buttons') as any)?.some((b: any) => {
      const cmd = b.get('command');
      const cmdId = typeof cmd === 'string' ? cmd : b.id;
      return SWITCH_CMD_RE.test(cmdId || '') || SWITCH_CMD_RE.test(b.id || '');
    }),
  );
  if (byCommand) return byCommand;
  return ['views', 'panel-switcher', 'options'].map((id) => Panels.getPanel(id)).find(Boolean) || undefined;
}

export type SidebarMode = 'inline' | 'floating';

/** Where the sidebar goes: explicit selector → views container → `.panel__right` → floating. */
export function findSidebarHost(editor: Editor, selector: string | null): { el: HTMLElement; mode: SidebarMode } {
  const c = editor.getContainer() as HTMLElement;
  if (selector) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return { el, mode: 'inline' };
    console.warn('[grapesjs-scripts] sidebarContainer "%s" not found, falling back to auto-detection', selector);
  }
  const views = c.querySelector<HTMLElement>('.gjs-pn-views-container');
  if (views) return { el: views, mode: 'inline' };
  const right = c.querySelector<HTMLElement>('.panel__right');
  if (right) return { el: right, mode: 'inline' };
  return { el: c, mode: 'floating' };
}
