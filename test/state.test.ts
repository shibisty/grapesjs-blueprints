import { describe, expect, it, vi } from 'vitest';
import { GraphState } from '../src/blueprint/editor/state';
import { POPUP_BLUEPRINT } from './fixtures/popup';
import { graph, registry } from './helpers/run';

const mk = (bp = graph([])) => new GraphState(bp, registry);

describe('GraphState', () => {
  it('adds nodes with short ids, defaults and grid snapping; selects the new node', () => {
    const s = mk();
    const a = s.addNode('event.element', [13, 21]);
    const b = s.addNode('dom.addClass', [200, 0]);
    expect([a, b]).toEqual(['n1', 'n2']);
    expect(s.node(a)!.pos).toEqual([16, 24]);
    expect(s.node(a)!.props).toMatchObject({ event: 'click', selector: '' });
    expect([...s.selection]).toEqual(['n2']);
    expect(() => s.addNode('nope', [0, 0])).toThrow();
  });

  it('connects with type checks; one wire per data input and per exec output', () => {
    const s = mk();
    const ev = s.addNode('event.element', [0, 0]);
    const a = s.addNode('dom.addClass', [300, 0]);
    const b = s.addNode('dom.removeClass', [300, 200]);
    const num = s.addNode('data.number', [0, 200]);
    expect(s.connect([ev, 'then'], [a, 'exec'])).toBe(true);
    expect(s.connect([ev, 'then'], [b, 'exec'])).toBe(true); // replaces
    expect(s.bp.links).toEqual([{ from: [ev, 'then'], to: [b, 'exec'] }]);
    expect(s.connect([num, 'value'], [a, 'target'])).toBe(false); // number → elements
    expect(s.connect([ev, 'self'], [a, 'target'])).toBe(true);
    expect(s.connect([ev, 'self'], [b, 'target'])).toBe(true); // data outputs fan out
    expect(s.connect([a, 'then'], [a, 'exec'])).toBe(false); // same node
    expect(s.bp.links).toHaveLength(3);
    s.disconnect([ev, 'self'], 'out');
    expect(s.bp.links).toHaveLength(1);
  });

  it('undo / redo, one step per drag gesture', () => {
    const s = mk();
    const a = s.addNode('debug.log', [0, 0]);
    s.begin();
    s.moveBy([a], 10, 0);
    s.moveBy([a], 10, 5);
    s.end();
    expect(s.node(a)!.pos).toEqual([20, 5]);
    expect(s.undo()).toBe(true);
    expect(s.node(a)!.pos).toEqual([0, 0]);
    expect(s.undo()).toBe(true);
    expect(s.node(a)).toBeUndefined();
    expect(s.selection.size).toBe(0);
    expect(s.canUndo).toBe(false);
    s.redo();
    s.redo();
    expect(s.node(a)!.pos).toEqual([20, 5]);
    // no-op changes leave no history
    s.setProps(a, {});
    s.begin();
    s.end();
    expect(s.undo()).toBe(true);
    expect(s.node(a)!.pos).toEqual([0, 0]);
  });

  it('deleting nodes removes their wires; a selected wire can be deleted alone', () => {
    const s = mk(POPUP_BLUEPRINT);
    s.select(['show']);
    s.deleteSelection();
    expect(s.bp.nodes.map((n) => n.id)).toEqual(['open', 'close', 'hide']);
    expect(s.bp.links).toEqual([{ from: ['close', 'then'], to: ['hide', 'exec'] }]);
    s.selectLink(s.bp.links[0]);
    s.deleteSelection();
    expect(s.bp.links).toEqual([]);
  });

  it('dynamic pins: wires to vanished pins are dropped', () => {
    const s = mk();
    const seq = s.addNode('flow.sequence', [0, 0], { count: 3 });
    const log = s.addNode('debug.log', [200, 0]);
    s.connect([seq, 'then2'], [log, 'exec']);
    s.setProps(seq, { count: 2 });
    expect(s.bp.links).toEqual([]);
  });

  it('copy / paste with new ids and inner wires only', () => {
    const s = mk(POPUP_BLUEPRINT);
    s.select(['open', 'show']);
    const clip = s.copy()!;
    expect(clip.links).toEqual([{ from: ['open', 'then'], to: ['show', 'exec'] }]);
    const ids = s.paste(JSON.parse(JSON.stringify(clip)), [1000, 1000]);
    expect(ids).toEqual(['n5', 'n6']);
    expect(s.node('n5')!.pos).toEqual([1000, 1000]);
    expect(s.node('n6')!.pos).toEqual([1320, 1000]);
    expect(s.bp.links).toContainEqual({ from: ['n5', 'then'], to: ['n6', 'exec'] });
    expect([...s.selection]).toEqual(ids);
    expect(s.paste({ bpClip: 1, nodes: [{ id: 'x', type: 'ghost', pos: [0, 0] }], links: [], comments: [] }, [0, 0])).toEqual([]);
  });

  it('variables and meta', () => {
    const s = mk();
    const v = s.addVariable({ name: 'isOpen', type: 'boolean', default: false });
    const w = s.addVariable({ name: 'isOpen' });
    expect(w.name).toBe('isOpen2');
    s.updateVariable(v.id, { name: 'open' });
    s.removeVariable(w.id);
    expect(s.bp.variables).toEqual([{ id: v.id, name: 'open', type: 'boolean', default: false }]);
    s.setMeta({ name: 'Renamed', enabled: false });
    expect(s.toJSON()).toMatchObject({ name: 'Renamed', enabled: false });
  });

  it('comments: add, move without history, delete', () => {
    const s = mk();
    const c = s.addComment([5, 5], [300, 200], 'Popup');
    expect(s.comment(c)).toMatchObject({ text: 'Popup', pos: [8, 8], size: [304, 200] });
    s.begin();
    s.updateComment(c, { pos: [40, 40] }, { history: false });
    s.end();
    s.undo();
    expect(s.comment(c)!.pos).toEqual([8, 8]);
    s.select([], { comments: [c] });
    s.deleteSelection();
    expect(s.toJSON().comments).toBeUndefined();
  });

  it('emits change kinds and caches diagnostics per version', () => {
    const s = mk();
    const fn = vi.fn();
    s.on(fn);
    s.addNode('dom.addClass', [0, 0]);
    expect(fn).toHaveBeenCalledWith('graph');
    expect(fn).toHaveBeenCalledWith('selection');
    const d1 = s.diagnostics();
    expect(s.diagnostics()).toBe(d1);
    expect(d1.map((d) => d.code)).toContain('required-input');
  });
});
