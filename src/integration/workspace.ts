import type { Editor } from 'grapesjs';

/**
 * Blueprint editors as document tabs of the grapesjs-sidebar-tools
 * workspace (2.2+). Only the parts of `editor.SidebarTools.workspace` used
 * here are typed, so there is no dependency on sidebar-tools: without it
 * the editor opens over the whole page as before.
 */
export interface WorkspaceLike {
  open(
    doc: {
      id: string;
      title: string;
      icon?: string;
      tooltip?: string;
      kind?: 'canvas' | 'element';
      mount?(container: HTMLElement): void;
      onShow?(): void;
      onClose?(): boolean | void;
      onClosed?(): void;
    },
    opts?: { activate?: boolean; notify?: boolean },
  ): void;
  update(id: string, patch: { title?: string; tooltip?: string; dirty?: boolean }): void;
  activate(id: string, opts?: { notify?: boolean }): void;
  close(id: string, opts?: { force?: boolean; notify?: boolean }): boolean;
  has(id: string): boolean;
  list(): Array<{ id: string; kind: 'canvas' | 'element'; group: number; active: boolean }>;
  remembered(prefix: string): string[];
  canvasDoc(): string | null;
}

interface SidebarToolsLike {
  workspace: WorkspaceLike | null;
  onReady(cb: (ws: WorkspaceLike) => void): void;
}

export const DOC_PREFIX = 'blueprint:';
export const docId = (scriptId: string) => `${DOC_PREFIX}${scriptId}`;

/** The workspace if grapesjs-sidebar-tools has created it already. */
export function currentWorkspace(editor: Editor): WorkspaceLike | null {
  return (editor as unknown as { SidebarTools?: SidebarToolsLike }).SidebarTools?.workspace || null;
}

/** Calls back once the workspace exists (never without sidebar-tools). */
export function onWorkspace(editor: Editor, cb: (ws: WorkspaceLike) => void): void {
  const tools = (editor as unknown as { SidebarTools?: SidebarToolsLike }).SidebarTools;
  if (tools && typeof tools.onReady === 'function') return tools.onReady(cb);
  const once = (data?: { workspace?: WorkspaceLike }) => {
    editor.off('sidebar-tools:ready', once);
    if (data?.workspace) cb(data.workspace);
  };
  editor.on('sidebar-tools:ready', once);
}

/**
 * While picking a selector in the canvas: if the blueprint tab hides the
 * canvas (same area), show the canvas tab meanwhile; returns how to go back.
 */
export function revealCanvas(ws: WorkspaceLike, id: string): () => void {
  const docs = ws.list();
  const me = docs.find((d) => d.id === id);
  const canvas = ws.canvasDoc();
  const cv = canvas ? docs.find((d) => d.id === canvas) : null;
  if (!me || !cv || me.group !== cv.group) return () => undefined;
  ws.activate(cv.id, { notify: false });
  return () => {
    if (ws.has(id)) ws.activate(id, { notify: false });
  };
}
