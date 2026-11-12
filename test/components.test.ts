import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';

let s: Setup | undefined;
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
});

const accordion = {
  name: 'Accordion',
  kind: 'component' as const,
  component: {
    type: 'bp-accordion',
    label: 'Accordion',
    html: '<button class="acc-head">Title</button><div class="acc-body">Body</div>',
    css: '.acc-body{display:none}.is-open .acc-body{display:block}',
    params: [{ id: 'openClass', label: 'Open class', type: 'string' as const, default: 'is-open' }],
  },
  nodes: [
    { id: 'ev', type: 'event.element', pos: [0, 0] as [number, number], props: { selector: '.acc-head' } },
    { id: 'root', type: 'dom.root', pos: [0, 200] as [number, number] },
    { id: 'p', type: 'component.param', pos: [0, 300] as [number, number], props: { param: 'openClass' } },
    { id: 'tg', type: 'dom.toggleClass', pos: [300, 0] as [number, number] },
  ],
  links: [
    { from: ['ev', 'then'] as [string, string], to: ['tg', 'exec'] as [string, string] },
    { from: ['root', 'element'] as [string, string], to: ['tg', 'target'] as [string, string] },
    { from: ['p', 'value'] as [string, string], to: ['tg', 'className'] as [string, string] },
  ],
};

describe('component scripts', () => {
  it('register a GrapesJS type and a block; instances export their script with params', async () => {
    s = await createEditor({ html: '<p>x</p>' });
    const { editor, api } = s;
    api.create(accordion);
    const block = editor.Blocks.get('bp:bp-accordion');
    expect(block).toBeTruthy();
    expect((block as any).get('content')).toEqual({ type: 'bp-accordion' });
    const [cmp] = editor.getWrapper()!.append({ type: 'bp-accordion' }) as any[];
    cmp.set('openClass', 'open');
    expect(cmp.get('type')).toBe('bp-accordion');
    expect(cmp.getTrait('openClass')).toBeTruthy();
    expect(editor.getCss()).toContain('.acc-body');
    const html = editor.getHtml();
    expect(html).toContain('data-bp="bp-accordion"');
    expect(editor.getJs()).toContain('"openClass":"open"');
    // the exported page works: run the exported HTML in a fresh document
    const doc = document.implementation.createHTMLDocument('x');
    doc.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
    const js = editor.getJs();
    new Function('document', 'window', js)(doc, window);
    const head = doc.querySelector('.acc-head') as HTMLElement;
    head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(doc.querySelector('[data-bp]')!.classList.contains('open')).toBe(true);
  });

  it('script changes reach existing instances; deleting the script removes the block', async () => {
    s = await createEditor({ html: '<p>x</p>' });
    const { editor, api } = s;
    const bp = api.create(accordion);
    const [cmp] = editor.getWrapper()!.append({ type: 'bp-accordion' }) as any[];
    const before = cmp.get('script-export');
    api.update(bp.id, (b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === 'ev' ? { ...n, props: { selector: '.acc-head', event: 'dblclick' } } : n)) }));
    expect(cmp.get('script-export')).not.toBe(before);
    expect(cmp.get('script-export')).toContain('dblclick');
    api.setEnabled(bp.id, false);
    expect(cmp.get('script-export')).toBe('');
    api.remove(bp.id);
    expect(editor.Blocks.get('bp:bp-accordion')).toBeFalsy();
  });

  it('project data: the type is known before the pages load', async () => {
    s = await createEditor({ html: '<p>x</p>' });
    const { editor, api } = s;
    api.create(accordion);
    editor.getWrapper()!.append({ type: 'bp-accordion', openClass: 'wide' } as any);
    const data = JSON.parse(JSON.stringify(editor.getProjectData()));
    const t = await createEditor({ html: '' });
    try {
      t.editor.loadProjectData(data);
      await tick();
      const cmp = t.editor.getWrapper()!.find('[data-bp="bp-accordion"]')[0] as any;
      expect(cmp.get('type')).toBe('bp-accordion');
      expect(cmp.get('openClass')).toBe('wide');
      expect(t.editor.getJs()).toContain('"openClass":"wide"');
    } finally {
      await destroyEditor(t.editor);
    }
  });
});
