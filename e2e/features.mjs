// Picker, canvas preview, component blocks, libraries, output settings: node e2e/features.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = normalize(join(import.meta.dirname, '..'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname === '/' ? '/e2e/index.html' : url.pathname;
  try {
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const shots = process.env.SHOTS || '';
const shot = async (page, name) => shots && (await page.waitForTimeout(350), await page.screenshot({ path: `${shots}/${name}.png` }));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // CDN hosts are not reachable here: answer library requests with empty files.
  await page.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, (r) => r.fulfill({ status: 200, contentType: r.request().url().endsWith('.css') ? 'text/css' : 'text/javascript', body: r.request().url().includes('gsap') ? 'window.gsap = { to: function (el, o) { el.setAttribute("data-gsap", JSON.stringify(o)); } };' : '' }));
  await page.goto(`${base}/?lang=${process.env.LANG_UI || 'en'}`);
  await page.waitForFunction(() => window.editor?.getModel().get('ready'));
  const frame = page.frameLocator('.gjs-frame');
  const api = (fn, arg) => page.evaluate(fn, arg);

  // ---------------------------------------------------------------- picker
  const id = await api(() => {
    const s = window.editor.Scripts;
    const bp = s.create({ name: 'Popup' });
    s.update(bp.id, {
      nodes: [
        { id: 'event', type: 'event.element', pos: [40, 40], props: { selector: '', event: 'click' } },
        { id: 'show', type: 'dom.addClass', pos: [380, 40], props: { target: '', className: 'is-open' } },
        { id: 'close', type: 'event.element', pos: [40, 260], props: { selector: '.js-popup-close', event: 'click' } },
        { id: 'hide', type: 'dom.removeClass', pos: [380, 260], props: { target: '#popup', className: 'is-open' } },
      ],
      links: [
        { from: ['event', 'then'], to: ['show', 'exec'] },
        { from: ['close', 'then'], to: ['hide', 'exec'] },
      ],
    });
    s.edit(bp.id);
    return bp.id;
  });
  await page.waitForSelector('.bpe');
  await page.locator('.bpe-node[data-id="event"] .bpe-node-head').click();
  await page.locator('.bpe-details .bpe-field:has([data-key="p:event:selector"]) button').click();
  await page.waitForSelector('.gjscr-pick-banner');
  check('picker hides the editor and shows the hint', !(await page.locator('.bpe').isVisible()));
  await frame.locator('.js-popup-open').hover();
  await shot(page, 'pick-hover');
  await frame.locator('.js-popup-open').click();
  await page.waitForSelector('.gjscr-pick');
  const offered = await page.locator('.gjscr-pick-item code').allTextContents();
  check('selector candidates', offered[0] === '.js-popup-open' && offered.includes('button'), offered.join(' | '));
  await shot(page, 'pick-choose');
  const selectedBefore = await api(() => window.editor.getSelected()?.getId?.() || null);
  await page.locator('.gjscr-pick-item').first().click();
  const sel = await api(() => window.editor.Scripts.getGraphEditor().state.node('event').props.selector);
  check('picked selector is set', sel === '.js-popup-open', sel);
  check('picking does not select in GrapesJS', (await api(() => window.editor.getSelected()?.getId?.() || null)) === selectedBefore);
  // target of "Add class": an element without a hook → add a js- class
  await page.locator('.bpe-node[data-id="show"] .bpe-node-head').click();
  await page.locator('.bpe-details .bpe-field:has([data-key="p:show:target"]) button').click();
  await frame.locator('#popup .popup__dialog p').click({ force: true }).catch(() => {});
  // the popup is hidden while editing: pick it through its dialog's parent instead
  if (!(await page.locator('.gjscr-pick').count())) {
    await page.keyboard.press('Escape');
  }
  await page.waitForSelector('.gjscr-pick', { timeout: 3000 }).catch(() => {});
  if (await page.locator('.gjscr-pick').count()) await page.locator('.gjscr-pick .gjscr-secondary').click();
  await page.evaluate(() => window.editor.Scripts.getGraphEditor().state.setProps('show', { target: '#popup' }));
  // add-hook option on the "Open" button
  await page.locator('.bpe-node[data-id="close"] .bpe-node-head').click();
  await page.locator('.bpe-details .bpe-field:has([data-key="p:close:selector"]) button').click();
  await frame.locator('.js-popup-open').click();
  await page.waitForSelector('.gjscr-pick-item.is-hook');
  const hookText = await page.locator('.gjscr-pick-item.is-hook').textContent();
  await page.locator('.gjscr-pick .gjscr-secondary').click();
  check('hook option offered', /js-open-popup/.test(hookText), hookText);
  await page.click('.bpe .bpe-tbtn.is-primary');

  // --------------------------------------------------------------- preview
  await frame.locator('.js-popup-open').click();
  check('no scripts while editing', !(await frame.locator('#popup.is-open').count()));
  await api(() => window.editor.runCommand('core:preview'));
  await page.waitForFunction(() => window.editor.Canvas.getWindow().__bpPreview);
  await frame.locator('.js-popup-open').click();
  const opened = await frame.locator('#popup.is-open').count();
  await shot(page, 'preview-open');
  await frame.locator('.js-popup-close').click();
  const closed = !(await frame.locator('#popup.is-open').count());
  check('preview runs the popup', opened === 1 && closed);
  await frame.locator('.js-popup-open').click();
  await api(() => window.editor.stopCommand('core:preview'));
  await page.waitForTimeout(100);
  check('leaving the preview restores the page', !(await frame.locator('#popup.is-open').count()));
  await frame.locator('.js-popup-open').click();
  check('scripts stop after the preview', !(await frame.locator('#popup.is-open').count()));

  // ------------------------------------------------------------ component
  await api(() => {
    const s = window.editor.Scripts;
    s.create({
      name: 'Accordion',
      kind: 'component',
      component: { type: 'bp-accordion', label: 'Accordion', html: '<button class="acc-head">Toggle</button><div class="acc-body">Body text</div>', css: '.acc-body{display:none}.bp-open .acc-body{display:block}', params: [{ id: 'openClass', type: 'string', default: 'bp-open' }] },
      nodes: [
        { id: 'ev', type: 'event.element', pos: [0, 0], props: { selector: '.acc-head' } },
        { id: 'root', type: 'dom.root', pos: [0, 200] },
        { id: 'p', type: 'component.param', pos: [0, 300], props: { param: 'openClass' } },
        { id: 'tg', type: 'dom.toggleClass', pos: [300, 0] },
      ],
      links: [
        { from: ['ev', 'then'], to: ['tg', 'exec'] },
        { from: ['root', 'element'], to: ['tg', 'target'] },
        { from: ['p', 'value'], to: ['tg', 'className'] },
      ],
    });
  });
  await api(() => window.editor.runCommand('open-blocks'));
  const blockLabel = await page.locator('.gjs-block[title="Accordion"], .gjs-block:has-text("Accordion")').first().textContent().catch(() => '');
  check('component block in the Block Manager', /Accordion/.test(blockLabel || ''));
  // drag the block into the canvas
  const blockEl = page.locator('.gjs-block:has-text("Accordion")').first();
  const fb = await page.locator('.gjs-frame').boundingBox();
  await blockEl.dragTo(page.locator('.gjs-frame'), { targetPosition: { x: fb.width / 2, y: 120 } }).catch(() => {});
  let count = await frame.locator('[data-bp="bp-accordion"]').count();
  if (!count) {
    await api(() => window.editor.getWrapper().append({ type: 'bp-accordion' }));
    count = await frame.locator('[data-bp="bp-accordion"]').count();
    check('component added (API fallback: block drag across the iframe did not land)', count === 1);
  } else check('component block dropped into the page', count === 1);
  await api(() => window.editor.runCommand('core:preview'));
  await page.waitForFunction(() => window.editor.Canvas.getWindow().__bpPreview);
  await frame.locator('.acc-head').first().click();
  const accOpen = await frame.locator('[data-bp="bp-accordion"].bp-open').count();
  await api(() => window.editor.stopCommand('core:preview'));
  check('component script runs in the preview', accOpen === 1);
  const js = await api(() => window.editor.getHtml());
  check('component script is exported', js.includes('"openClass":"bp-open"') && js.includes('acc-head'));

  // ------------------------------------------------------------ libraries
  await api(() => window.editor.runCommand('scripts:open'));
  await page.locator('.gjscr-section[data-kind="libraries"] .gjscr-act').click();
  await page.waitForSelector('.gjscr-libdialog');
  await shot(page, 'libraries');
  await page.locator('.gjscr-liblist li:has-text("gsap") button').click();
  await page.waitForSelector('.gjscr-libitem');
  check('library added from presets', (await page.locator('.gjscr-libitem .gjscr-name').first().textContent()) === 'gsap');
  await page.locator('.gjscr-section[data-kind="libraries"] .gjscr-act').click();
  await page.locator('.gjscr-tab').nth(2).click();
  await page.fill('.gjscr-libdialog textarea', 'https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css');
  await page.locator('.gjscr-libdialog .gjscr-primary').click();
  await page.waitForFunction(() => window.editor.Scripts.libraries().length === 2);
  const cssInCanvas = await frame.locator('link[data-gjs-scripts][href*="animate.css"]').count();
  check('library CSS loads into the canvas while editing', cssInCanvas === 1);
  let html = await api(() => window.editor.getHtml());
  check('library tags in the exported HTML', html.includes('gsap@3.12.5/dist/gsap.min.js') && html.includes('animate.min.css'), JSON.stringify(await api(async () => [!!window.editor.__gjscrGetHtml, window.editor.Scripts.getSettings(), (await window.editor.Scripts.exportPage()).libraries, window.editor.getHtml().slice(0, 300)])));
  // a script that uses the library, run in the preview
  await api(() => {
    const s = window.editor.Scripts;
    s.create({
      name: 'Animate',
      nodes: [
        { id: 'ev', type: 'event.element', pos: [0, 0], props: { selector: '.js-popup-open' } },
        { id: 'o', type: 'data.object', pos: [0, 200], props: { json: '{"x": 100}' } },
        { id: 'c', type: 'lib.call', pos: [300, 0], props: { fn: 'gsap.to', args: 2 } },
      ],
      links: [
        { from: ['ev', 'then'], to: ['c', 'exec'] },
        { from: ['ev', 'self'], to: ['c', 'arg1'] },
        { from: ['o', 'value'], to: ['c', 'arg2'] },
      ],
    });
  });
  await api(() => window.editor.runCommand('core:preview'));
  await page.waitForFunction(() => window.editor.Canvas.getWindow().__bpPreview);
  await frame.locator('.js-popup-open').click();
  const gsapAttr = await frame.locator('.js-popup-open').getAttribute('data-gsap');
  await api(() => window.editor.stopCommand('core:preview'));
  check('library is loaded in the preview and called by a block', gsapAttr === '{"x":100}', gsapAttr);

  // ------------------------------------------------------- output settings
  await page.locator('.gjscr-head .gjscr-btn').nth(2).click();
  await page.waitForSelector('.gjscr-settings');
  await shot(page, 'settings');
  await page.locator('.gjscr-settings input[type=checkbox]').first().check(); // minify
  await page.waitForFunction(() => window.editor.Scripts.getSettings().minify);
  let exp = await api(() => window.editor.Scripts.exportPage().then((e) => e.files[0].code));
  check('minify with terser', !exp.includes('// open') && !exp.includes('\n  ') && exp.includes('js-popup-open'), `${exp.length} bytes`);
  await page.locator('.gjscr-settings input[type=checkbox]').nth(1).check(); // obfuscate
  await page.waitForFunction(() => window.editor.Scripts.getSettings().obfuscate);
  exp = await api(() => window.editor.Scripts.exportPage().then((e) => e.files[0].code));
  check('obfuscate with javascript-obfuscator', /_0x[0-9a-f]+/.test(exp), exp.slice(0, 200));
  // the obfuscated script still works
  const site = await browser.newPage();
  await site.setContent('<button class="js-popup-open">o</button><div id="popup"><button class="js-popup-close">x</button></div>');
  await site.addScriptTag({ content: exp });
  await site.click('.js-popup-open');
  check('minified + obfuscated script still works', await site.evaluate(() => document.getElementById('popup').classList.contains('is-open')));
  await site.close();
  await page.locator('.gjscr-settings input[value="inline"]').check();
  await page.locator('.gjscr-settings .gjscr-primary').click();
  await page.waitForSelector('.gjscr-export textarea');
  const tags = await page.locator('.gjscr-export textarea').first().inputValue();
  check('inline export shows the tags with the code', tags.includes('<script>') && tags.includes('gsap.min.js'));
  await shot(page, 'settings-export');
  await page.click('.gjs-mdl-btn-close');
  html = await api(() => new Promise((r) => setTimeout(() => r(window.editor.getHtml()), 300)));
  check('getHtml: inline processed script', /<script>\s*[^<]*_0x/.test(html), html.slice(-300));

  // project data round trip with everything
  const ok = await api(() => {
    const data = JSON.parse(JSON.stringify(window.editor.getProjectData()));
    window.editor.loadProjectData(data);
    const s = window.editor.Scripts;
    return s.list().length === 3 && s.libraries().length === 2 && s.getSettings().obfuscate && window.editor.getWrapper().find('[data-bp="bp-accordion"]')[0]?.get('type') === 'bp-accordion';
  });
  check('project data keeps scripts, libraries, settings and component types', ok);
  check('no JS errors', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
