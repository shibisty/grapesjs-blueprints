import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryTags, normalizeLibrary } from '../src/core/libraries';
import { inlineSafe, processCode } from '../src/core/output';
import { pageFileName } from '../src/integration/export';
import { POPUP_BLUEPRINT } from './fixtures/popup';
import { createEditor, destroyEditor, tick, type Setup } from './helpers/editor';

let s: Setup | undefined;
afterEach(async () => {
  await destroyEditor(s?.editor);
  s = undefined;
});
const popup = () => ({ name: 'Popup', nodes: POPUP_BLUEPRINT.nodes, links: POPUP_BLUEPRINT.links });

describe('libraries model', () => {
  it('normalizes: https only, valid SRI only, at least one file', () => {
    const lib = normalizeLibrary({ name: 'x', files: [{ url: 'https://a/x.css' }, { url: 'javascript:alert(1)' }, { url: 'https://a/x.js', integrity: 'sha384-abc+/=' }, { url: 'https://a/y.js', integrity: 'md5-zzz' }], load: 'weird', global: 'a b' })!;
    expect(lib.files).toEqual([{ url: 'https://a/x.css', type: 'css' }, { url: 'https://a/x.js', type: 'js', integrity: 'sha384-abc+/=' }, { url: 'https://a/y.js', type: 'js' }]);
    expect(lib.load).toBeUndefined();
    expect(lib.global).toBeUndefined();
    expect(normalizeLibrary({ files: [{ url: 'ftp://x' }] })).toBeNull();
  });

  it('tags: CSS first, load modes, SRI with crossorigin, attribute escaping', () => {
    const html = libraryTags([
      normalizeLibrary({ name: 'a', files: [{ url: 'https://c/a.js', integrity: 'sha256-AAA=' }, { url: 'https://c/a.css' }] })!,
      normalizeLibrary({ name: 'b', load: 'module', files: [{ url: 'https://c/b.js?x="1"' }] })!,
    ]);
    expect(html.split('\n')).toEqual([
      '<link rel="stylesheet" href="https://c/a.css">',
      '<script src="https://c/a.js" defer integrity="sha256-AAA=" crossorigin="anonymous"></script>',
      '<script src="https://c/b.js?x=&quot;1&quot;" type="module"></script>',
    ]);
  });
});

describe('output', () => {
  it('processCode applies tools in order and keeps the code when a tool fails', async () => {
    const r = await processCode('a', { minify: true, obfuscate: true }, { minify: async (c) => `${c}m`, obfuscate: async (c) => `${c}o` });
    expect(r).toEqual({ code: 'amo', warnings: [] });
    const f = await processCode('a', { minify: true, obfuscate: false }, { minify: async () => Promise.reject(new Error('nope')) });
    expect(f.code).toBe('a');
    expect(f.warnings[0]).toMatch(/nope/);
  });

  it('inlineSafe and page file names', () => {
    expect(inlineSafe('x = "</script><!--"')).toBe('x = "<\\/script><\\!--"');
    expect(pageFileName('scripts.js', 'my page')).toBe('scripts-my-page.js');
  });
});

describe('export in the editor', () => {
  it('file mode: getHtml has the library and script tags; files carry the code', async () => {
    s = await createEditor();
    const { editor, api } = s;
    expect(editor.getHtml()).not.toContain('<script');
    api.create(popup());
    api.addLibrary({ name: 'gsap', files: [{ url: 'https://cdn/gsap.min.js', type: 'js', integrity: 'sha256-X=' }] });
    const html = editor.getHtml();
    expect(html).toContain('<script src="https://cdn/gsap.min.js" defer integrity="sha256-X=" crossorigin="anonymous"></script>');
    expect(html).toContain('<script src="scripts.js" defer></script>');
    const page = await api.exportPage();
    expect(page.files).toHaveLength(1);
    expect(page.files[0].name).toBe('scripts.js');
    expect(page.files[0].code).toContain('".js-popup-open"');
    // regression: opening the blueprint editor must not unwrap getHtml
    api.edit(api.list()[0].id)!.close();
    expect(editor.getHtml()).toContain('<script src="scripts.js" defer></script>');
    api.setSettings({ includeInHtml: false });
    expect(editor.getHtml()).not.toContain('<script');
  });

  it('inline mode puts the code in the page; script-breaking text is escaped', async () => {
    s = await createEditor();
    const { editor, api } = s;
    api.setSettings({ output: 'inline' });
    api.create({ name: 'Evil', nodes: [{ id: 's', type: 'event.start', pos: [0, 0] }, { id: 'c', type: 'code.js', pos: [0, 0], props: { code: 'var x = "</script><b>";', inputs: [], outputs: [] } }], links: [{ from: ['s', 'then'], to: ['c', 'exec'] }] });
    const html = editor.getHtml();
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('"<\\/script><b>"');
  });

  it('page-limited template scripts get their own file only on their page', async () => {
    s = await createEditor();
    const { editor, api } = s;
    const Pages = (editor as any).Pages;
    Pages.add({ id: 'product', component: '<div class="p"></div>' });
    api.create(popup());
    api.create({ name: 'Product', kind: 'template', target: { pages: ['product'] } });
    const site = await api.exportSite();
    expect(site.files.map((f) => f.name).sort()).toEqual(['scripts-product.js', 'scripts.js']);
    const mainId = Pages.getMain().getId();
    expect(site.pages[mainId].scripts).not.toContain('scripts-product.js');
    expect(site.pages.product.scripts).toContain('scripts-product.js');
    // getHtml of a page component knows its page
    const html = editor.getHtml({ component: Pages.get('product').getMainComponent() } as any);
    expect(html).toContain('scripts-product.js');
  });

  it('minify: getHtml uses the processed code once it is ready', async () => {
    const minify = vi.fn(async (c: string) => `/*min*/${c.length}`);
    s = await createEditor({ plugin: { output: { tools: { minify } } } });
    const { editor, api } = s;
    api.setSettings({ output: 'inline', minify: true });
    api.create(popup());
    const first = editor.getHtml();
    expect(first).toContain('".js-popup-open"'); // readable until processed
    await tick(20);
    expect(editor.getHtml()).toContain('/*min*/');
    const page = await api.exportPage();
    expect(page.files).toEqual([]);
    expect(page.scripts).toContain('/*min*/');
    expect(minify).toHaveBeenCalledTimes(1); // cached
  });
});
