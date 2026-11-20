import { vi } from 'vitest';
import type { WorkspaceLike } from '../../src/integration/workspace';

export type Doc = Parameters<WorkspaceLike['open']>[0] & { host?: HTMLElement; group: number };

/** A minimal stand-in for grapesjs-sidebar-tools' workspace (one area + the canvas tab). */
export function fakeWorkspace(remembered: string[] = []) {
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

