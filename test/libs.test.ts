import { describe, expect, it, vi } from 'vitest';
import { cdnjs, jsdelivr, PRESETS } from '../src/libs/providers';
import { normalizeLibrary } from '../src/core/libraries';
import { selectorCandidates, suggestHookClass, AUTO_ID } from '../src/integration/picker';
import { click, graph, start } from './helpers/run';

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('library providers (mocked HTTP)', () => {
  it('jsDelivr: npm search, versions, flat files with SRI and entry points', async () => {
    const fetch = vi.fn((url: string) => {
      if (url.startsWith('https://registry.npmjs.org/-/v1/search')) return json({ objects: [{ package: { name: 'swiper', version: '11.1.14', description: 'Slider', links: { homepage: 'https://swiperjs.com' } } }] });
      if (url === 'https://data.jsdelivr.com/v1/packages/npm/swiper') return json({ tags: { latest: '11.1.14' }, versions: [{ version: '11.1.14' }, { version: '11.1.0' }] });
      if (url.endsWith('?structure=flat')) return json({ files: [{ name: '/swiper-bundle.min.js', hash: 'AbC=' }, { name: '/swiper-bundle.min.css', hash: 'DeF=' }, { name: '/types/x.d.ts' }, { name: '/swiper.mjs.map' }] });
      if (url.endsWith('/entrypoints')) return json({ entrypoints: { js: { file: '/swiper-bundle.min.js' }, css: { file: '/swiper-bundle.min.css' } } });
      return json({}, 404);
    });
    const ctx = { fetch: fetch as any };
    expect(await jsdelivr.search(ctx, 'swi')).toEqual([{ name: 'swiper', version: '11.1.14', description: 'Slider', homepage: 'https://swiperjs.com' }]);
    expect(await jsdelivr.versions(ctx, 'swiper')).toEqual({ versions: ['11.1.14', '11.1.0'], latest: '11.1.14' });
    const files = await jsdelivr.files(ctx, 'swiper', '11.1.14');
    expect(files.files).toEqual([
      { path: '/swiper-bundle.min.js', url: 'https://cdn.jsdelivr.net/npm/swiper@11.1.14/swiper-bundle.min.js', type: 'js', integrity: 'sha256-AbC=' },
      { path: '/swiper-bundle.min.css', url: 'https://cdn.jsdelivr.net/npm/swiper@11.1.14/swiper-bundle.min.css', type: 'css', integrity: 'sha256-DeF=' },
    ]);
    expect(files.defaults).toEqual(['/swiper-bundle.min.js', '/swiper-bundle.min.css']);
  });

  it('cdnjs, and the proxy wraps URLs', async () => {
    const urls: string[] = [];
    const fetch = vi.fn((url: string) => {
      urls.push(url);
      const real = decodeURIComponent(url.split('url=')[1]);
      if (real.includes('libraries?search=')) return json({ results: [{ name: 'gsap', version: '3.12.5' }] });
      if (real.includes('fields=versions')) return json({ versions: ['3.12.4', '3.12.5'], version: '3.12.5' });
      return json({ files: ['gsap.min.js', 'gsap.js', 'README.md'], sri: { 'gsap.min.js': 'sha512-xyz' } });
    });
    const ctx = { fetch: fetch as any, proxy: '/proxy/libs-proxy.php' };
    expect((await cdnjs.search(ctx, 'gsap'))[0].name).toBe('gsap');
    expect(await cdnjs.versions(ctx, 'gsap')).toEqual({ versions: ['3.12.5', '3.12.4'], latest: '3.12.5' });
    const f = await cdnjs.files(ctx, 'gsap', '3.12.5');
    expect(f.files.map((x) => x.path)).toEqual(['gsap.min.js', 'gsap.js']);
    expect(f.files[0].integrity).toBe('sha512-xyz');
    expect(f.defaults).toEqual(['gsap.min.js']);
    expect(urls.every((u) => u.startsWith('/proxy/libs-proxy.php?url=https%3A%2F%2Fapi.cdnjs.com'))).toBe(true);
  });

  it('HTTP errors reject', async () => {
    await expect(jsdelivr.versions({ fetch: () => json({}, 500) as any }, 'x')).rejects.toThrow(/HTTP 500/);
  });

  it('presets are valid libraries with pinned versions in their URLs', () => {
    for (const p of PRESETS) {
      const lib = normalizeLibrary(p)!;
      expect(lib.files.length, p.name).toBe(p.files.length);
      for (const f of lib.files) expect(f.url, p.name).toContain(`@${p.version}/`);
    }
  });
});

describe('selector picker', () => {
  it('ranks hooks, own classes, stable ids, attributes; flags GrapesJS ids and tags', () => {
    document.body.innerHTML = `
      <button id="ixk2" class="btn js-open gjs-selected" data-modal="signup">Open</button>
      <button class="btn">Other</button>
      <div id="popup" class="popup"></div>`;
    const btn = document.querySelector('button')!;
    const c = selectorCandidates(btn);
    expect(c.map((x) => x.selector)).toEqual(['.js-open', '[data-modal="signup"]', '.btn', '.btn.js-open', '#ixk2', 'button']);
    expect(c.find((x) => x.selector === '.btn')!.count).toBe(2);
    expect(c.find((x) => x.selector === '#ixk2')!.note).toBe('unstable');
    expect(c.find((x) => x.selector === 'button')!.note).toBe('generic');
    expect(selectorCandidates(document.getElementById('popup')!).map((x) => x.selector)).toEqual(['#popup', '.popup', 'div']);
    expect(AUTO_ID.test('popup')).toBe(false);
    expect(suggestHookClass(btn, (c) => c === 'js-open')).toBe('js-open-2');
  });
});

describe('library nodes', () => {
  it('call function, create object, call method, global value, JSON object', () => {
    document.body.innerHTML = '<div class="slider"></div><p id="out"></p>';
    const calls: unknown[] = [];
    (window as any).Lib = {
      to: (...a: unknown[]) => (calls.push(a), 'ok'),
      Widget: class {
        el: unknown;
        opts: any;
        constructor(el: unknown, opts: unknown) {
          this.el = el;
          this.opts = opts;
        }
        next(n: number) {
          return `next${n}+${this.opts.speed}`;
        }
      },
    };
    const r = start([
      graph(
        [
          ['s', 'event.start'],
          ['opts', 'data.object', { json: '{"speed": 600}' }],
          ['q', 'dom.query', { selector: '.slider' }],
          ['call', 'lib.call', { fn: 'Lib.to', args: 2, arg2: 'x' }],
          ['make', 'lib.new', { cls: 'Lib.Widget', args: 2 }],
          ['m', 'lib.method', { method: 'next', args: 1, arg1: 3 }],
          ['txt', 'dom.setText', { target: '#out' }],
          ['g', 'lib.get', { name: 'location.protocol' }],
        ],
        ['s.then > call.exec', 'q.first > call.arg1', 'call.then > make.exec', 'q.first > make.arg1', 'opts.value > make.arg2', 'make.then > m.exec', 'make.object > m.target', 'm.then > txt.exec', 'm.result > txt.text'],
      ),
    ]);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(calls).toEqual([[document.querySelector('.slider'), 'x']]);
    expect(document.getElementById('out')!.textContent).toBe('next3+600');
    r.stop();
  });

  it('invalid JSON and bad names are reported', () => {
    const r = start([graph([['s', 'event.start'], ['o', 'data.object', { json: '{oops' }], ['c', 'lib.call', { fn: 'not a name', args: 1 }]], ['s.then > c.exec', 'o.value > c.arg1'])]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['node-warning', 'node-warning']);
    r.stop();
  });

  it('a missing function warns instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<button id="b"></button>';
    const r = start([graph([['e', 'event.element', { selector: '#b' }], ['c', 'lib.call', { fn: 'Nope.fn', args: 0 }]], ['e.then > c.exec'])]);
    click(document.getElementById('b'));
    expect(warn).toHaveBeenCalledWith('[blueprint] not a function: Nope.fn');
    r.stop();
  });
});
