import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';

let s: Setup | undefined;
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
});

const view = () => document.querySelector<HTMLElement>('.gjscr-pagecss');
const text = () => {
  const el = view()!;
  const cm = el.querySelector('.CodeMirror') as any;
  return cm?.CodeMirror ? cm.CodeMirror.getValue() : (el.querySelector('textarea') as HTMLTextAreaElement).value;
};
const type = (v: string) => {
  const el = view()!;
  const cm = el.querySelector('.CodeMirror') as any;
  if (cm?.CodeMirror) cm.CodeMirror.setValue(v);
  else {
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = v;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
};

describe('the page CSS (GrapesJS styles as text, both ways)', () => {
  it('shows the page’s own rules; typing replaces them; the Style Manager changes the text', async () => {
    s = await createEditor({ html: '<button id="b1" class="btn">B</button>' });
    const { editor, api } = s;
    editor.Css.addRules('.btn{color:red}');
    editor.getWrapper()!.find('#b1')[0].setStyle({ padding: '4px' });
    // a CSS item's rules are not the page's
    api.code.create({ lang: 'css', name: 'Base', code: '.btn { margin: 1px; }' });
    await tick(5);
    editor.runCommand('scripts:page-css-edit');
    expect(view()).toBeTruthy();
    expect(text()).toContain('.btn {\n  color: red;\n}');
    expect(text()).toContain('#b1 {\n  padding: 4px;\n}');
    expect(text()).not.toContain('margin: 1px');
    // typing: the rules follow
    type('.btn {\n  color: green;\n}\n\n#b1 {\n  padding: 8px;\n}\n\n@media (max-width: 600px) {\n  .btn {\n    color: blue;\n  }\n}\n');
    await tick(600);
    const css = editor.getCss()!;
    expect(css).toContain('.btn{color:green;}');
    expect(css).not.toContain('color:red');
    expect(css).toContain('#b1{padding:8px;}');
    expect(css).toMatch(/@media \(max-width: ?600px\)\{\.btn\{color:blue;\}\}/);
    expect(css).toContain('margin:1px'); // the item's rule stays
    // the Style Manager (a rule's style) → the text, after a moment
    await tick(900);
    editor.Css.getRule('.btn')!.setStyle({ color: 'purple' });
    await tick(200);
    expect(text()).toContain('color: purple;');
    // the CSS list shows the entry with its count
    editor.runCommand('scripts:open');
    await tick(5);
    const sideTab = document.querySelector<HTMLElement>('.gjscr [data-tab="css"]');
    sideTab?.click();
    await tick(5);
    const entry = document.querySelector<HTMLElement>('.gjscr-item--page');
    if (entry) expect(entry.textContent).toContain('3');
    // Done: the editor goes
    view()!.querySelector<HTMLButtonElement>('.gjscr-primary')!.click();
    expect(view()).toBeNull();
  });
});
