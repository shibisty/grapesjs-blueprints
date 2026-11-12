import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../src/blueprint';
import { DEFAULT_SETTINGS, ScriptsManager, componentTypeFrom, isValidComponentType } from '../src/core/ScriptsManager';
import { POPUP_BLUEPRINT } from './fixtures/popup';

const mk = () => {
  const onChange = vi.fn();
  return { m: new ScriptsManager(createRegistry(), { onChange, defaultName: () => 'Скрипт', copySuffix: () => 'копия' }), onChange };
};

describe('ScriptsManager', () => {
  it('creates scripts with starter nodes and automatic names', () => {
    const { m, onChange } = mk();
    const a = m.create();
    const b = m.create({ kind: 'component', name: 'Аккордеон' });
    const c = m.create({ kind: 'template', target: { pages: ['p2'], when: 'body.x' } });
    expect(a.name).toBe('Скрипт 1');
    expect(a.nodes[0].type).toBe('event.element');
    expect(b.nodes[0].type).toBe('event.start');
    expect(b.component!.type).toMatch(/^bp-[a-z0-9]+$/); // Cyrillic name → id-based type
    expect(c.target).toEqual({ pages: ['p2'], when: 'body.x' });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(m.list().map((x) => x.kind)).toEqual(['global', 'component', 'template']);
  });

  it('component types are valid and unique; duplicates get new ones', () => {
    const { m } = mk();
    const a = m.create({ kind: 'component', name: 'My Tabs' });
    const b = m.create({ kind: 'component', name: 'My tabs!' });
    expect(a.component!.type).toBe('bp-my-tabs');
    expect(b.component!.type).toBe('bp-my-tabs-2');
    const c = m.duplicate(a.id);
    expect(c.name).toBe('My Tabs копия');
    expect(new Set(m.componentTypes()).size).toBe(3);
    expect(m.list().map((x) => x.id).indexOf(c.id)).toBe(1); // right after the original
    // an update can not steal a taken type
    const u = m.update(b.id, { component: { ...b.component!, type: 'bp-my-tabs' } });
    expect(u.component!.type).toBe('bp-my-tabs-2');
  });

  it('update keeps id, drops fields that do not belong to the kind, skips no-op changes', () => {
    const { m, onChange } = mk();
    const t = m.create({ kind: 'template', target: { when: '.x' } });
    onChange.mockClear();
    m.update(t.id, { name: t.name });
    expect(onChange).not.toHaveBeenCalled();
    const g = m.update(t.id, { kind: 'global', id: 'hacked' } as any);
    expect(g.id).toBe(t.id);
    expect(g.target).toBeUndefined();
    expect(m.update(t.id, (bp) => ({ ...bp, nodes: POPUP_BLUEPRINT.nodes, links: POPUP_BLUEPRINT.links })).nodes).toHaveLength(4);
  });

  it('returned objects are copies', () => {
    const { m } = mk();
    const a = m.create({ name: 'A' });
    a.name = 'mutated';
    m.list()[0].nodes.push({ id: 'x', type: 'debug.log', pos: [0, 0] });
    expect(m.get(a.id)!.name).toBe('A');
    expect(m.get(a.id)!.nodes).toHaveLength(1);
  });

  it('round-trips through JSON and cleans junk on load', () => {
    const { m, onChange } = mk();
    m.create({ name: 'A' });
    m.create({ kind: 'component', name: 'C' });
    m.setSettings({ output: 'inline', minify: true });
    const data = JSON.parse(JSON.stringify(m.toJSON()));
    const { m: m2 } = mk();
    m2.load(data);
    expect(m2.toJSON()).toEqual(data);
    onChange.mockClear();
    m2.load({ blueprints: [{ id: 'same', kind: 'component', component: { type: 'BAD TYPE' } }, { id: 'same' }, null], settings: { output: 'weird', fileName: '' } });
    const list = m2.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).not.toBe(list[1].id);
    expect(isValidComponentType(list[0].component!.type)).toBe(true);
    expect(m2.settings).toEqual({ ...DEFAULT_SETTINGS });
    m2.load(undefined);
    expect(m2.size).toBe(0);
  });

  it('builds the page script with template scripts filtered by page', () => {
    const { m } = mk();
    m.create({ name: 'G', nodes: POPUP_BLUEPRINT.nodes, links: POPUP_BLUEPRINT.links });
    m.create({ name: 'T', kind: 'template', target: { pages: ['product'] } });
    m.create({ name: 'Any', kind: 'template' });
    const off = m.create({ name: 'Off' });
    m.setEnabled(off.id, false);
    const ids = (pageId?: string) => m.build({ pageId }).blueprints.map((b) => b.name);
    expect(ids()).toEqual(['G', 'T', 'Any']);
    expect(ids('home')).toEqual(['G', 'Any']);
    expect(ids('product')).toEqual(['G', 'T', 'Any']);
    expect(m.codeOf(off.id).code).toContain('"Off"'.slice(1, -1));
  });

  it('component code is a standalone function; diagnostics merge duplicates', () => {
    const { m } = mk();
    const c = m.create({ kind: 'component', name: 'Tabs' });
    const { code } = m.codeOf(c.id);
    expect(code).toMatch(/^\/\* bp-tabs: /);
    const g = m.create({ name: 'Broken', nodes: [{ id: 'x', type: 'nope', pos: [0, 0] }] });
    const d = m.diagnostics(g.id);
    expect(d.filter((x) => x.code === 'unknown-node')).toHaveLength(1);
  });

  it('component types from names', () => {
    expect(componentTypeFrom('Hero Slider', 'x')).toBe('bp-hero-slider');
    expect(componentTypeFrom('Café crème', 'x')).toBe('bp-cafe-creme');
    expect(componentTypeFrom('Слайдер', 'abc')).toBe('bp-abc');
    expect(isValidComponentType('bp-x')).toBe(true);
    expect(isValidComponentType('bpx')).toBe(false);
    expect(isValidComponentType('Bp-x')).toBe(false);
  });
});
