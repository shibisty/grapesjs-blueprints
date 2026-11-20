import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'acorn';
import { createRegistry } from 'blueprintsjs';
import { ScriptsManager } from '../src/core/ScriptsManager';
import { componentJs, pageJs, previewJs } from '../src/core/jsBundle';
import { normalizeCode } from '../src/core/code';
import { click } from './helpers/run';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';

const item = (code: string, extra: Record<string, unknown> = {}) => normalizeCode({ id: 'js_' + Math.random().toString(36).slice(2), name: 'Item', lang: 'js', code, ...extra })!;
/** Runs page JS like a <script> on the jsdom page. */
const runPage = (code: string) => new Function(code)();
const log: string[] = [];
(globalThis as any).__log = (s: string) => log.push(s);

afterEach(() => {
  log.length = 0;
  document.body.innerHTML = '';
});

describe('JS items: generated code', () => {
  it('the wrappers are ES5 (the user code is kept as written); a name cannot break the script', () => {
    expect(() => parse(pageJs([item('var a = 1;')]), { ecmaVersion: 5 })).not.toThrow();
    expect(() => parse(`(${previewJs([item('var a = 1;')])})`, { ecmaVersion: 5 })).not.toThrow();
    expect(() => parse(`(${componentJs(item('var a = 1;', { kind: 'component' }))})`, { ecmaVersion: 5 })).not.toThrow();
    // A name that would close a comment or a script stays harmless.
    const evil = item('', { name: '*/ </script> x' });
    expect(pageJs([evil])).not.toContain('</script>');
    expect(() => parse(pageJs([evil]), { ecmaVersion: 5 })).not.toThrow();
  });

  it('runs each item in order, in its own scope; one that throws does not stop the next', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runPage(
      pageJs([
        item('var x = "a"; __log(x);', { run: 'now' }),
        item('throw new Error("boom");', { run: 'now', name: 'Broken' }),
        item('__log(typeof x); return; __log("never");', { run: 'now' }),
      ]),
    );
    expect(log).toEqual(['a', 'undefined']);
    expect(err.mock.calls[0][0]).toBe('[script Broken]');
  });

  it('when: runs only if the page has a match', () => {
    document.body.innerHTML = '<div class="product"></div>';
    runPage(pageJs([item('__log("product")', { run: 'now', kind: 'template', target: { pages: [], when: '.product' } }), item('__log("blog")', { run: 'now', kind: 'template', target: { pages: [], when: '.blog' } })]));
    expect(log).toEqual(['product']);
  });

  it('ready / load wait for the document; immediately when it is past that already', () => {
    // jsdom has finished loading: both run right away.
    runPage(pageJs([item('__log("ready")', { run: 'ready' }), item('__log("load")', { run: 'load' })]));
    expect(log).toEqual(['ready', 'load']);
  });

  it('preview: everything runs at once, returned functions are the cleanup', () => {
    document.body.innerHTML = '<button class="b">B</button>';
    const start = new Function(`return (${previewJs([item('var b = document.querySelector(".b"); function on() { __log("click"); } b.addEventListener("click", on); return function () { b.removeEventListener("click", on); __log("stopped"); };')])});`)();
    const stop = start(document);
    click(document.querySelector('.b'));
    stop();
    click(document.querySelector('.b'));
    expect(log).toEqual(['click', 'stopped']);
  });

  it('component JS: once per instance with root and params; the cleanup it returns', () => {
    document.body.innerHTML = '<div class="a"></div><div class="b"></div>';
    const fn = new Function(`return (${componentJs(item('root.textContent = params.text; return function () { root.textContent = "off"; };', { kind: 'component' }))});`)();
    const stopA = fn(document.querySelector('.a'), { params: { text: 'A' } });
    fn(document.querySelector('.b'), { params: { text: 'B' } });
    expect(document.body.textContent).toBe('AB');
    stopA();
    expect(document.querySelector('.a')!.textContent).toBe('off');
    // No return value: a no-op cleanup.
    expect(typeof new Function(`return (${componentJs(item('', { kind: 'component' }))});`)()(document.body, {})).toBe('function');
  });
});

describe('JS items: buildJs (blueprints + JS of a page)', () => {
  const mk = () => new ScriptsManager(createRegistry());

  it('joins the compiled blueprints and the items; a broken item is left out and reported', () => {
    const m = mk();
    m.create({ name: 'Bp', nodes: [{ id: 's', type: 'event.start', pos: [0, 0] }, { id: 'l', type: 'debug.log', pos: [0, 0], props: { message: 'bp' } }], links: [{ from: ['s', 'then'], to: ['l', 'exec'] }] });
    m.createCode({ lang: 'js', code: '__log("js")', run: 'now' });
    const broken = m.createCode({ lang: 'js', code: 'let = ;', name: 'Broken' });
    const r = m.buildJs();
    expect(r.blueprints).toBe(1);
    expect(r.items).toBe(1);
    expect(r.hasErrors).toBe(true);
    expect(r.diagnostics.find((d) => 'codeId' in d)).toMatchObject({ code: 'js-syntax', codeId: broken.id });
    expect(r.code.indexOf('Generated by')).toBeLessThan(r.code.indexOf('__gjscrRun')); // banner on top
    expect(() => new Function(r.code)).not.toThrow();
    expect(m.codeOfItem(broken.id).error).toMatch(/./);
  });

  it('preview: blueprints and items start and stop together', () => {
    const m = mk();
    document.body.innerHTML = '<button class="b">B</button>';
    m.create({ name: 'Bp', nodes: [{ id: 'e', type: 'event.element', pos: [0, 0], props: { selector: '.b', event: 'click' } }, { id: 'c', type: 'dom.addClass', pos: [0, 0], props: { target: '.b', className: 'on' } }], links: [{ from: ['e', 'then'], to: ['c', 'exec'] }] });
    m.createCode({ lang: 'js', code: 'function on() { __log("js click"); } document.addEventListener("click", on); return function () { document.removeEventListener("click", on); };' });
    const start = new Function(`return (${m.buildJs({ target: 'preview' }).code});`)();
    const stop = start(document);
    click(document.querySelector('.b'));
    expect(document.querySelector('.b')!.classList.contains('on')).toBe(true);
    expect(log).toEqual(['js click']);
    stop();
    document.querySelector('.b')!.classList.remove('on');
    click(document.querySelector('.b'));
    expect(document.querySelector('.b')!.classList.contains('on')).toBe(false);
    expect(log).toEqual(['js click']);
  });

  it('only items: works without blueprints; nothing at all: empty', () => {
    const m = mk();
    expect(m.buildJs()).toMatchObject({ code: '', blueprints: 0, items: 0 });
    m.createCode({ lang: 'js', code: '__log("x")', run: 'now' });
    runPage(m.buildJs().code);
    expect(log).toEqual(['x']);
    const start = new Function(`return (${m.buildJs({ target: 'preview' }).code});`)();
    start(document)();
  });
});

describe('JS items in the editor', () => {
  let s: Setup | undefined;
  afterEach(async () => {
    await destroyEditor(s?.editor);
    s = undefined;
  });

  it('getHtml and the export carry the JS items; a page item gets the page file', async () => {
    s = await createEditor();
    const { editor, api } = s;
    const Pages = (editor as any).Pages;
    Pages.add({ id: 'product', component: '<div class="p"></div>' });
    api.code.create({ lang: 'js', name: 'Analytics', code: 'window.__a = 1;' });
    api.code.create({ lang: 'js', kind: 'template', name: 'Product only', code: 'window.__p = 1;', target: { pages: ['product'] } });
    expect(editor.getHtml()).toContain('<script src="scripts.js" defer></script>');
    const site = await api.exportSite();
    const files = Object.fromEntries(site.files.map((f) => [f.name, f.code]));
    expect(files['scripts.js']).toContain('window.__a = 1;');
    expect(files['scripts.js']).not.toContain('__p');
    expect(files['scripts-product.js']).toContain('window.__p = 1;');
    expect(site.pages.product.scripts).toContain('scripts-product.js');
  });

  it('component JS: a GrapesJS type and block; the exported page runs it per instance', async () => {
    s = await createEditor();
    const { editor, api } = s;
    const c = api.code.create({
      lang: 'js',
      kind: 'component',
      name: 'Counter',
      code: 'var n = Number(params.start) || 0; root.textContent = String(n); root.addEventListener("click", function () { root.textContent = String(++n); });',
      component: { html: '<span>0</span>', params: [{ id: 'start', label: 'Start', type: 'number', default: 5 }] },
    });
    await tick(5);
    const type = c.component!.type;
    expect(editor.Blocks.get(`bp:${type}`)).toBeTruthy();
    const [inst] = editor.getWrapper()!.append({ type }) as any[];
    expect(inst.get('start')).toBe(5);
    // GrapesJS puts the script-export into the exported HTML: run it as a browser would.
    const html = editor.getHtml();
    expect(html).toContain('data-bp="' + type + '"');
    const js = (editor as any).getJs();
    document.body.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
    new Function(js)();
    const el = document.querySelector(`[data-bp="${type}"]`) as HTMLElement;
    expect(el.textContent).toBe('5');
    click(el);
    expect(el.textContent).toBe('6');
    // Broken code: the type stays, without a script.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.code.update(c.id, { code: 'var = ;' });
    await tick(5);
    expect(inst.get('script-export')).toBe('');
  });
});
