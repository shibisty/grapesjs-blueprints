import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import { RULE_TAG, rulesToCss } from '../src/integration/cssItems';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';

let s: Setup | undefined;
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
});

const tagged = (ed: Editor, id?: string) => (ed.Css as any).getAll().filter((r: any) => (id ? r.get(RULE_TAG) === id : !!r.get(RULE_TAG)));
const settle = () => tick(5);

describe('CSS items as GrapesJS rules', () => {
  it('global CSS: rules in the canvas and in getCss, first in the list, never in the project data', async () => {
    s = await createEditor({ html: '<button class="btn">B</button>' });
    const { editor, api } = s;
    editor.Css.addRules('.btn{color:red}'); // a rule of the page, same selector
    const c = api.code.create({ lang: 'css', name: 'Base', code: '.btn { color: blue; padding: 4px; }\n@media (max-width: 600px) { .btn { margin: 0; } }' });
    await settle();
    expect(tagged(editor, c.id)).toHaveLength(2);
    const css = editor.getCss()!;
    expect(css).toContain('.btn{color:red;}');
    expect(css).toContain('.btn{color:blue;padding:4px;}');
    // Our rules first: the page's own rule (Style Manager) comes later and wins.
    expect(css.indexOf('color:blue')).toBeLessThan(css.indexOf('color:red'));
    // Separate rules, not merged into the page's; a lookup (Style Manager) finds the page's own.
    expect(editor.Css.getRule('.btn')!.getStyle()).toEqual({ color: 'red' });
    expect(tagged(editor, c.id)[0].getStyle()).toEqual({ color: 'blue', padding: '4px' });
    // An empty rule of the page (the Style Manager makes one on select) does not shadow ours.
    editor.Css.setRule('.only-here', {});
    // A class only the item styles: the lookup finds the item's rule.
    api.code.update(c.id, { code: '.only-here { color: teal; }' });
    await settle();
    expect((editor.Css.getRule('.only-here') as any).get(RULE_TAG)).toBe(c.id);
    api.code.update(c.id, { code: '.btn { color: blue; padding: 4px; }\n@media (max-width: 600px) { .btn { margin: 0; } }' });
    await settle();
    const stored = editor.getProjectData() as any;
    expect(JSON.stringify(stored.styles)).not.toContain(RULE_TAG);
    expect(JSON.stringify(stored.styles)).toContain('red');
    expect(stored.scripts.code[0].code).toContain('color: blue');
  });

  it('follows the text; disabled or deleted: gone; not in the undo history', async () => {
    s = await createEditor({ html: '<p class="a">a</p>' });
    const { editor, api } = s;
    const um = editor.UndoManager;
    um.clear();
    const c = api.code.create({ lang: 'css', code: '.a{color:red}' });
    await settle();
    expect(tagged(editor, c.id)).toHaveLength(1);
    api.code.update(c.id, { code: '.a{color:green} .a:hover{color:blue}' });
    await settle();
    expect(tagged(editor, c.id).map((r: any) => r.toCSS())).toEqual(['.a{color:green;}', '.a:hover{color:blue;}']);
    expect(um.hasUndo()).toBe(false);
    api.code.update(c.id, { enabled: false });
    await settle();
    expect(tagged(editor)).toHaveLength(0);
    api.code.update(c.id, { enabled: true });
    await settle();
    api.code.remove(c.id);
    await settle();
    expect(tagged(editor)).toHaveLength(0);
  });

  it('an edit in the Style Manager rewrites the item’s text; the rule stays the same model', async () => {
    s = await createEditor({ html: '<p class="a">a</p>' });
    const { editor, api } = s;
    const c = api.code.create({ lang: 'css', code: '/* note */\n.a { color: red; }\n@keyframes spin { from { opacity: 0; } to { opacity: 1; } }' });
    await settle();
    const [rule] = tagged(editor, c.id);
    rule.setStyle({ color: 'purple', 'font-weight': 'bold' });
    await tick(200);
    const code = api.code.get(c.id)!.code;
    expect(code).toContain('.a {\n  color: purple;\n  font-weight: bold;\n}');
    expect(code).toContain('@keyframes spin {\n  from {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}');
    expect(tagged(editor, c.id)[0]).toBe(rule); // not re-created under the Style Manager
    // The rewritten text parses back to the same rules.
    expect((editor as any).Parser.parseCss(code)).toHaveLength(3);
  });

  it('a project load: the rules come back once, with no copies', async () => {
    s = await createEditor({ html: '<p class="a">a</p>' });
    const { editor, api } = s;
    api.code.create({ lang: 'css', code: '.a{color:red}' });
    await settle();
    const data = editor.getProjectData();
    editor.loadProjectData(data);
    await settle();
    expect(tagged(editor)).toHaveLength(1);
    editor.loadProjectData(JSON.parse(JSON.stringify(data)));
    await settle();
    expect(tagged(editor)).toHaveLength(1);
    expect(editor.getCss()!.match(/color:red/g)).toHaveLength(1);
  });

  it('template CSS: only on its pages (editor.Pages)', async () => {
    s = await createEditor({ html: '<p class="a">a</p>' });
    const { editor, api } = s;
    const Pages = (editor as any).Pages;
    Pages.add({ id: 'about', component: '<p class="a">about</p>' });
    api.code.create({ lang: 'css', kind: 'template', name: 'About', code: '.a{color:green}', target: { pages: ['about'] } });
    await settle();
    expect(tagged(editor)).toHaveLength(0);
    Pages.select('about');
    await settle();
    expect(tagged(editor)).toHaveLength(1);
  });

  it('template CSS with grapesjs-site-pages: by the open record’s layout', async () => {
    s = await createEditor({ html: '<p class="a">a</p>', config: {} });
    const { editor, api } = s;
    (editor as any).PagesManager = { list: async () => [] };
    api.code.create({ lang: 'css', kind: 'template', name: 'Layout', code: '.a{color:green}', target: { pages: ['L1'] } });
    editor.trigger('pages-manager:open', { id: 'p1', layoutId: 'L2' });
    await settle();
    expect(tagged(editor)).toHaveLength(0);
    editor.trigger('pages-manager:open', { id: 'p2', layoutId: 'L1' });
    await settle();
    expect(tagged(editor)).toHaveLength(1);
  });

  it('component CSS: only while the component is on the page', async () => {
    s = await createEditor({ html: '<p>x</p>' });
    const { editor, api } = s;
    const js = api.code.create({ lang: 'js', kind: 'component', name: 'Card' });
    const type = js.component!.type;
    api.code.create({ lang: 'css', kind: 'component', code: `[data-bp="${type}"]{padding:8px}`, target: { componentType: type } });
    await settle();
    expect(tagged(editor)).toHaveLength(0);
    const [inst] = editor.getWrapper()!.append({ type }) as any[];
    await settle();
    expect(tagged(editor)).toHaveLength(1);
    inst.remove();
    await settle();
    expect(tagged(editor)).toHaveLength(0);
  });

  it('rulesToCss: empty rules list → empty text; font-face kept', async () => {
    s = await createEditor();
    const { editor } = s;
    expect(rulesToCss([])).toBe('');
    const all = (editor.Css as any).getAll();
    const defs = (editor as any).Parser.parseCss('@font-face { font-family: F; src: url(a.woff); }');
    const added = all.add(defs);
    expect(rulesToCss([].concat(added))).toBe('@font-face {\n  font-family: F;\n  src: url(a.woff);\n}\n');
  });
});
