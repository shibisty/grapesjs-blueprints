// Builds the popup blueprint with the mouse in headless Chrome: node e2e/graph.mjs
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
const center = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?lang=${process.env.LANG_UI || 'en'}`);
  await page.waitForFunction(() => window.editor?.getModel().get('ready'));
  await page.waitForSelector('.gjscr', { state: 'attached' });
  await page.evaluate(() => window.editor.runCommand('scripts:open'));

  // 1. create → the editor opens with a starter event node
  await page.locator('.gjscr-head .gjscr-btn').first().click();
  await page.fill('#gjscr-name', 'Popup');
  await page.click('.gjscr-modal .gjscr-primary');
  await page.waitForSelector('.bpe .bpe-node');
  check('editor opens with the starter node', (await page.locator('.bpe-node').count()) === 1);
  const bpId = await page.evaluate(() => window.editor.Scripts.getGraphEditor().state.bp.id);

  // 2. selector of the starter node in the details panel
  await page.locator('.bpe-node[data-id="event"] .bpe-node-head').click();
  await page.fill('[data-key="p:event:selector"]', '.js-popup-open');
  await page.press('[data-key="p:event:selector"]', 'Enter');
  await page.locator('[data-key="p:event:selector"]').blur();
  check('selector set', (await page.locator('.bpe-node[data-id="event"] .bpe-node-sub').textContent()).includes('.js-popup-open'));

  // 3. drag "Add class" from the palette onto the canvas (HTML5 drag & drop)
  const canvas = page.locator('.bpe-canvas');
  const cb = await canvas.boundingBox();
  await page.locator('.bpe-palette .bpe-pitem[data-type="dom.addClass"]').dragTo(canvas, { targetPosition: { x: cb.width / 2 + 120, y: cb.height / 2 - 120 } });
  await page.waitForSelector('.bpe-node[data-id="n2"]');
  check('palette drag adds a node', true);

  // 4. inline literals
  const lit = (node, pin) => page.locator(`.bpe-node[data-id="${node}"] .bpe-pin[data-pin="${pin}"] .bpe-lit`);
  await lit('n2', 'target').fill('#popup');
  await lit('n2', 'target').press('Enter');
  await lit('n2', 'className').fill('is-open');
  await lit('n2', 'className').press('Enter');

  // 5. wire: event.then → addClass.exec with the mouse
  const dot = (node, side, pin) => page.locator(`.bpe-node[data-id="${node}"] .bpe-pin[data-side="${side}"][data-pin="${pin}"] .bpe-dot`);
  let a = await center(dot('event', 'out', 'then'));
  let b = await center(dot('n2', 'in', 'exec'));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  check('wire by mouse', (await page.locator('.bpe-wire').count()) === 1);

  // 6. right-click on empty canvas → search → "On element event"
  await page.mouse.click(cb.x + 200, cb.y + cb.height - 220, { button: 'right' });
  await page.waitForSelector('.bpe-search input');
  await page.keyboard.type('element event');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.bpe-node[data-id="n3"]');
  await page.fill('[data-key="p:n3:selector"]', '.js-popup-close');
  await page.press('[data-key="p:n3:selector"]', 'Enter');
  check('search popup adds a node', true);

  // 7. drag a wire from its "then" into empty space → filtered search → Remove class (auto-wired)
  a = await center(dot('n3', 'out', 'then'));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 160, a.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('.bpe-search input');
  const offered = await page.locator('.bpe-search .bpe-pitem').evaluateAll((els) => els.map((e) => e.dataset.type));
  check('filtered search only offers exec blocks', offered.includes('dom.removeClass') && !offered.includes('math.op') && !offered.includes('event.timer'));
  await page.keyboard.type('remove class');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.bpe-node[data-id="n4"]');
  await lit('n4', 'target').fill('#popup');
  await lit('n4', 'target').press('Enter');
  await lit('n4', 'className').fill('is-open');
  await lit('n4', 'className').press('Enter');
  check('dropped wire is connected', (await page.locator('.bpe-wire').count()) === 2);

  // 8. node drag moves it (snapped), undo restores
  const before = await page.evaluate(() => window.editor.Scripts.getGraphEditor().state.node('n4').pos);
  const head = await center(page.locator('.bpe-node[data-id="n4"] .bpe-node-head'));
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move(head.x + 100, head.y + 40, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.editor.Scripts.getGraphEditor().state.node('n4').pos);
  check('drag moves the node on the grid', after[0] !== before[0] && after[0] % 8 === 0 && after[1] % 8 === 0, `${before} → ${after}`);
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => window.editor.Scripts.getGraphEditor().state.node('n4').pos);
  check('Ctrl+Z undoes the move', undone[0] === before[0] && undone[1] === before[1]);

  // 9. zoom with the wheel, fit
  const z0 = await page.evaluate(() => window.editor.Scripts.getGraphEditor().zoom);
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(0, 300);
  const z1 = await page.evaluate(() => window.editor.Scripts.getGraphEditor().zoom);
  check('wheel zooms', z1 < z0, `${z0} → ${z1}`);
  await page.keyboard.press('f');
  if (shots) await page.waitForTimeout(100), await page.screenshot({ path: `${shots}/graph.png` });

  // 10. marquee selection + copy/paste + delete
  await page.mouse.move(cb.x + 5, cb.y + 5);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width - 240, cb.y + cb.height - 150, { steps: 6 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.editor.Scripts.getGraphEditor().state.selection.size);
  check('marquee selects all four', selected === 4, String(selected));
  await page.keyboard.press('Control+c');
  await page.mouse.move(cb.x + 300, cb.y + 300);
  await page.keyboard.press('Control+v');
  const count = await page.locator('.bpe-node').count();
  await page.keyboard.press('Delete');
  check('copy/paste and delete', count === 8 && (await page.locator('.bpe-node').count()) === 4);

  // 11. JS tab
  await page.locator('.bpe-tab').nth(1).click();
  const js = await page.locator('.bpe-code').textContent();
  check('JS tab shows the compiled script', js.includes('".js-popup-open"') && js.includes('classList.remove("is-open")'));
  if (shots) await page.screenshot({ path: `${shots}/graph-js.png` });
  await page.locator('.bpe-tab').nth(0).click();

  // 12. done → saved to the project; the script works on a page
  await page.click('.bpe-tbtn.is-primary');
  const saved = await page.evaluate((id) => window.editor.Scripts.get(id), bpId);
  check('saved on close', saved.nodes.length === 4 && saved.links.length === 2);
  const code = await page.evaluate(() => window.editor.Scripts.build().code);
  const site = await browser.newPage();
  await site.setContent('<button class="js-popup-open">o</button><div id="popup"><button class="js-popup-close">x</button></div>');
  await site.addScriptTag({ content: code });
  await site.click('.js-popup-open');
  const opened = await site.evaluate(() => document.getElementById('popup').classList.contains('is-open'));
  await site.click('.js-popup-close');
  const closed = await site.evaluate(() => !document.getElementById('popup').classList.contains('is-open'));
  check('the popup built with the mouse works', opened && closed);
  check('no JS errors', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
