// Headless Chrome smoke test of the built plugin: node e2e/run.mjs
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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/`);
  await page.waitForFunction(() => window.editor?.getModel().get('ready'));
  await page.waitForSelector('.gjscr', { state: 'attached' });

  // 1. view button opens the sidebar in the views container
  const btn = page.locator('.gjs-pn-views .gjs-pn-btn[title="Scripts"]');
  check('button in the views panel', (await btn.count()) === 1);
  await btn.click();
  check('sidebar visible', await page.locator('.gjscr').isVisible());
  check('inside views container', (await page.locator('.gjs-pn-views-container .gjscr').count()) === 1);

  // 2. create through the dialog
  await page.locator('.gjscr-head .gjscr-btn').first().click();
  await page.fill('#gjscr-name', 'Popup');
  if (shots) await page.waitForTimeout(400), await page.screenshot({ path: `${shots}/create.png` });
  await page.click('.gjscr-modal .gjscr-primary');
  await page.waitForSelector('.bpe');
  check('create → blueprint editor', (await page.locator('.bpe .bpe-name').inputValue()) === 'Popup');
  await page.click('.bpe .bpe-tbtn.is-primary');

  // 3. the popup graph (the editor UI comes next phase) → view JS
  await page.evaluate(() => {
    const api = window.editor.Scripts;
    const [bp] = api.list();
    api.update(bp.id, {
      nodes: [
        { id: 'open', type: 'event.element', pos: [40, 40], props: { selector: '.js-popup-open', event: 'click' } },
        { id: 'show', type: 'dom.addClass', pos: [360, 40], props: { target: '#popup', className: 'is-open' } },
        { id: 'close', type: 'event.element', pos: [40, 240], props: { selector: '.js-popup-close', event: 'click' } },
        { id: 'hide', type: 'dom.removeClass', pos: [360, 240], props: { target: '#popup', className: 'is-open' } },
      ],
      links: [
        { from: ['open', 'then'], to: ['show', 'exec'] },
        { from: ['close', 'then'], to: ['hide', 'exec'] },
      ],
    });
    api.create({ name: 'Product tabs', kind: 'component' });
    api.create({ name: 'Product page', kind: 'template', target: { when: 'body.product' } });
  });
  await page.waitForFunction(() => document.querySelectorAll('.gjscr-item').length === 3);
  check('three scripts listed', true);
  await page.locator('.gjscr-item').first().hover();
  if (shots) await page.screenshot({ path: `${shots}/sidebar.png` });
  await page.locator('.gjscr-item').first().hover();
  await page.locator('.gjscr-item').first().locator('.gjscr-act').first().click();
  await page.waitForSelector('.gjscr-codeview');
  check('no problems', (await page.locator('.gjs-mdl-content .gjscr-diags').textContent()) === 'No problems');
  if (shots) await page.waitForTimeout(400), await page.screenshot({ path: `${shots}/code.png` });
  await page.click('.gjs-mdl-btn-close');

  // 4. the built page script works in a real browser page
  const code = await page.evaluate(() => window.editor.Scripts.build().code);
  const site = await browser.newPage();
  await site.setContent('<button class="js-popup-open">o</button><div id="popup" class="popup"><button class="js-popup-close">x</button></div>');
  await site.addScriptTag({ content: code });
  await site.click('.js-popup-open');
  const opened = await site.evaluate(() => document.getElementById('popup').classList.contains('is-open'));
  await site.click('.js-popup-close');
  const closed = await site.evaluate(() => !document.getElementById('popup').classList.contains('is-open'));
  check('exported script opens and closes the popup', opened && closed);

  // 5. project data round trip, then Layers takes over the panel
  const ok = await page.evaluate(() => {
    const data = JSON.parse(JSON.stringify(window.editor.getProjectData()));
    window.editor.loadProjectData(data);
    return window.editor.Scripts.list().length === 3 && !!data.scripts;
  });
  check('project data round trip', ok);
  await page.evaluate(() => void window.editor.Panels.getButton('views', 'open-layers').set('active', true));
  check('Layers hides scripts', !(await page.locator('.gjscr').isVisible()));

  // 6. Russian UI
  await page.goto(`${base}/?lang=ru`);
  await page.waitForFunction(() => window.editor?.getModel().get('ready'));
  await page.locator('.gjs-pn-views .gjs-pn-btn[title="Скрипты"]').click();
  check('ru labels', (await page.locator('.gjscr-title').textContent()) === 'Скрипты');
  if (shots) await page.screenshot({ path: `${shots}/ru.png` });

  const errors = await page.evaluate(() => window.errors);
  check('no JS errors', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
