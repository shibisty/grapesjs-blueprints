import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import scriptsPlugin from '../src/index';
import type { ScriptsPluginOptions } from '../src/options';
import { canShare, pagesOf } from '../src/integration/pages';
import { createEditor, destroyEditor, tick } from './helpers/editor';

/** A stand-in for grapesjs-site-pages 2.7+: just the shared-keys API. */
const fakePages = (registered: string[], withShared = true) => (ed: Editor) => {
  (ed as any).PagesManager = withShared
    ? { shared: { register: async (k: string) => void registered.push(k), keys: () => [...registered] } }
    : { list: async () => [] }; // an older pages: no shared keys
};

const plugin = (o?: ScriptsPluginOptions) => (ed: Editor) => scriptsPlugin(ed, o);

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

describe('grapesjs-site-pages: scripts are a shared key', () => {
  it('registers the storable key when pages is listed before', async () => {
    const reg: string[] = [];
    const s = await createEditor({ config: { plugins: [fakePages(reg), plugin()] } });
    editor = s.editor;
    expect(reg).toEqual(['scripts']);
  });

  it('…and when it is listed after (on ready), once', async () => {
    const reg: string[] = [];
    const s = await createEditor({ config: { plugins: [plugin(), fakePages(reg)] } });
    editor = s.editor;
    await tick(5);
    expect(reg).toEqual(['scripts']);
  });

  it('uses the storageKey option, and can be turned off', async () => {
    const reg: string[] = [];
    const s = await createEditor({ config: { plugins: [fakePages(reg), plugin({ storageKey: 'bp' })] } });
    editor = s.editor;
    expect(reg).toEqual(['bp']);
    await destroyEditor(editor);
    const reg2: string[] = [];
    const t = await createEditor({ config: { plugins: [fakePages(reg2), plugin({ sharedWithPages: false })] } });
    editor = t.editor;
    expect(reg2).toEqual([]);
  });

  it('an older pages without shared keys is left alone', async () => {
    const s = await createEditor({ config: { plugins: [fakePages([], false), plugin()] } });
    editor = s.editor;
    expect(canShare(pagesOf(s.editor))).toBe(false);
  });
});

describe('ScopeTracker: which page the editor shows', () => {
  it('without pages: the selected editor.Pages page', async () => {
    const { ScopeTracker } = await import('../src/integration/pages');
    const s = await createEditor();
    editor = s.editor;
    const t = new ScopeTracker(s.editor);
    const id = (s.editor as any).Pages.getSelected().getId();
    expect(t.withPages).toBe(false);
    expect(t.scope()).toEqual({ id });
    expect(t.scope('other')).toEqual({ id: 'other' });
    t.destroy();
  });

  it('with pages: the open record with its layout and template, nothing after detach', async () => {
    const { ScopeTracker } = await import('../src/integration/pages');
    const s = await createEditor({ config: { plugins: [fakePages([]), plugin()] } });
    editor = s.editor;
    const t = new ScopeTracker(s.editor);
    expect(t.scope()).toBeUndefined(); // nothing open yet: not editor.Pages
    s.editor.trigger('pages-manager:open', { id: 'p1', kind: 'page', layoutId: 'L', templateId: null, data: {} });
    expect(t.scope()).toEqual({ id: 'p1', layoutId: 'L', templateId: null, components: [] });
    expect(t.record).toMatchObject({ id: 'p1', kind: 'page' });
    s.editor.trigger('pages-manager:detach');
    expect(t.scope()).toBeUndefined();
    t.destroy();
    s.editor.trigger('pages-manager:open', { id: 'p2' });
    expect(t.scope()).toBeUndefined(); // listeners gone
  });
});
