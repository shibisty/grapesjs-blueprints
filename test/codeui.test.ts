import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { COMMANDS } from '../src/events';
import type { WorkspaceLike } from '../src/integration/workspace';
import type { CodeEditorView } from '../src/ui/codeEditor';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';
import { fakeWorkspace } from './helpers/workspace';

let s: Setup | undefined;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
});

const panel = () => document.querySelector<HTMLElement>('.gjscr')!;
const tab = (name: string) => panel().querySelector<HTMLButtonElement>(`.gjscr-stab[data-tab="${name}"]`)!;
const overlay = () => document.querySelector<HTMLElement>('body > .gjscr-ce');
const items = () => Array.from(panel().querySelectorAll<HTMLElement>('.gjscr-item')).map((li) => li.querySelector('.gjscr-name')!.textContent);

/** Types into the code area of an editor (CodeMirror when it runs here, the textarea otherwise). */
function typeCode(root: HTMLElement, value: string) {
  const cm = (root.querySelector('.gjscr-ce-code .CodeMirror') as any)?.CodeMirror;
  if (cm) return cm.setValue(value);
  const ta = root.querySelector<HTMLTextAreaElement>('textarea.gjscr-ce-code')!;
  ta.value = value;
  ta.dispatchEvent(new Event('input'));
}

async function open(): Promise<Setup> {
  s = await createEditor();
  s.editor.runCommand(COMMANDS.open);
  await tick();
  return s;
}

describe('sidebar tabs', () => {
  it('four tabs; + creates in the open tab; the tab is remembered', async () => {
    const { api } = await open();
    expect(Array.from(panel().querySelectorAll('.gjscr-stab')).map((b) => b.getAttribute('data-tab'))).toEqual(['blueprints', 'js', 'css', 'libraries']);
    expect(tab('blueprints').classList.contains('is-active')).toBe(true);
    tab('js').click();
    await tick();
    expect(panel().querySelector('.gjscr-empty')!.textContent).toBe('No JavaScript yet. Create it with +.');
    panel().querySelector<HTMLButtonElement>('.gjscr-head .gjscr-btn')!.click(); // +
    await tick();
    expect(api.code.list('js')).toHaveLength(1);
    expect(overlay()).toBeTruthy(); // opened for editing
    (overlay()!.querySelector('.gjscr-primary') as HTMLButtonElement).click();
    await tick();
    expect(items()).toEqual(['JavaScript 1']);
    expect(tab('js').textContent).toBe('JS1');
    expect(localStorage.getItem('gjscr-tab')).toBe('js');
    tab('css').click();
    await tick();
    // The + of a section creates that kind.
    panel().querySelector<HTMLButtonElement>('.gjscr-section[data-kind="template"] .gjscr-act')!.click();
    await tick();
    expect(api.code.list('css')[0]).toMatchObject({ kind: 'template', name: 'Styles 1' });
    tab('libraries').click();
    await tick();
    expect(panel().querySelector('.gjscr-section[data-kind="libraries"]')).toBeTruthy();
  });

  it('lists by kind with a sub-line; actions toggle, duplicate, rename, delete', async () => {
    const { api } = await open();
    api.code.create({ lang: 'js', name: 'Analytics', code: 'a()' });
    api.code.create({ lang: 'js', kind: 'template', name: 'Product', target: { pages: [], when: 'body.p' }, run: 'load' });
    api.code.create({ lang: 'js', name: 'Broken', code: 'let = ;' });
    tab('js').click();
    await tick();
    expect(items()).toEqual(['Analytics', 'Broken', 'Product']);
    const sub = (name: string) => Array.from(panel().querySelectorAll('.gjscr-item')).find((li) => li.querySelector('.gjscr-name')!.textContent === name)!;
    expect(sub('Product').querySelector('.gjscr-sub')!.textContent).toContain('body.p');
    expect(sub('Product').querySelector('.gjscr-sub')!.textContent).toContain('After everything has loaded');
    expect(sub('Broken').classList.contains('has-errors')).toBe(true);
    const act = (name: string, title: string) => (sub(name).querySelector(`.gjscr-act[title="${title}"]`) as HTMLButtonElement).click();
    act('Analytics', 'Disable');
    expect(api.code.list().find((c) => c.name === 'Analytics')!.enabled).toBe(false);
    act('Analytics', 'Duplicate');
    vi.spyOn(window, 'prompt').mockReturnValue('Renamed');
    act('Analytics', 'Rename');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    act('Broken', 'Delete');
    await tick();
    expect(api.code.list('js').map((c) => c.name)).toEqual(['Renamed', 'Analytics copy', 'Product']);
  });

  it('search looks into names and code', async () => {
    const { api } = await open();
    api.code.create({ lang: 'css', name: 'Buttons', code: '.btn{}' });
    api.code.create({ lang: 'css', name: 'Header', code: '.logo{}' });
    tab('css').click();
    const search = panel().querySelector<HTMLInputElement>('.gjscr-search')!;
    search.value = 'logo';
    search.dispatchEvent(new Event('input'));
    await tick();
    expect(items()).toEqual(['Header']);
  });
});

describe('code editor', () => {
  it('saves what is typed (debounced, and on Done); shows a syntax error', async () => {
    const { editor, api } = await open();
    const c = api.code.create({ lang: 'js', name: 'X', code: '' });
    const view = editor.runCommand(COMMANDS.editCode, { id: c.id }) as CodeEditorView;
    expect(overlay()).toBe(view.root);
    typeCode(view.root, 'let = ;');
    expect(view.root.querySelector('.gjscr-ce-status')!.classList.contains('is-error')).toBe(true);
    typeCode(view.root, 'window.__ok = 1;');
    expect(view.root.querySelector('.gjscr-ce-status')!.textContent).toContain('No syntax errors');
    await tick(350);
    expect(api.code.get(c.id)!.code).toBe('window.__ok = 1;');
    typeCode(view.root, 'window.__ok = 2;');
    (view.root.querySelector('.gjscr-primary') as HTMLButtonElement).click();
    expect(api.code.get(c.id)!.code).toBe('window.__ok = 2;');
    expect(overlay()).toBeNull();
  });

  it('kind, run time and targets (pages of editor.Pages); the condition is checked', async () => {
    const { editor, api } = await open();
    (editor as any).Pages.add({ id: 'about', name: 'About', component: '<p>a</p>' });
    const c = api.code.create({ lang: 'js', name: 'X' });
    const view = editor.runCommand(COMMANDS.editCode, { id: c.id }) as CodeEditorView;
    const side = () => view.root.querySelector<HTMLElement>('.gjscr-ce-side')!;
    const run = side().querySelector<HTMLSelectElement>('select[aria-label="Runs"]')!;
    run.value = 'load';
    run.dispatchEvent(new Event('change'));
    expect(api.code.get(c.id)!.run).toBe('load');
    const kind = side().querySelector<HTMLSelectElement>('select[aria-label="Type"]')!;
    kind.value = 'template';
    kind.dispatchEvent(new Event('change'));
    expect(api.code.get(c.id)!.kind).toBe('template');
    const about = side().querySelector<HTMLInputElement>('input[value="about"]')!;
    about.checked = true;
    about.dispatchEvent(new Event('change'));
    expect(api.code.get(c.id)!.target!.pages).toEqual(['about']);
    const when = side().querySelector<HTMLInputElement>('input[aria-label="Condition (CSS selector)"]')!;
    when.value = 'div[';
    when.dispatchEvent(new Event('input'));
    expect(when.classList.contains('is-invalid')).toBe(true);
    when.value = 'body.x';
    when.dispatchEvent(new Event('input'));
    view.flush();
    expect(api.code.get(c.id)!.target).toEqual({ pages: ['about'], when: 'body.x' });
    view.close();
  });

  it('component JS: type, label, parameters; component CSS: picks a component type', async () => {
    const { editor, api } = await open();
    const js = api.code.create({ lang: 'js', kind: 'component', name: 'Counter' });
    const view = editor.runCommand(COMMANDS.editCode, { id: js.id }) as CodeEditorView;
    const side = view.root.querySelector<HTMLElement>('.gjscr-ce-side')!;
    side.querySelector<HTMLButtonElement>('.gjscr-params .gjscr-btn')!.click();
    const key = side.querySelector<HTMLInputElement>('.gjscr-param input[aria-label="Key"]')!;
    key.value = 'start value';
    key.dispatchEvent(new Event('input'));
    view.flush();
    expect(api.code.get(js.id)!.component!.params).toEqual([{ id: 'startvalue', label: '', type: 'string' }]);
    const type = side.querySelector<HTMLInputElement>('input[aria-label="Component type"]')!;
    type.value = 'Bad Type';
    type.dispatchEvent(new Event('input'));
    expect(type.classList.contains('is-invalid')).toBe(true);
    view.close();

    const css = api.code.create({ lang: 'css', kind: 'component', name: 'Counter styles' });
    const v2 = editor.runCommand(COMMANDS.editCode, { id: css.id }) as CodeEditorView;
    const sel = v2.root.querySelector<HTMLSelectElement>('select[aria-label="Component"]')!;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', js.component!.type]);
    sel.value = js.component!.type;
    sel.dispatchEvent(new Event('change'));
    expect(api.code.get(css.id)!.target).toEqual({ componentType: js.component!.type });
    v2.close();
  });

  it('an item deleted elsewhere closes its editor without saving it back', async () => {
    const { editor, api } = await open();
    const c = api.code.create({ lang: 'css', name: 'Gone' });
    const view = editor.runCommand(COMMANDS.editCode, { id: c.id }) as CodeEditorView;
    typeCode(view.root, '.x{}');
    api.code.remove(c.id);
    await tick();
    expect(overlay()).toBeNull();
    expect(api.code.list()).toEqual([]);
  });
});

describe('code editor in workspace tabs (grapesjs-sidebar-tools)', () => {
  async function withWorkspace(remembered: string[] = []) {
    s = await createEditor();
    const ws = fakeWorkspace(remembered);
    (s.editor as Editor & any).SidebarTools = { workspace: ws, onReady: (cb: (w: WorkspaceLike) => void) => cb(ws) };
    s.editor.trigger('sidebar-tools:ready', { workspace: ws });
    await tick();
    return { ...s, ws };
  }

  it('opens in a tab, follows renames, closes with the item; Done closes the tab', async () => {
    const { editor, api, ws } = await withWorkspace();
    const c = api.code.create({ lang: 'js', name: 'Tabbed' });
    const view = editor.runCommand(COMMANDS.editCode, { id: c.id }) as CodeEditorView;
    const doc = ws.docs.get(`code:${c.id}`)!;
    expect(doc).toMatchObject({ title: 'Tabbed', kind: 'element' });
    expect(overlay()).toBeNull();
    expect(view.root.classList.contains('gjscr-ce--embedded')).toBe(true);
    api.code.update(c.id, { name: 'Renamed' });
    expect(ws.docs.get(`code:${c.id}`)!.title).toBe('Renamed');
    (view.root.querySelector('.gjscr-primary') as HTMLButtonElement).click();
    expect(ws.has(`code:${c.id}`)).toBe(false);
    editor.runCommand(COMMANDS.editCode, { id: c.id });
    api.code.remove(c.id);
    expect(ws.has(`code:${c.id}`)).toBe(false);
  });

  it('tabs of the last session come back once the item is loaded', async () => {
    const { api, ws } = await withWorkspace(['code:js_later']);
    expect(ws.has('code:js_later')).toBe(false);
    api.manager.load({ blueprints: [], code: [{ id: 'js_later', lang: 'js', name: 'Later', code: '' }] });
    await tick();
    expect(ws.has('code:js_later')).toBe(true);
  });
});
