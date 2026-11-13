import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS } from '../src/events';
import { DOC_PREFIX, revealCanvas, type WorkspaceLike } from '../src/integration/workspace';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';

let s: Setup | undefined;
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
});

type Doc = Parameters<WorkspaceLike['open']>[0] & { host?: HTMLElement; group: number };

/** A minimal stand-in for grapesjs-sidebar-tools' workspace (one area + the canvas tab). */
function fakeWorkspace(remembered: string[] = []) {
  const docs = new Map<string, Doc>();
  docs.set('canvas', { id: 'canvas', title: 'Page', kind: 'canvas', group: 0 });
  let active = 'canvas';
  const show = (id: string) => {
    const d = docs.get(id)!;
    active = id;
    if (d.kind === 'element' && !d.host) {
      d.host = document.createElement('div');
      document.body.append(d.host);
      d.mount?.(d.host);
    }
    d.onShow?.();
  };
  const ws: WorkspaceLike & { docs: Map<string, Doc>; active(): string } = {
    docs,
    active: () => active,
    open: vi.fn((doc, o = {}) => {
      if (!docs.has(doc.id)) docs.set(doc.id, { ...doc, group: 0 });
      remembered = remembered.filter((id) => id !== doc.id);
      if (o.activate !== false) show(doc.id);
    }),
    update: vi.fn((id, patch) => {
      const d = docs.get(id);
      if (d) Object.assign(d, patch);
    }),
    activate: vi.fn((id) => docs.has(id) && show(id)),
    close: vi.fn((id, o = {}) => {
      const d = docs.get(id);
      if (!d) return false;
      if (!o.force && d.onClose?.() === false) return false;
      docs.delete(id);
      d.host?.remove();
      if (active === id) active = 'canvas';
      d.onClosed?.();
      return true;
    }),
    has: (id) => docs.has(id),
    list: () => Array.from(docs.values()).map((d) => ({ id: d.id, kind: d.kind || 'element', group: d.group, active: d.id === active })),
    remembered: (prefix) => remembered.filter((id) => id.startsWith(prefix)),
    canvasDoc: () => 'canvas',
  };
  return ws;
}

async function setup(remembered: string[] = [], plugin = {}) {
  s = await createEditor({ plugin });
  const ws = fakeWorkspace(remembered);
  (s.editor as any).SidebarTools = { workspace: ws, onReady: (cb: (w: WorkspaceLike) => void) => cb(ws) };
  s.editor.trigger('sidebar-tools:ready', { workspace: ws });
  await tick();
  return { ...s, ws };
}

const fullscreen = () => document.querySelector('body > .bpe');

describe('blueprint tabs (grapesjs-sidebar-tools)', () => {
  it('edit opens the graph editor in a tab, not over the page', async () => {
    const { editor, api, ws } = await setup();
    const bp = api.create({ name: 'Popup' });
    const ge = editor.runCommand(COMMANDS.edit, { id: bp.id });
    const doc = ws.docs.get(DOC_PREFIX + bp.id)!;
    expect(doc).toBeTruthy();
    expect(doc.kind).toBe('element');
    expect(doc.title).toBe('Popup');
    expect(ws.active()).toBe(DOC_PREFIX + bp.id);
    expect(ge).toBeTruthy();
    expect(doc.host!.querySelector('.bpe.bpe--embedded')).toBeTruthy();
    expect(fullscreen()).toBeNull();
    // editing again shows the same tab and editor
    expect(editor.runCommand(COMMANDS.edit, { id: bp.id })).toBe(ge);
    expect(doc.host!.querySelectorAll('.bpe')).toHaveLength(1);
  });

  it('several scripts, several tabs', async () => {
    const { editor, api, ws } = await setup();
    const a = api.create({ name: 'A' });
    const b = api.create({ name: 'B' });
    editor.runCommand(COMMANDS.edit, { id: a.id });
    editor.runCommand(COMMANDS.edit, { id: b.id });
    expect(Array.from(ws.docs.keys())).toEqual(['canvas', DOC_PREFIX + a.id, DOC_PREFIX + b.id]);
  });

  it('Done closes the tab; closing the tab closes the editor', async () => {
    const { editor, api, ws } = await setup();
    const a = api.create({ name: 'A' });
    const ge: any = editor.runCommand(COMMANDS.edit, { id: a.id });
    ge.close();
    expect(ws.has(DOC_PREFIX + a.id)).toBe(false);

    const ge2: any = editor.runCommand(COMMANDS.edit, { id: a.id });
    const closed = vi.fn();
    ge2.root.addEventListener('bpe:closed', closed);
    expect(ws.close(DOC_PREFIX + a.id)).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(ws.has(DOC_PREFIX + a.id)).toBe(false);
  });

  it('follows renames and removals', async () => {
    const { editor, api, ws } = await setup();
    const a = api.create({ name: 'A' });
    editor.runCommand(COMMANDS.edit, { id: a.id });
    api.rename(a.id, 'Renamed');
    expect(ws.docs.get(DOC_PREFIX + a.id)!.title).toBe('Renamed');
    api.remove(a.id);
    expect(ws.has(DOC_PREFIX + a.id)).toBe(false);
  });

  it('restores remembered tabs in the background', async () => {
    s = await createEditor();
    const a = s.api.create({ name: 'A' });
    const ws = fakeWorkspace([DOC_PREFIX + a.id, `${DOC_PREFIX}later`, 'page:x']);
    (s.editor as any).SidebarTools = { workspace: ws, onReady: () => undefined };
    s.editor.trigger('sidebar-tools:ready', { workspace: ws });
    await tick();
    expect(ws.has(DOC_PREFIX + a.id)).toBe(true);
    // not shown: no editor yet
    expect(ws.docs.get(DOC_PREFIX + a.id)!.host).toBeUndefined();
    expect(ws.active()).toBe('canvas');
    // unknown ids stay pending (retried on every change) and open nothing
    s.api.create({ name: 'Other' });
    expect(ws.open).toHaveBeenCalledTimes(1);
    // shown later: the editor is created then
    ws.activate(DOC_PREFIX + a.id);
    expect(ws.docs.get(DOC_PREFIX + a.id)!.host!.querySelector('.bpe')).toBeTruthy();
  });

  it('workspaceTabs: false keeps the full-screen editor', async () => {
    const { editor, api, ws } = await setup([], { workspaceTabs: false });
    const a = api.create({ name: 'A' });
    const ge: any = editor.runCommand(COMMANDS.edit, { id: a.id });
    expect(ws.open).not.toHaveBeenCalled();
    expect(fullscreen()).toBeTruthy();
    ge.close();
  });

  it('without sidebar-tools the editor covers the page as before', async () => {
    s = await createEditor();
    const a = s.api.create({ name: 'A' });
    const ge: any = s.editor.runCommand(COMMANDS.edit, { id: a.id });
    expect(fullscreen()).toBeTruthy();
    expect(fullscreen()!.classList.contains('bpe--embedded')).toBe(false);
    ge.close();
  });

  it('revealCanvas shows the canvas while picking when both share an area', () => {
    const ws = fakeWorkspace();
    ws.open({ id: 'blueprint:x', title: 'X', kind: 'element' });
    const back = revealCanvas(ws, 'blueprint:x');
    expect(ws.active()).toBe('canvas');
    back();
    expect(ws.active()).toBe('blueprint:x');
    // different areas: nothing to do
    ws.docs.get('blueprint:x')!.group = 1;
    revealCanvas(ws, 'blueprint:x');
    expect(ws.active()).toBe('blueprint:x');
  });
});
