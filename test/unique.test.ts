import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import scriptsPlugin from '../src/index';
import { COMMANDS } from '../src/events';
import { targets } from '../src/core/code';
import { toggleRule } from '../src/ui/recordCode';
import { rulesEditor } from '../src/ui/rules';
import { locales } from '../src/i18n';
import { createEditor, destroyEditor, modal, tick, type Setup } from './helpers/editor';

/** grapesjs-site-pages stand-in: records (pages, a layout, a component) and linked components. */
const RECORDS = [
  { id: 'home', name: 'Home', kind: 'page' },
  { id: 'blog', name: 'Blog', kind: 'page' },
  { id: 'main', name: 'Main', kind: 'layout' },
  { id: 'footer', name: 'Footer', kind: 'component' },
];
const fakePages = () => (ed: Editor) => {
  (ed as any).PagesManager = {
    list: async () => RECORDS,
    components: { list: () => RECORDS.filter((r) => r.kind === 'component') },
  };
};

let s: Setup | undefined;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
  document.body.innerHTML = '';
});

const start = async (): Promise<Setup> => {
  s = await createEditor({ config: { plugins: [(ed: Editor) => scriptsPlugin(ed), fakePages()] } });
  s.editor.trigger('pages-manager:ready'); // what grapesjs-site-pages sends: the records are read
  await tick(5);
  return s;
};

describe('conditions: "is" with OR, "is not" with AND', () => {
  const home = { id: 'home', layoutId: 'main', components: ['footer'] };
  const blog = { id: 'blog', components: [] };
  it('no rules: everywhere', () => {
    expect(targets([], home)).toBe(true);
    expect(targets(undefined, blog)).toBe(true);
  });
  it('page is (also via its layout), page is not', () => {
    expect(targets(['home', 'blog'], blog)).toBe(true);
    expect(targets(['main'], home)).toBe(true);
    expect(targets(['main'], blog)).toBe(false);
    expect(targets(['!home'], home)).toBe(false);
    expect(targets(['!home'], blog)).toBe(true);
    expect(targets(['!home', '!blog'], blog)).toBe(false);
  });
  it('component is / is not: the components on the page, or the component record itself', () => {
    expect(targets(['component:footer'], home)).toBe(true);
    expect(targets(['component:footer'], blog)).toBe(false);
    expect(targets(['!component:footer'], home)).toBe(false);
    expect(targets(['component:footer'], { id: 'footer', kind: 'component' })).toBe(true);
    // a component record is not a page: page rules do not hold for it
    expect(targets(['footer'], { id: 'footer', kind: 'component' })).toBe(false);
    // "is" rules OR, "is not" excludes
    expect(targets(['blog', 'component:footer'], home)).toBe(true);
    expect(targets(['component:footer', '!home'], home)).toBe(false);
  });
  it('record toggles', () => {
    const page = { id: 'home', name: 'Home', kind: 'page' };
    const comp = { id: 'footer', name: 'Footer', kind: 'component' };
    expect(toggleRule(['blog'], page, true)).toEqual(['blog', 'home']);
    expect(toggleRule(['blog', 'home'], page, false)).toEqual(['blog']);
    expect(toggleRule(['home'], page, false)).toBeNull(); // the only one: switch off
    expect(toggleRule(['!blog'], page, false)).toEqual(['!blog', '!home']);
    expect(toggleRule(['!home'], page, true)).toEqual(['home']);
    expect(toggleRule(['!home', '!blog'], page, true)).toEqual(['!blog']);
    expect(toggleRule([], comp, true)).toEqual(['component:footer']);
  });
});

describe('rules editor', () => {
  it('adds, edits and removes rows; a gone record stays visible', () => {
    const t = ((k: string) => (locales.en as any)[k]) as any;
    let out: string[] = [];
    const choices = () => RECORDS.map((r) => ({ id: r.id, name: r.name, group: r.kind as any }));
    const el = rulesEditor({ t, choices, value: ['!gone'], onChange: (v) => (out = v) });
    document.body.append(el);
    expect(el.querySelector<HTMLSelectElement>('[data-role="id"]')!.value).toBe('gone');
    expect(el.textContent).toContain('(gone)');
    el.querySelector<HTMLButtonElement>('[data-role="add-rule"]')!.click();
    expect(out).toEqual(['!gone', 'home']);
    const row = () => el.querySelectorAll('.gjscr-rule')[1];
    const on = row().querySelector<HTMLSelectElement>('[data-role="on"]')!;
    on.value = 'component';
    on.dispatchEvent(new Event('change'));
    expect(out).toEqual(['!gone', 'component:footer']);
    const op = row().querySelector<HTMLSelectElement>('[data-role="op"]')!;
    op.value = 'ne';
    op.dispatchEvent(new Event('change'));
    expect(out).toEqual(['!gone', '!component:footer']);
    el.querySelector<HTMLButtonElement>('[data-role="remove"]')!.click();
    expect(out).toEqual(['!component:footer']);
  });
});

describe('with grapesjs-site-pages: Global and Unique', () => {
  it('the create dialog offers Unique with conditions', async () => {
    const { editor, api } = await start();
    editor.runCommand(COMMANDS.open);
    await tick();
    const sec = document.querySelector('.gjscr-section[data-kind="template"]')!;
    expect(sec.textContent).toContain('Unique');
    (sec.querySelector('.gjscr-act') as HTMLButtonElement).click();
    await tick();
    const form = modal()!.querySelector('form')!;
    expect(form.querySelector('input[value="component"]')).toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[value="template"]')!.checked).toBe(true);
    form.querySelector<HTMLButtonElement>('[data-role="add-rule"]')!.click();
    const id = form.querySelector<HTMLSelectElement>('[data-role="id"]')!;
    id.value = 'blog';
    id.dispatchEvent(new Event('change'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(api.list()[0]).toMatchObject({ kind: 'template', target: { pages: ['blog'] } });
  });

  it('a unique blueprint edits its conditions from the list', async () => {
    const { editor, api } = await start();
    const bp = api.create({ kind: 'template', name: 'Promo', target: { pages: ['home'] } });
    editor.runCommand(COMMANDS.open);
    await tick();
    const row = document.querySelector<HTMLElement>(`.gjscr-item[data-id="${bp.id}"]`)!;
    expect(row.textContent).toContain('Home');
    [...row.querySelectorAll<HTMLButtonElement>('.gjscr-act')].find((b) => b.title === 'Conditions')!.click();
    await tick();
    const op = modal()!.querySelector<HTMLSelectElement>('[data-role="op"]')!;
    op.value = 'ne';
    op.dispatchEvent(new Event('change'));
    modal()!.querySelector<HTMLButtonElement>('[data-role="apply"]')!.click();
    expect(api.get(bp.id)!.target!.pages).toEqual(['!home']);
  });

  it('libraries: Global and Unique sections; a component record toggles libraries and code', async () => {
    const { editor, api } = await start();
    const g = api.addLibrary({ name: 'Base', files: [{ url: 'https://cdn.example/base.css', type: 'css' }] });
    const u = api.addLibrary({ name: 'Swiper', files: [{ url: 'https://cdn.example/swiper.js', type: 'js' }], pages: ['blog'] });
    const css = api.code.create({ lang: 'css', kind: 'template', name: 'Footer CSS', target: { pages: ['blog'] } });
    const loaded = (scope: any) => api.libraries().filter((l) => l.enabled && targets(l.pages, scope)).map((l) => l.name);
    expect(loaded({ id: 'home', components: [] })).toEqual(['Base']);
    editor.runCommand(COMMANDS.open);
    await tick();
    document.querySelector<HTMLButtonElement>('.gjscr-stab[data-tab="libraries"]')!.click();
    await tick();
    const uniq = document.querySelector('.gjscr-section[data-kind="libraries-unique"]')!;
    expect(uniq).toBeTruthy();
    expect(document.querySelector(`[data-lib="${u.id}"] [data-role="conditions"]`)).toBeTruthy();
    // "Scripts & styles" of the Footer component
    const actions: any[] = [];
    const rec = { id: 'footer', name: 'Footer', kind: 'component' };
    editor.trigger('pages-manager:record-actions', { record: rec, actions });
    actions[0].run(rec);
    const box = () => document.querySelector<HTMLElement>('.gjscr-record-code')!;
    const check = (id: string) => box().querySelector<HTMLInputElement>(`input[data-id="${id}"]`)!;
    expect(check(g.id).disabled).toBe(true); // global
    expect(check(u.id).checked).toBe(false);
    check(u.id).click();
    check(css.id).click();
    expect(api.libraries().find((l) => l.id === u.id)!.pages).toEqual(['blog', 'component:footer']);
    expect(api.code.get(css.id)!.target!.pages).toEqual(['blog', 'component:footer']);
    // a page that has the Footer on it now gets the library
    expect(loaded({ id: 'home', components: ['footer'] })).toEqual(['Base', 'Swiper']);
  });
});
