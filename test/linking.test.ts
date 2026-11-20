import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import scriptsPlugin from '../src/index';
import { COMMANDS } from '../src/events';
import { createEditor, destroyEditor, modal, tick, type Setup } from './helpers/editor';

/** A stand-in for grapesjs-site-pages 2.7: linked components and their sources. */
const fakePages = (state: { sources: any[]; masters: Array<{ id: string; name: string }> }) => (ed: Editor) => {
  (ed as any).PagesManager = {
    components: {
      list: () => state.masters,
      addSource: (src: any) => {
        state.sources.push(src);
        return () => state.sources.splice(state.sources.indexOf(src), 1);
      },
    },
  };
};

let s: Setup | undefined;
let state: { sources: any[]; masters: Array<{ id: string; name: string }> };
beforeEach(() => {
  localStorage.clear();
  state = { sources: [], masters: [{ id: 'm1', name: 'Footer' }] };
});
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
  document.body.innerHTML = '';
});

const start = async (): Promise<Setup> => {
  s = await createEditor({ config: { plugins: [(ed: Editor) => scriptsPlugin(ed), fakePages(state)] } });
  return s;
};

describe('pages components ↔ blueprints', () => {
  it('offers our component types as a source of new pages components', async () => {
    const { api } = await start();
    expect(state.sources.map((x) => x.id)).toEqual(['blueprints']);
    api.create({ kind: 'component', name: 'Card', component: { type: 'bp-card', label: 'Card' } });
    api.code.create({ lang: 'js', kind: 'component', name: 'Slider', component: { type: 'bp-slider' } });
    const src = state.sources[0];
    expect(src.list()).toEqual([
      { id: 'bp-card', name: 'Card' },
      { id: 'bp-slider', name: 'Slider' },
    ]);
    expect(src.build('bp-card')).toEqual({ type: 'bp-card' });
  });

  it('removes the source when the plugin is torn down', async () => {
    const { editor } = await start();
    expect(state.sources.length).toBe(1);
    (editor as any).__gjscrCleanup(); // what a re-init or `destroy` runs
    expect(state.sources.length).toBe(0);
  });

  it('a component with a linked pages component inserts it as its content', async () => {
    const { api, editor } = await start();
    api.code.create({ lang: 'js', kind: 'component', name: 'Footer box', component: { type: 'bp-fbox', pagesComponent: 'm1' } as any });
    await tick(5);
    const block = editor.Blocks.get('bp:bp-fbox');
    expect(block).toBeTruthy();
    const [c] = editor.getWrapper()!.append({ type: 'bp-fbox' });
    const inner = c.components().at(0);
    expect(inner.getAttributes()['data-gjsp-component']).toBe('m1');
  });

  it('the code editor chooses the content: own HTML or a linked component', async () => {
    const { api, editor } = await start();
    const item = api.code.create({ lang: 'js', kind: 'component', name: 'Box', component: { type: 'bp-box', html: '<p>x</p>' } });
    editor.runCommand(COMMANDS.editCode, { id: item.id });
    await tick(5);
    const root = document.querySelector<HTMLElement>('.gjscr-ce')!;
    const sel = root.querySelector<HTMLSelectElement>('select[name="content"]')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Its own HTML', 'Footer']);
    sel.value = 'm1';
    sel.dispatchEvent(new Event('change'));
    await tick(5);
    expect((api.code.get(item.id)!.component as any).pagesComponent).toBe('m1');
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    await tick(5);
    expect((api.code.get(item.id)!.component as any).pagesComponent).toBeUndefined();
  });

  it('a component blueprint gets its content from the sidebar action', async () => {
    const { api, editor } = await start();
    const bp = api.create({ kind: 'component', name: 'Card', component: { type: 'bp-card' } });
    editor.runCommand(COMMANDS.open);
    await tick(5);
    const tabBtn = document.querySelector<HTMLButtonElement>('.gjscr-stab[data-tab="blueprints"]');
    tabBtn?.click();
    await tick(5);
    const row = document.querySelector<HTMLElement>(`.gjscr-item[data-id="${bp.id}"]`)!;
    const btn = [...row.querySelectorAll<HTMLButtonElement>('.gjscr-act')].find((b) => b.title === 'Content of the component')!;
    expect(btn).toBeTruthy();
    btn.click();
    const sel = modal()!.querySelector<HTMLSelectElement>('select[name="content"]')!;
    sel.value = 'm1';
    sel.dispatchEvent(new Event('change'));
    modal()!.querySelector<HTMLButtonElement>('[data-role="apply"]')!.click();
    expect((api.get(bp.id)!.component as any).pagesComponent).toBe('m1');
  });

  it('without linked components there is no content action', async () => {
    state.masters = [];
    const { api, editor } = await start();
    const bp = api.create({ kind: 'component', name: 'Card', component: { type: 'bp-card' } });
    editor.runCommand(COMMANDS.open);
    await tick(5);
    document.querySelector<HTMLButtonElement>('.gjscr-stab[data-tab="blueprints"]')?.click();
    await tick(5);
    const row = document.querySelector<HTMLElement>(`.gjscr-item[data-id="${bp.id}"]`)!;
    expect([...row.querySelectorAll<HTMLButtonElement>('.gjscr-act')].some((b) => b.title === 'Content of the component')).toBe(false);
  });
});

describe('pages records: "Scripts & styles"', () => {
  const ask = (editor: Editor, record: any): any[] => {
    const actions: any[] = [];
    editor.trigger('pages-manager:record-actions', { record, actions });
    return actions;
  };

  it('adds the action to pages, layouts, templates and components', async () => {
    const { editor } = await start();
    expect(ask(editor, { id: 'p1', name: 'Home', kind: 'page' }).map((a) => a.id)).toEqual(['scripts']);
    expect(ask(editor, { id: 'l1', name: 'Main', kind: 'layout' }).length).toBe(1);
    expect(ask(editor, { id: 't1', name: 'Post', kind: 'template' }).length).toBe(1);
    expect(ask(editor, { id: 'c1', name: 'Footer', kind: 'component' }).length).toBe(1);
    expect(ask(editor, { id: 'e1', name: 'Entry', kind: 'entry' }).length).toBe(0);
    expect(ask(editor, { id: 'p2', name: 'Old', kind: 'page', deleted: true }).length).toBe(0);
  });

  it('attaches and detaches page items to the record, creates new ones there', async () => {
    const { api, editor } = await start();
    const js = api.code.create({ lang: 'js', kind: 'template', name: 'Gallery', target: { pages: ['other'] } });
    const css = api.code.create({ lang: 'css', kind: 'template', name: 'Blog CSS', target: { pages: ['p1'] } });
    api.code.create({ lang: 'css', kind: 'global', name: 'Base' });
    ask(editor, { id: 'p1', name: 'Home', kind: 'page' })[0].run({ id: 'p1', name: 'Home', kind: 'page' });
    const box = () => document.querySelector<HTMLElement>('.gjscr-record-code')!;
    expect(box().textContent).toContain('Global');
    const check = (id: string) => box().querySelector<HTMLInputElement>(`input[data-id="${id}"]`)!;
    expect(check(js.id).checked).toBe(false);
    expect(check(css.id).checked).toBe(true);
    check(js.id).click();
    expect(api.code.get(js.id)!.target!.pages).toEqual(['other', 'p1']);
    // unchecking the only page turns the item off instead of making it global
    check(css.id).click();
    expect(api.code.get(css.id)!.enabled).toBe(false);
    expect(api.code.get(css.id)!.target!.pages).toEqual(['p1']);
    expect(check(css.id).checked).toBe(false);
    check(css.id).click();
    expect(api.code.get(css.id)!.enabled).toBe(true);
    // new item for this record, opened in the editor
    box().querySelector<HTMLButtonElement>('[data-new="js"]')!.click();
    await tick(5);
    const created = api.code.list().find((c) => c.lang === 'js' && c.id !== js.id)!;
    expect(created.kind).toBe('template');
    expect(created.target!.pages).toEqual(['p1']);
    expect(document.querySelector('.gjscr-ce')).toBeTruthy();
  });
});
