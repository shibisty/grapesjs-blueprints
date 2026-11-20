import { afterEach, describe, expect, it } from 'vitest';
import { buildScript, createRegistry } from 'blueprintsjs';
import { CSS_NODES } from '../src/blueprints/cssNodes';
import { staticCss } from '../src/blueprints/blueprintCss';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';
import { graph } from './helpers/run';

const registry = createRegistry(CSS_NODES);

let s: Setup | undefined;
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
  document.querySelectorAll('style[id^="bp-css-"]').forEach((e) => e.remove());
});

const shader = (extra = {}) =>
  graph(
    [
      ['base', 'css.color', {}],
      ['mix', 'css.mix', {}],
      ['pad', 'css.unit', { unit: 'rem' }],
      ['rule', 'css.rule', { selector: '.btn', properties: [{ id: 'backgroundColor', type: 'string' }, { id: 'padding', type: 'string' }, { id: '__brand', type: 'string' }] }],
      ['hover', 'css.rule', { selector: '.btn, .link', state: ':hover', media: '(min-width: 768px)', properties: [{ id: 'boxShadow', type: 'string' }] }],
      ['sh', 'css.shadow', {}],
      ['dk', 'css.shade', {}],
    ],
    ['base.value > mix.a', 'mix.value > rule.backgroundColor', 'pad.value > rule.padding', 'base.value > dk.color', 'dk.value > sh.color', 'sh.value > hover.boxShadow'],
    extra,
  );

describe('style nodes', () => {
  it('value nodes work out a rule ahead of time (static CSS)', () => {
    const bp = shader();
    // defaults: base #3b82f6, mixed with #ffffff by .5; 16 rem; shadow colour 20% lighter
    const res = staticCss(bp, registry, document);
    expect(res.problems).toEqual([]);
    expect(res.rules).toHaveLength(2);
    expect(res.rules[0].style).toEqual({ 'background-color': '#9dc1fb', padding: '16rem' });
    expect(res.css).toContain('.btn:hover, .link:hover {');
    expect(res.css).toContain('@media (min-width: 768px) {');
    expect(res.rules[1].style['box-shadow']).toBe('0px 8px 24px 0px #629bf8');
  });

  it('a rule reading a runtime value is reported, not computed', () => {
    const bp = graph(
      [
        ['ev', 'event.start'],
        ['get', 'dom.getAttribute', { name: 'x' }],
        ['rule', 'css.rule', { selector: '.a' }],
      ],
      ['ev.then > get.exec', 'get.value > rule.color'],
    );
    const res = staticCss(bp, registry, document);
    expect(res.rules).toEqual([]);
    expect(res.problems[0].nodeId).toBe('rule');
  });

  it('runtime: "Apply styles" and "Set CSS variable" change styles while the page runs', () => {
    document.body.innerHTML = '<div class="box"></div>';
    const bp = graph(
      [
        ['ev', 'event.start'],
        ['hsl', 'css.hsl', {}],
        ['ap', 'css.apply', { selector: '.box', properties: [{ id: 'color', type: 'string' }] }],
        ['inl', 'css.apply', { properties: [{ id: 'marginTop', type: 'string' }] }],
        ['v', 'css.setVar', { name: 'brand' }],
      ],
      ['ev.then > ap.exec', 'hsl.value > ap.color', 'ap.then > inl.exec', 'inl.then > v.exec'],
    );
    bp.nodes.find((n) => n.id === 'inl')!.props = { ...bp.nodes.find((n) => n.id === 'inl')!.props, target: '.box' };
    const res = buildScript([bp], registry, { target: 'preview' });
    expect(res.hasErrors).toBe(false);
    const stop = (new Function(`return (${res.code});`)() as (d: Document) => () => void)(document);
    const st = document.querySelector('style[id^="bp-css-"]')!;
    expect(st.textContent).toMatch(/^\.box \{ color: #[0-9a-f]{6}; \}$/);
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('');
    stop();
  });

  it('in the editor: the static rules are page CSS (canvas, getCss), and follow the graph', async () => {
    s = await createEditor({ html: '<button class="btn">B</button>' });
    const { editor, api } = s;
    const bp = api.create({ ...shader(), name: 'Theme' } as any);
    await tick(5);
    const css = editor.getCss()!;
    expect(css).toContain('.btn{background-color:#9dc1fb;padding:16rem;}');
    expect(css).toMatch(/@media \(min-width: ?768px\)\{\.btn:hover\{box-shadow:0px 8px 24px 0px #629bf8;/);
    // not in the project data
    expect(JSON.stringify((editor.getProjectData() as any).styles)).not.toContain('9dc1fb');
    // the graph changes → the rule follows
    const nodes = api.get(bp.id)!.nodes.map((n) => (n.id === 'pad' ? { ...n, props: { unit: 'px' } } : n));
    api.update(bp.id, { nodes });
    await tick(5);
    expect(editor.getCss()).toContain('padding:16px');
    // disabled → gone
    api.setEnabled(bp.id, false);
    await tick(5);
    expect(editor.getCss()).not.toContain('9dc1fb');
  });
});
