// JS / CSS tabs and the code editor in a real browser: node e2e/code.mjs
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
  await page.goto(`${base}/?lang=${process.env.LANG_UI || 'en'}`);
  await page.waitForFunction(() => window.editor?.getModel().get('ready'));
  const frame = page.frameLocator('.gjs-frame');
  const api = (fn, arg) => page.evaluate(fn, arg);

  // ------------------------------------------------------------ the JS tab
  await api(() => window.editor.runCommand('scripts:open'));
  await page.click('.gjscr-stab[data-tab="js"]');
  check('JS tab is active', await page.locator('.gjscr-stab[data-tab="js"].is-active').count() === 1);
  await page.click('.gjscr-head .gjscr-btn >> nth=0'); // +
  await page.waitForSelector('body > .gjscr-ce');
  check('a new item opens the code editor with CodeMirror', (await page.locator('.gjscr-ce .gjscr-ce-code .CodeMirror').count()) === 1);

  const cm = page.locator('.gjscr-ce .gjscr-ce-code .CodeMirror');
  await cm.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('var b = document.querySelector(".js-popup-open"');
  await page.waitForTimeout(50);
  check('a syntax error shows while typing', (await page.locator('.gjscr-ce-status.is-error').count()) === 1, await page.locator('.gjscr-ce-status').textContent());
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      'var b = document.querySelector(".js-popup-open");',
      'function open() { document.getElementById("popup").classList.add("is-open"); }',
      'b.addEventListener("click", open);',
      'return function () { b.removeEventListener("click", open); };',
    ].join('\n'),
  );
  await page.waitForTimeout(50);
  check('valid code: no syntax error', (await page.locator('.gjscr-ce-status.is-error').count()) === 0);
  // Keys typed in the code do not reach GrapesJS (Delete would remove the selected component).
  const before = await api(() => window.editor.getWrapper().components().length);
  await api(() => window.editor.select(window.editor.getWrapper().components().at(0)));
  await cm.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  check('Delete in the code is not a GrapesJS shortcut', (await api(() => window.editor.getWrapper().components().length)) === before);
  await page.selectOption('.gjscr-ce-side select[aria-label="Runs"]', 'ready');
  await shot(page, 'code-editor');
  await page.click('.gjscr-ce .gjscr-primary'); // Done
  check('Done closes the editor and saves', (await page.locator('body > .gjscr-ce').count()) === 0 && (await api(() => window.editor.Scripts.code.list('js')[0].code.includes('addEventListener("click", open)'))));
  check('the item is listed in the JS tab', (await page.locator('.gjscr-item .gjscr-name').allTextContents()).includes('JavaScript 1'));
  await api(() => (window.editor.select(null), window.editor.runCommand('scripts:open')));
  await shot(page, 'js-tab');

  // ------------------------------------------------------------- preview
  await api(() => window.editor.runCommand('core:preview'));
  await page.waitForTimeout(300);
  await frame.locator('.js-popup-open').click();
  check('preview runs the JS item', (await frame.locator('#popup.is-open').count()) === 1);
  await api(() => window.editor.stopCommand('core:preview'));
  await page.waitForTimeout(200);
  await frame.locator('.js-popup-open').click({ force: true }).catch(() => undefined);
  check('after the preview the JS item is stopped (its cleanup ran)', (await frame.locator('#popup.is-open').count()) === 0);

  // -------------------------------------------------------------- export
  const html = await api(() => window.editor.getHtml());
  check('getHtml has the script tag', html.includes('<script src="scripts.js" defer></script>'));
  const file = await api(async () => (await window.editor.Scripts.exportPage()).files.find((f) => f.name === 'scripts.js')?.code || '');
  check('the exported file runs the item when the page is ready', file.includes('__gjscrRun({"name":"JavaScript 1","run":"ready"') && file.includes('addEventListener("click", open)'));

  // ---------------------------------------------------- component JS
  const type = await api(() => {
    const c = window.editor.Scripts.code.create({
      lang: 'js',
      kind: 'component',
      name: 'Greeting',
      code: 'root.textContent = "Hello, " + params.who; return function () { root.textContent = "bye"; };',
      component: { html: '<span>…</span>', params: [{ id: 'who', label: 'Who', type: 'string', default: 'world' }] },
    });
    window.editor.getWrapper().append({ type: c.component.type });
    return c.component.type;
  });
  check('component JS adds a block', await api((t) => !!window.editor.Blocks.get(`bp:${t}`), type));
  await api(() => window.editor.runCommand('core:preview'));
  await page.waitForTimeout(300);
  check('preview runs the component JS per instance with its parameters', (await frame.locator(`[data-bp="${type}"]`).textContent()) === 'Hello, world');
  await api(() => window.editor.stopCommand('core:preview'));
  await page.waitForTimeout(200);
  check('after the preview the instance is rendered from its model again', (await frame.locator(`[data-bp="${type}"]`).textContent()) === '…');

  // ------------------------------------------------------------ CSS tab
  await api(() => window.editor.runCommand('scripts:open'));
  await page.click('.gjscr-stab[data-tab="css"]');
  await page.click('.gjscr-head .gjscr-btn >> nth=0');
  await page.waitForSelector('body > .gjscr-ce[data-lang="css"]');
  check('CSS editor uses CodeMirror in css mode', await api(() => document.querySelector('.gjscr-ce .gjscr-ce-code .CodeMirror').CodeMirror.getOption('mode') === 'css'));
  await page.locator('.gjscr-ce .gjscr-ce-code .CodeMirror').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('.js-popup-open {\n  color: rgb(0, 128, 0);\n  border-radius: 12px;\n}');
  await page.waitForTimeout(100);
  check('the status counts the rules', (await page.locator('.gjscr-ce-status').textContent()).includes('rules: 1'));
  await shot(page, 'css-editor');
  await page.click('.gjscr-ce .gjscr-primary');
  await page.waitForTimeout(100);
  const color = await frame.locator('.js-popup-open').evaluate((el) => getComputedStyle(el).color);
  check('the CSS item styles the canvas', color === 'rgb(0, 128, 0)', color);
  // (the browser's CSS parser of GrapesJS writes border-radius as its four longhands)
  check('… and is in the page CSS (getCss)', /\.js-popup-open\{color:rgb\(0, 128, 0\);border-top-left-radius:12px;/.test(await api(() => window.editor.getCss())));
  check('… but not stored twice in the project', !(await api(() => JSON.stringify(window.editor.getProjectData().styles).includes('gjscr'))));
  // The Style Manager edits the item's rule (the page has none for this class).
  // As a user would: the Style Manager view, then the element.
  await api(() => {
    window.editor.select(null);
    window.editor.runCommand('open-sm');
  });
  await frame.locator('.js-popup-open').click();
  await page.waitForTimeout(150); // the Style Manager picks its targets a moment after the selection
  check('the Style Manager targets the item’s rule', await api(() => !!window.editor.StyleManager.getSelected()?.get('gjscr')));
  await api(() => window.editor.StyleManager.addStyleTargets({ color: 'rgb(200, 0, 0)' }) && undefined);
  await page.waitForTimeout(400);
  const cssCode = await api(() => window.editor.Scripts.code.list('css')[0].code);
  check('a Style Manager edit goes back into the item text', cssCode.includes('color: rgb(200, 0, 0);') && cssCode.includes('border-top-left-radius: 12px;'), JSON.stringify(cssCode));
  check('… and the canvas shows it', (await frame.locator('.js-popup-open').evaluate((el) => getComputedStyle(el).color)) === 'rgb(200, 0, 0)');
  await api(() => {
    window.editor.select(null);
    window.editor.runCommand('scripts:open');
  });
  await shot(page, 'css-tab');

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
