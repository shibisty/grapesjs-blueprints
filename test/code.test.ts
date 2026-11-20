import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from 'blueprintsjs';
import { ScriptsManager } from '../src/core/ScriptsManager';
import { jsSyntaxError, normalizeCode, scopeIds, starterCode, targets } from '../src/core/code';

const mk = () => {
  const onChange = vi.fn();
  return { m: new ScriptsManager(createRegistry(), { onChange, copySuffix: () => 'copy' }), onChange };
};

describe('code items: model', () => {
  it('normalizes stored junk, drops what is not an item', () => {
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode({ lang: 'ts' })).toBeNull();
    const js = normalizeCode({ lang: 'js', kind: 'weird', run: 'later', code: 42, target: { pages: ['a', 3] } })!;
    expect(js).toMatchObject({ lang: 'js', kind: 'global', run: 'ready', code: '', enabled: true });
    expect(js.target).toBeUndefined(); // global: no target
    const tpl = normalizeCode({ lang: 'css', kind: 'template', target: { pages: ['a', 3, ''], when: ' body.x ' } })!;
    expect(tpl.target).toEqual({ pages: ['a'], when: 'body.x' });
    expect(tpl.run).toBeUndefined(); // CSS has no run time
    expect(normalizeCode({ lang: 'css', kind: 'component', target: { componentType: 'bp-tabs' } })!.target).toEqual({ componentType: 'bp-tabs' });
  });

  it('targets: a page, its layout or its template; empty = every page', () => {
    const page = { id: 'p1', layoutId: 'L', templateId: null };
    expect(scopeIds(page)).toEqual(['p1', 'L']);
    expect(targets(['L'], page)).toBe(true);
    expect(targets(['p1'], page)).toBe(true);
    expect(targets(['p2'], page)).toBe(false);
    expect(targets([], page)).toBe(true);
    expect(targets(['p1'], 'p1')).toBe(true); // editor.Pages id
    expect(targets(['p1'], undefined)).toBe(false);
  });

  it('checks JS syntax without running it; starters are valid', () => {
    expect(jsSyntaxError('let a = ;')).toMatch(/./);
    const ran = vi.fn();
    (globalThis as any).__ran = ran;
    expect(jsSyntaxError('__ran()')).toBeNull();
    expect(ran).not.toHaveBeenCalled();
    for (const kind of ['global', 'template', 'component'] as const) expect(jsSyntaxError(starterCode('js', kind))).toBeNull();
    expect(jsSyntaxError('return function(){}')).toBeNull(); // component code is a function body
  });
});

describe('code items: ScriptsManager', () => {
  it('creates, updates, duplicates, moves and removes; reports each change', () => {
    const { m, onChange } = mk();
    const a = m.createCode({ lang: 'js' });
    const b = m.createCode({ lang: 'css', kind: 'template', target: { pages: ['p1'] } });
    expect(a).toMatchObject({ name: 'JavaScript 1', lang: 'js', kind: 'global', run: 'ready' });
    expect(a.id).toMatch(/^js_/);
    expect(b).toMatchObject({ name: 'Styles 1', lang: 'css', target: { pages: ['p1'] } });
    expect(m.updateCode(a.id, { code: 'x()', run: 'load', lang: 'css' as any })).toMatchObject({ code: 'x()', run: 'load', lang: 'js' });
    const c = m.duplicateCode(a.id);
    expect(c.name).toBe('JavaScript 1 copy');
    expect(m.listCode().map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    m.moveCode(b.id, 0);
    expect(m.listCode().map((x) => x.id)).toEqual([b.id, a.id, c.id]);
    expect(m.listCode('css').map((x) => x.id)).toEqual([b.id]);
    expect(m.removeCode(c.id)).toBe(true);
    expect(m.removeCode('nope')).toBe(false);
    const actions = onChange.mock.calls.filter((x) => x[0] === 'code').map((x) => x[2].action);
    expect(actions).toEqual(['add', 'add', 'update', 'add', 'move', 'remove']);
    // A patch that changes nothing is not a change.
    onChange.mockClear();
    m.updateCode(a.id, { code: 'x()' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('component JS defines a component; its type is unique across blueprints and code', () => {
    const { m } = mk();
    const bp = m.create({ kind: 'component', name: 'Tabs' });
    const js = m.createCode({ lang: 'js', kind: 'component', name: 'Tabs' });
    expect(bp.component!.type).toBe('bp-tabs');
    expect(js.component!.type).toBe('bp-tabs-2');
    expect(m.componentTypes()).toEqual(['bp-tabs', 'bp-tabs-2']);
    // Taking a type that is used keeps the old one.
    expect(m.updateCode(js.id, { component: { ...js.component!, type: 'bp-tabs' } }).component!.type).toBe('bp-tabs-2');
    expect(m.update(bp.id, { component: { ...bp.component!, type: 'bp-tabs-2' } }).component!.type).toBe('bp-tabs');
    expect(m.createCode({ lang: 'js', kind: 'component' }).code).toContain('return function');
  });

  it('codeFor: global first, then the page’s (by page, layout or template id); components and disabled left out', () => {
    const { m } = mk();
    const g = m.createCode({ lang: 'js', name: 'g' });
    const forLayout = m.createCode({ lang: 'js', kind: 'template', name: 'layout', target: { pages: ['L'] } });
    const forOther = m.createCode({ lang: 'js', kind: 'template', name: 'other', target: { pages: ['p9'] } });
    const everyPage = m.createCode({ lang: 'js', kind: 'template', name: 'every', target: { pages: [] } });
    m.createCode({ lang: 'js', kind: 'component', name: 'comp' });
    const off = m.createCode({ lang: 'js', name: 'off' });
    m.updateCode(off.id, { enabled: false });
    m.createCode({ lang: 'css', name: 'css' });
    const page = { id: 'p1', layoutId: 'L' };
    expect(m.codeFor('js', { scope: page }).map((c) => c.name)).toEqual(['g', 'every', 'layout']);
    expect(m.codeFor('js', { scope: page, only: 'shared' }).map((c) => c.name)).toEqual(['g', 'every']);
    expect(m.codeFor('js', { scope: page, only: 'page' }).map((c) => c.name)).toEqual(['layout']);
    expect(m.codeFor('js', { pageId: 'p9', only: 'page' }).map((c) => c.id)).toEqual([forOther.id]);
    expect(m.codeFor('js', { scope: page, includeDisabled: true }).map((c) => c.name)).toContain('off');
    expect([g.id, forLayout.id, everyPage.id].length).toBe(3);
  });

  it('blueprints follow the same targets: a template blueprint for a layout reaches its pages', () => {
    const { m } = mk();
    m.create({ kind: 'template', name: 'for layout', target: { pages: ['L'] } });
    m.create({ kind: 'template', name: 'for p9', target: { pages: ['p9'] } });
    const names = (o: Parameters<ScriptsManager['build']>[0]) => m.build(o).blueprints.map((b: any) => b.name);
    expect(names({ scope: { id: 'p1', layoutId: 'L' } })).toEqual(['for layout']);
    expect(names({ scope: { id: 'p1', layoutId: 'L' }, only: 'page' })).toEqual(['for layout']);
    expect(names({ pageId: 'p9' })).toEqual(['for p9']);
  });

  it('stores and loads the code; old data without it loads; ids and component types are repaired', () => {
    const { m } = mk();
    const a = m.createCode({ lang: 'css', code: '.a{}' });
    m.create({ kind: 'component', name: 'Box' });
    const data = m.toJSON();
    expect(data.code!.map((c) => c.id)).toEqual([a.id]);
    const { m: m2 } = mk();
    m2.load(JSON.parse(JSON.stringify(data)));
    expect(m2.listCode()).toEqual(m.listCode());
    // Older data (no `code`): nothing breaks; and an empty list is not stored.
    const { m: m3 } = mk();
    m3.load({ schema: 1, blueprints: [], settings: {}, libraries: [] });
    expect(m3.listCode()).toEqual([]);
    expect(m3.toJSON()).not.toHaveProperty('code');
    // Repeated ids, a component type taken by a blueprint.
    const { m: m4 } = mk();
    m4.load({
      blueprints: [{ id: 'bp_1', name: 'Box', kind: 'component', component: { type: 'bp-box' }, nodes: [], links: [] }],
      code: [
        { id: 'x', lang: 'js', kind: 'component', name: 'Box', component: { type: 'bp-box' } },
        { id: 'x', lang: 'css', code: '' },
        { lang: 'nope' },
      ],
    });
    const list = m4.listCode();
    expect(list).toHaveLength(2);
    expect(new Set(list.map((c) => c.id)).size).toBe(2);
    expect(list[0].component!.type).toBe('bp-box-2');
  });
});
