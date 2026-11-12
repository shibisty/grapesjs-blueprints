import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, EVENTS, PANEL_BUTTON_ID } from '../src/index';
import scriptsPlugin from '../src/index';
import { POPUP_BLUEPRINT } from './fixtures/popup';
import { click, createEditor, destroyEditor, modal, modalOpen, sidebar, tick, type Setup } from './helpers/editor';

let s: Setup | undefined;
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
});

const items = () => Array.from(document.querySelectorAll<HTMLElement>('.gjscr-item'));
const names = () => items().map((i) => i.querySelector('.gjscr-name')!.textContent);

describe('plugin', () => {
  it('adds a view button and a sidebar that replaces the other views', async () => {
    s = await createEditor();
    const { editor } = s;
    const views = editor.Panels.getPanel('views')!;
    const btn = (views.get('buttons') as any).get(PANEL_BUTTON_ID);
    expect(btn).toBeTruthy();
    expect(sidebar().hidden).toBe(true);
    editor.runCommand(COMMANDS.open);
    expect(sidebar().hidden).toBe(false);
    expect(btn.get('active')).toBe(true);
    expect(sidebar().closest('.gjs-pn-views-container')).toBeTruthy();
    // another view (Layers) takes over
    (views.get('buttons') as any).get('open-layers').set('active', true);
    expect(sidebar().hidden).toBe(true);
    expect(btn.get('active')).toBe(false);
  });

  it('keeps working next to grapesjs-storage, whose cleanup hook is __gjssCleanup', async () => {
    s = await createEditor();
    const { editor, api } = s;
    // grapesjs-storage calls its own previous cleanup when it starts.
    (editor as any).__gjssCleanup?.();
    api.create({ name: 'Kept' });
    expect(((editor.getProjectData() as any).scripts?.blueprints || []).map((b: any) => b.name)).toEqual(['Kept']);
    expect((editor as any).__gjscrCleanup).toBeTypeOf('function');
  });

  it('lists scripts by kind and re-renders on changes', async () => {
    s = await createEditor();
    const { editor, api } = s;
    editor.runCommand(COMMANDS.open);
    expect(document.querySelector('.gjscr-empty')!.textContent).toMatch(/No scripts/);
    const a = api.create({ name: 'Popup', nodes: POPUP_BLUEPRINT.nodes, links: POPUP_BLUEPRINT.links });
    api.create({ name: 'Tabs', kind: 'component' });
    api.create({ name: 'Product', kind: 'template', target: { when: 'body.product' } });
    await tick();
    expect(names()).toEqual(['Popup', 'Product', 'Tabs']);
    const sub = (name: string) => items().find((i) => i.textContent!.includes(name))!.querySelector('.gjscr-sub')!.textContent;
    expect(sub('Popup')).toBe('blocks: 4');
    expect(sub('Product')).toContain('body.product');
    expect(sub('Tabs')).toContain('<bp-tabs>');
    api.setEnabled(a.id, false);
    await tick();
    expect(items()[0].classList.contains('is-off')).toBe(true);
    // search
    const search = document.querySelector<HTMLInputElement>('.gjscr-search')!;
    search.value = 'product';
    search.dispatchEvent(new Event('input'));
    await tick();
    expect(names()).toEqual(['Product']);
  });

  it('marks scripts with errors', async () => {
    s = await createEditor();
    s.editor.runCommand(COMMANDS.open);
    s.api.create({ name: 'Broken', nodes: [{ id: 'e', type: 'event.element', pos: [0, 0], props: { selector: 'a[' } }] });
    await tick();
    expect(items()[0].classList.contains('has-errors')).toBe(true);
    expect(items()[0].querySelector('.gjscr-err')!.textContent).toBe('errors: 1');
  });

  it('saves scripts in the project data and loads them back; changes count as edits', async () => {
    s = await createEditor();
    const { editor, api } = s;
    // Without a storage GrapesJS resets the counter right away: watch it go up.
    const counts: number[] = [];
    (editor as any).getModel().on('change:changesCount', (_m: unknown, v: number) => counts.push(v));
    const bp = api.create({ name: 'Popup', nodes: POPUP_BLUEPRINT.nodes, links: POPUP_BLUEPRINT.links });
    api.setSettings({ output: 'inline' });
    await tick(5); // GrapesJS counts changes on the next tick
    expect(Math.max(0, ...counts)).toBeGreaterThan(0);
    const data = editor.getProjectData() as any;
    expect(data.scripts.blueprints[0].name).toBe('Popup');
    expect(data.scripts.settings.output).toBe('inline');

    const t = await createEditor();
    try {
      const changes = vi.fn();
      t.editor.on(EVENTS.change, changes);
      t.editor.loadProjectData(JSON.parse(JSON.stringify(data)));
      expect(t.api.list().map((b) => b.id)).toEqual([bp.id]);
      expect(t.api.getSettings().output).toBe('inline');
      expect(changes).toHaveBeenCalledWith({ type: 'load', id: undefined });
      // project data without scripts clears them
      t.editor.loadProjectData({ pages: data.pages });
      expect(t.api.list()).toEqual([]);
    } finally {
      await destroyEditor(t.editor);
    }
  });

  it('builds template scripts per editor page', async () => {
    s = await createEditor();
    const { editor, api } = s;
    const pages = (editor as any).Pages;
    const p2 = pages.add({ id: 'product', component: '<div class="product"></div>' });
    api.create({ name: 'Everywhere', kind: 'template' });
    api.create({ name: 'Product only', kind: 'template', target: { pages: [p2.getId()] } });
    const res = editor.runCommand(COMMANDS.build, { pageId: pages.getMain().getId() });
    expect(res.blueprints.map((b: any) => b.name)).toEqual(['Everywhere']);
    expect(api.build({ pageId: 'product' }).blueprints).toHaveLength(2);
  });

  it('create dialog: component with a type, then the script opens', async () => {
    s = await createEditor();
    const { editor, api } = s;
    editor.runCommand(COMMANDS.open);
    const edits = vi.fn();
    editor.on(EVENTS.edit, edits);
    click(document.querySelector('.gjscr-section[data-kind="component"] .gjscr-act'));
    await tick();
    expect(modalOpen()).toBe(true);
    const form = modal()!.querySelector('form')!;
    const name = form.querySelector<HTMLInputElement>('#gjscr-name')!;
    expect(form.querySelector<HTMLInputElement>('input[value="component"]')!.checked).toBe(true);
    name.value = 'Hero Slider';
    name.dispatchEvent(new Event('input'));
    expect(form.querySelector<HTMLInputElement>('#gjscr-ctype')!.value).toBe('bp-hero-slider');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    const [bp] = api.list();
    expect(bp).toMatchObject({ name: 'Hero Slider', kind: 'component', component: { type: 'bp-hero-slider', label: 'Hero Slider' } });
    expect(edits).toHaveBeenCalledWith({ id: bp.id });
    // the blueprint editor opens on the new script
    expect(document.querySelector<HTMLInputElement>('.bpe .bpe-name')!.value).toBe('Hero Slider');
    expect(api.getGraphEditor()!.state.bp.id).toBe(bp.id);
  });

  it('create dialog: validates the template condition and the component type', async () => {
    s = await createEditor();
    const { editor, api } = s;
    api.create({ kind: 'component', name: 'Tabs' });
    void editor.runCommand(COMMANDS.create, { kind: 'template' });
    await tick();
    const form = () => modal()!.querySelector('form')!;
    const when = form().querySelector<HTMLInputElement>('#gjscr-when')!;
    when.value = 'div[';
    form().dispatchEvent(new Event('submit', { cancelable: true }));
    expect(form().querySelector('.gjscr-msg')!.textContent).toBe('Invalid CSS selector');
    expect(api.list()).toHaveLength(1);
    // switch to component with a taken type
    const comp = form().querySelector<HTMLInputElement>('input[value="component"]')!;
    comp.checked = true;
    comp.dispatchEvent(new Event('change'));
    const type = form().querySelector<HTMLInputElement>('#gjscr-ctype')!;
    type.value = 'bp-tabs';
    type.dispatchEvent(new Event('input'));
    form().dispatchEvent(new Event('submit', { cancelable: true }));
    expect(form().querySelector('.gjscr-msg')!.textContent).toBe('This component type already exists');
    // cancel resolves with nothing
    click(form().querySelector('.gjscr-secondary'));
    await tick();
    expect(api.list()).toHaveLength(1);
  });

  it('code view: highlighted JS with problems, copy', async () => {
    s = await createEditor();
    const { editor, api } = s;
    const bp = api.create({ name: 'Popup', nodes: POPUP_BLUEPRINT.nodes, links: POPUP_BLUEPRINT.links });
    editor.runCommand(COMMANDS.code, { id: bp.id });
    const view = modal()!.querySelector('.gjscr-codeview')!;
    expect(view.querySelector('.gjscr-diags')!.textContent).toBe('No problems');
    expect(view.querySelector('.gjscr-t-string')).toBeTruthy();
    expect(view.querySelectorAll('.gjscr-ln').length).toBe(api.codeOf(bp.id).split('\n').length);
    expect(view.querySelector('.gjscr-code')!.textContent).toBe(api.codeOf(bp.id).replace(/\n/g, ''));
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    click(view.querySelector('.gjscr-codebar .gjscr-secondary'));
    await tick();
    expect(write).toHaveBeenCalledWith(api.codeOf(bp.id));
    // all scripts
    api.create({ name: 'Broken', nodes: [{ id: 'e', type: 'event.element', pos: [0, 0], props: { selector: 'a[' } }, { id: 'x', type: 'dom.addClass', pos: [0, 0] }], links: [{ from: ['e', 'then'], to: ['x', 'exec'] }] });
    editor.runCommand(COMMANDS.code);
    expect(modal()!.querySelectorAll('.gjscr-diags li.is-error').length).toBeGreaterThan(0);
  });

  it('item actions: toggle, duplicate, rename, delete; keyboard', async () => {
    s = await createEditor();
    const { editor, api } = s;
    editor.runCommand(COMMANDS.open);
    const bp = api.create({ name: 'Popup' });
    await tick();
    const act = (i: number) => items()[0].querySelectorAll<HTMLButtonElement>('.gjscr-act')[i];
    click(act(1));
    expect(api.get(bp.id)!.enabled).toBe(false);
    await tick();
    click(act(3));
    await tick();
    expect(names()).toEqual(['Popup', 'Popup copy']);
    vi.spyOn(window, 'prompt').mockReturnValue('Modal');
    click(act(2));
    expect(api.get(bp.id)!.name).toBe('Modal');
    await tick();
    // Delete key on the item removes the script (after confirm) — not the selected component
    editor.select(editor.getWrapper()!.components().at(0));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    items()[0].focus();
    items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(confirm).toHaveBeenCalledWith('Delete the script "Modal"?');
    expect(api.list().map((b) => b.name)).toEqual(['Popup copy']);
    expect(editor.getWrapper()!.components().length).toBe(2);
  });

  it('speaks the editor language', async () => {
    s = await createEditor({ config: { i18n: { locale: 'ru', detectLocale: false } } });
    s.editor.runCommand(COMMANDS.open);
    await tick();
    expect(document.querySelector('.gjscr-title')!.textContent).toBe('Скрипты');
    s.editor.I18n.setLocale('uk');
    await tick(5);
    expect(document.querySelector('.gjscr-title')!.textContent).toBe('Скрипти');
    s.editor.I18n.setLocale('de');
    await tick(5);
    expect(document.querySelector('.gjscr-title')!.textContent).toBe('Skripte');
    s.editor.I18n.setLocale('xx'); // unknown → English
    await tick(5);
    expect(document.querySelector('.gjscr-title')!.textContent).toBe('Scripts');
  });

  it('applying the plugin twice does not duplicate the UI or the storable', async () => {
    s = await createEditor();
    const { editor } = s;
    scriptsPlugin(editor);
    await tick(10);
    expect(document.querySelectorAll('.gjscr').length).toBe(1);
    const storables = (editor as any).getModel().storables.filter((x: any) => x.name === 'ScriptsPlugin');
    expect(storables).toHaveLength(1);
  });

  it('graph editor: edits are saved to the script (debounced, flushed on close)', async () => {
    s = await createEditor();
    const { editor, api } = s;
    const bp = api.create({ name: 'Popup' });
    const ge = api.edit(bp.id)!;
    expect(document.querySelectorAll('.bpe')).toHaveLength(1);
    // Keys typed in the editor never reach GrapesJS keymaps
    editor.select(editor.getWrapper()!.components().at(0));
    ge.root.querySelector('.bpe-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(editor.getWrapper()!.components().length).toBe(2);
    ge.state.addNode('dom.addClass', [300, 0], { target: '#popup', className: 'is-open' });
    ge.state.connect(['event', 'then'], ['n2', 'exec']);
    expect(api.get(bp.id)!.nodes).toHaveLength(1); // not yet
    await tick(350);
    expect(api.get(bp.id)!.nodes).toHaveLength(2);
    ge.state.setMeta({ name: 'Modal' });
    (ge.root.querySelector('.bpe-tbtn.is-primary') as HTMLElement).click();
    expect(api.get(bp.id)!.name).toBe('Modal');
    expect(api.get(bp.id)!.editor?.zoom).toBeTypeOf('number');
    expect(document.querySelector('.bpe')).toBeNull();
    expect(api.getGraphEditor()).toBeNull();
  });

  it('graph editor speaks the editor language; JS tab shows the plugin output', async () => {
    s = await createEditor({ config: { i18n: { locale: 'ru', detectLocale: false } } });
    const { api } = s;
    const bp = api.create({ name: 'Popup' });
    const ge = api.edit(bp.id)!;
    expect(ge.root.querySelector('.bpe-node-head')!.textContent).toContain('Событие элемента');
    expect(ge.root.querySelector('.bpe-palette .bpe-cat')!.textContent).toBe('События');
    ge.setTab('code');
    expect(ge.root.querySelector('.bpe-code')!.textContent).toBe(api.codeOf(bp.id).replace(/\n/g, ''));
    ge.close();
  });
});
