import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphEditor } from '../src/blueprint';
import { POPUP_BLUEPRINT } from './fixtures/popup';
import { graph, registry } from './helpers/run';

let ed: GraphEditor | undefined;
afterEach(() => {
  ed?.destroy();
  ed = undefined;
  localStorage.clear();
});

const mk = (bp = graph([]), o: Partial<ConstructorParameters<typeof GraphEditor>[0]> = {}) => {
  ed = new GraphEditor({ blueprint: bp, registry, ...o }).mount();
  return ed;
};
const ptr = (el: Element, type: string, o: MouseEventInit & { button?: number } = {}) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0, ...o }));
const key = (k: string, o: KeyboardEventInit = {}) => ed!.root.querySelector('.bpe-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));

describe('GraphEditor (DOM)', () => {
  it('renders nodes, pins, wires and the summary line', () => {
    mk(POPUP_BLUEPRINT);
    const nodes = ed!.root.querySelectorAll('.bpe-node');
    expect(nodes).toHaveLength(4);
    const open = ed!.root.querySelector('.bpe-node[data-id="open"]')!;
    expect(open.querySelector('.bpe-node-head')!.textContent).toContain('On element event');
    expect(open.querySelector('.bpe-node-sub')!.textContent).toBe('.js-popup-open · click');
    expect(open.querySelector('.bpe-pin[data-side="out"][data-pin="then"]')!.classList.contains('is-linked')).toBe(true);
    expect(ed!.root.querySelectorAll('.bpe-wire')).toHaveLength(2);
    // literal editors only on unconnected inputs
    const show = ed!.root.querySelector('.bpe-node[data-id="show"]')!;
    expect(show.querySelector<HTMLInputElement>('.bpe-pin[data-pin="className"] .bpe-lit')!.value).toBe('is-open');
    expect(ed!.root.querySelector('.bpe-top .bpe-name')).toHaveProperty('value', 'Popup');
  });

  it('palette click adds a node; inline literal edits the graph; changes are reported', () => {
    const onChange = vi.fn();
    mk(graph([]), { onChange });
    expect(ed!.root.querySelector('.bpe-hint')!.hasAttribute('hidden')).toBe(false);
    (ed!.root.querySelector('.bpe-pitem[data-type="dom.addClass"]') as HTMLElement).click();
    const [n] = ed!.state.bp.nodes;
    expect(n.type).toBe('dom.addClass');
    const lit = ed!.root.querySelector<HTMLInputElement>(`.bpe-node[data-id="${n.id}"] .bpe-pin[data-pin="className"] .bpe-lit`)!;
    lit.value = 'open';
    lit.dispatchEvent(new Event('change'));
    expect(ed!.state.node(n.id)!.props!.className).toBe('open');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall![0].nodes[0].props.className).toBe('open');
  });

  it('palette search filters by translated titles and keywords', () => {
    mk();
    const s = ed!.root.querySelector<HTMLInputElement>('.bpe-palette-search')!;
    s.value = 'classList';
    s.dispatchEvent(new Event('input'));
    const types = Array.from(ed!.root.querySelectorAll<HTMLElement>('.bpe-palette .bpe-pitem')).map((i) => i.dataset.type);
    expect(types).toEqual(expect.arrayContaining(['dom.addClass', 'dom.removeClass', 'dom.toggleClass']));
    expect(types).not.toContain('event.timer');
  });

  it('details panel edits props of the selected node; keyboard delete and undo', () => {
    mk(POPUP_BLUEPRINT);
    ed!.state.select(['open']);
    const sel = ed!.root.querySelector<HTMLInputElement>('.bpe-details [data-key="p:open:selector"]')!;
    expect(sel.value).toBe('.js-popup-open');
    sel.value = '.btn';
    sel.dispatchEvent(new Event('change'));
    expect(ed!.state.node('open')!.props!.selector).toBe('.btn');
    key('Delete');
    expect(ed!.state.node('open')).toBeUndefined();
    key('z', { ctrlKey: true });
    expect(ed!.state.node('open')).toBeTruthy();
  });

  it('wires: drag from an output pin onto an input pin', () => {
    mk(graph([['ev', 'event.element', { selector: '.a' }], ['add', 'dom.addClass', { target: '#x', className: 'y' }]]));
    const from = ed!.root.querySelector('.bpe-node[data-id="ev"] .bpe-pin[data-side="out"][data-pin="then"] .bpe-dot')!;
    const to = ed!.root.querySelector('.bpe-node[data-id="add"] .bpe-pin[data-side="in"][data-pin="exec"]')!;
    (document as any).elementFromPoint = () => to;
    ptr(from, 'pointerdown');
    expect(to.classList.contains('is-bad')).toBe(false);
    expect(ed!.root.querySelector('.bpe-node[data-id="add"] .bpe-pin[data-pin="className"]')!.classList.contains('is-bad')).toBe(true);
    ptr(ed!.root.querySelector('.bpe-canvas')!, 'pointermove', { clientX: 50, clientY: 5 });
    ptr(ed!.root.querySelector('.bpe-canvas')!, 'pointerup', { clientX: 50, clientY: 5 });
    expect(ed!.state.bp.links).toEqual([{ from: ['ev', 'then'], to: ['add', 'exec'] }]);
    delete (document as any).elementFromPoint;
  });

  it('dropping a wire on empty space opens a filtered search and wires the new node', () => {
    mk(graph([['ev', 'event.element', { selector: '.a' }]]));
    const canvas = ed!.root.querySelector('.bpe-canvas')!;
    (document as any).elementFromPoint = () => canvas;
    ptr(ed!.root.querySelector('.bpe-pin[data-pin="self"] .bpe-dot')!, 'pointerdown');
    ptr(canvas, 'pointerup', { clientX: 200, clientY: 100 });
    const search = ed!.root.querySelector('.bpe-search')!;
    const types = Array.from(search.querySelectorAll<HTMLElement>('.bpe-pitem')).map((i) => i.dataset.type);
    expect(types).toContain('dom.addClass'); // takes elements
    expect(types).not.toContain('math.op'); // no element input
    const input = search.querySelector('input')!;
    input.value = 'add class';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const added = ed!.state.bp.nodes.find((n) => n.type === 'dom.addClass')!;
    expect(ed!.state.bp.links).toEqual([{ from: ['ev', 'self'], to: [added.id, 'target'] }]);
    expect(ed!.root.querySelector('.bpe-search')).toBeNull();
    delete (document as any).elementFromPoint;
  });

  it('copy / paste through localStorage between editors', () => {
    mk(POPUP_BLUEPRINT);
    ed!.state.select(['open', 'show']);
    key('c', { ctrlKey: true });
    ed!.destroy();
    mk(graph([]));
    key('v', { ctrlKey: true });
    expect(ed!.state.bp.nodes.map((n) => n.type)).toEqual(['event.element', 'dom.addClass']);
    expect(ed!.state.bp.links).toHaveLength(1);
  });

  it('keys do not leak to the host page', () => {
    mk(POPUP_BLUEPRINT);
    const spy = vi.fn();
    document.addEventListener('keydown', spy);
    key('Delete');
    document.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it('JS tab shows the code; a node comment line jumps to the node', () => {
    mk(POPUP_BLUEPRINT);
    (ed!.root.querySelectorAll('.bpe-tab')[1] as HTMLElement).click();
    const code = ed!.root.querySelector('.bpe-code')!;
    expect(code.hasAttribute('hidden')).toBe(false);
    expect(code.textContent).toContain('classList.add("is-open")');
    const line = code.querySelector<HTMLElement>('.bpe-ln.is-node[data-node="show"]')!;
    line.click();
    expect(ed!.tab).toBe('graph');
    expect([...ed!.state.selection]).toEqual(['show']);
  });

  it('blueprint panel: variables and template condition; problems list', () => {
    mk(graph([['ev', 'event.element', { selector: '' }], ['x', 'dom.addClass']], ['ev.then > x.exec'], { kind: 'template' }));
    const add = Array.from(ed!.root.querySelectorAll<HTMLButtonElement>('.bpe-details h4 .bpe-add'))[0];
    add.click();
    expect(ed!.state.bp.variables).toHaveLength(1);
    const when = ed!.root.querySelector<HTMLInputElement>('[data-key="bp:when"]')!;
    when.value = 'a[';
    when.dispatchEvent(new Event('change'));
    expect(ed!.state.bp.target?.when).toBeUndefined();
    when.value = 'body.product';
    when.dispatchEvent(new Event('change'));
    expect(ed!.state.bp.target?.when).toBe('body.product');
    const problems = ed!.root.querySelectorAll('.bpe-problems li.is-error');
    expect(problems.length).toBeGreaterThan(0);
    (problems[0] as HTMLElement).click();
    expect([...ed!.state.selection]).toEqual(['x']);
    expect(ed!.root.querySelector('.bpe-node[data-id="x"]')!.classList.contains('has-error')).toBe(true);
  });

  it('close reports the blueprint with the viewport', () => {
    const onClose = vi.fn();
    mk(POPUP_BLUEPRINT, { onClose });
    (ed!.root.querySelector('.bpe-tbtn.is-primary') as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toMatchObject({ id: 'bp_popup', editor: { zoom: expect.any(Number) } });
    expect(document.querySelector('.bpe')).toBeNull();
  });
});
