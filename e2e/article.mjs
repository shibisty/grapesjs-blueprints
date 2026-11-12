// Walks docs/article-popup.md step by step in Russian and takes its screenshots:
//   node e2e/article.mjs            (checks only)
//   SHOTS=docs/img node e2e/article.mjs
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
const shot = async (page, name, clip) => {
  if (!shots) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${name}.png`, ...(clip ? { clip } : {}) });
};
const center = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const drag = async (page, from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?lang=ru`);
  await page.waitForFunction(() => window.editor?.getModel().get('ready'));
  const frame = page.frameLocator('.gjs-frame');
  const ge = (fn) => page.evaluate(fn);

  // 1. Скрипты → + → «Попап», глобальный
  await page.locator('.gjs-pn-views .gjs-pn-btn[title="Скрипты"]').click();
  await page.locator('.gjscr-head .gjscr-btn').first().click();
  await page.fill('#gjscr-name', 'Попап');
  await shot(page, '01-create');
  await page.click('.gjscr-modal .gjscr-primary');
  await page.waitForSelector('.bpe .bpe-node[data-id="event"]');
  await shot(page, '02-editor');
  check('1. скрипт создан, редактор открыт', true);

  // 2. селектор кнопки пипеткой
  await page.locator('.bpe-node[data-id="event"] .bpe-node-head').click();
  await page.locator('.bpe-details .bpe-field:has([data-key="p:event:selector"]) button').click();
  await frame.locator('.js-popup-open').hover();
  await shot(page, '03-pick');
  await frame.locator('.js-popup-open').click();
  await page.waitForSelector('.gjscr-pick');
  await shot(page, '04-pick-choose');
  await page.locator('.gjscr-pick-item').first().click();
  check('2. селектор выбран пипеткой', (await ge(() => window.editor.Scripts.getGraphEditor().state.node('event').props.selector)) === '.js-popup-open');

  // 3. «Добавить класс» из палитры
  const canvas = page.locator('.bpe-canvas');
  const cb = await canvas.boundingBox();
  await page.fill('.bpe-palette-search', 'класс');
  await page.locator('.bpe-palette .bpe-pitem[data-type="dom.addClass"]').dragTo(canvas, { targetPosition: { x: cb.width / 2 + 230, y: cb.height / 2 - 60 } });
  await page.fill('.bpe-palette-search', '');
  const addId = await ge(() => window.editor.Scripts.getGraphEditor().state.bp.nodes.find((n) => n.type === 'dom.addClass').id);
  const lit = (node, pin) => page.locator(`.bpe-node[data-id="${node}"] .bpe-pin[data-pin="${pin}"] .bpe-lit`);
  await lit(addId, 'target').fill('#popup');
  await lit(addId, 'target').press('Enter');
  await lit(addId, 'className').fill('is-open');
  await lit(addId, 'className').press('Enter');
  const dot = (node, side, pin) => page.locator(`.bpe-node[data-id="${node}"] .bpe-pin[data-side="${side}"][data-pin="${pin}"] .bpe-dot`);
  await drag(page, await center(dot('event', 'out', 'then')), await center(dot(addId, 'in', 'exec')));
  await page.mouse.click(cb.x + 30, cb.y + cb.height - 30);
  await shot(page, '05-open-chain');
  check('3. цепочка открытия собрана', (await ge(() => window.editor.Scripts.getGraphEditor().state.bp.links.length)) === 1);

  // 4. закрытие: ПКМ → поиск, провод в пустоту → «Убрать класс»
  await page.mouse.click(cb.x + 140, cb.y + cb.height - 300, { button: 'right' });
  await page.keyboard.type('событие элемента');
  await shot(page, '06-search');
  await page.keyboard.press('Enter');
  const closeId = await ge(() => window.editor.Scripts.getGraphEditor().state.bp.nodes.filter((n) => n.type === 'event.element')[1].id);
  await page.fill(`[data-key="p:${closeId}:selector"]`, '.js-popup-close');
  await page.press(`[data-key="p:${closeId}:selector"]`, 'Enter');
  const a = await center(dot(closeId, 'out', 'then'));
  await drag(page, a, { x: a.x + 180, y: a.y });
  await page.keyboard.type('убрать класс');
  await page.keyboard.press('Enter');
  const remId = await ge(() => window.editor.Scripts.getGraphEditor().state.bp.nodes.find((n) => n.type === 'dom.removeClass').id);
  await lit(remId, 'target').fill('#popup');
  await lit(remId, 'target').press('Enter');
  await lit(remId, 'className').fill('is-open');
  await lit(remId, 'className').press('Enter');
  await page.mouse.click(cb.x + 30, cb.y + cb.height - 30);
  await page.keyboard.press('f');
  await shot(page, '07-graph');
  check('4. цепочка закрытия собрана', (await ge(() => window.editor.Scripts.getGraphEditor().state.bp.links.length)) === 2);

  // 5. вкладка JavaScript
  await page.locator('.bpe-tab').nth(1).click();
  await shot(page, '08-js');
  check('5. JS содержит обе цепочки', /classList\.add\("is-open"\)[\s\S]*classList\.remove\("is-open"\)/.test(await page.locator('.bpe-code').textContent()));
  await page.locator('.bpe-tab').nth(0).click();
  await page.click('.bpe-tbtn.is-primary');

  // 6. превью
  await page.locator('.gjscr-head .gjscr-btn').nth(1).click();
  await page.waitForFunction(() => window.editor.Canvas.getWindow().__bpPreview);
  await frame.locator('.js-popup-open').click();
  await shot(page, '09-preview');
  const opened = await frame.locator('#popup.is-open').count();
  await frame.locator('.js-popup-close').click();
  check('6. превью: открывается и закрывается', opened === 1 && !(await frame.locator('#popup.is-open').count()));
  await ge(() => window.editor.stopCommand('core:preview'));

  // 7. бонус: Escape и клик по фону
  const bpId = await ge(() => window.editor.Scripts.list()[0].id);
  await ge(() => window.editor.Scripts.edit(window.editor.Scripts.list()[0].id));
  await page.waitForSelector('.bpe');
  const node = (type, x, y, props) => ge(`window.editor.Scripts.getGraphEditor().state.addNode(${JSON.stringify(type)}, [${x}, ${y}], ${JSON.stringify(props || {})})`);
  const remPos = await ge(`window.editor.Scripts.getGraphEditor().state.node(${JSON.stringify(remId)}).pos`);
  const esc = await node('event.key', remPos[0] - 340, remPos[1] + 200, { key: 'Escape' });
  const bg = await node('event.element', remPos[0] - 340, remPos[1] + 380, { selector: '.popup', event: 'click' });
  const tgt = await node('event.target', remPos[0] - 60, remPos[1] + 560);
  const match = await node('dom.matches', remPos[0] + 200, remPos[1] + 560, { selector: '.popup' });
  const iff = await node('flow.branch', remPos[0] - 60, remPos[1] + 380);
  await page.waitForTimeout(100);
  await ge(() => window.editor.Scripts.getGraphEditor().state.clearSelection());
  await ge(() => window.editor.Scripts.getGraphEditor().fit());
  await page.waitForTimeout(100);
  await drag(page, await center(dot(esc, 'out', 'then')), await center(dot(remId, 'in', 'exec')));
  await drag(page, await center(dot(bg, 'out', 'then')), await center(dot(iff, 'in', 'exec')));
  await drag(page, await center(dot(bg, 'out', 'event')), await center(dot(tgt, 'in', 'event')));
  await drag(page, await center(dot(tgt, 'out', 'target')), await center(dot(match, 'in', 'target')));
  await drag(page, await center(dot(match, 'out', 'result')), await center(dot(iff, 'in', 'condition')));
  await drag(page, await center(dot(iff, 'out', 'true')), await center(dot(remId, 'in', 'exec')));
  await page.mouse.click(cb.x + 30, cb.y + 30);
  await page.keyboard.press('f');
  await shot(page, '10-bonus');
  const links = await ge(() => window.editor.Scripts.getGraphEditor().state.bp.links.length);
  check('7. бонус собран мышью', links === 8, String(links));
  await page.click('.bpe-tbtn.is-primary');
  // проверка бонуса в превью
  await ge(() => window.editor.runCommand('core:preview'));
  await page.waitForFunction(() => window.editor.Canvas.getWindow().__bpPreview);
  await frame.locator('.js-popup-open').click();
  await frame.locator('.popup__dialog p').click();
  const stillOpen = await frame.locator('#popup.is-open').count();
  await frame.locator('#popup').click({ position: { x: 10, y: 10 } });
  const byBackdrop = !(await frame.locator('#popup.is-open').count());
  await frame.locator('.js-popup-open').click();
  await page.keyboard.press('Escape');
  await frame.locator('body').press('Escape');
  const byEsc = !(await frame.locator('#popup.is-open').count());
  await ge(() => window.editor.stopCommand('core:preview'));
  check('7. бонус работает: клик внутри не закрывает, фон и Escape закрывают', stillOpen === 1 && byBackdrop && byEsc);

  // 8. экспорт
  await page.locator('.gjscr-head .gjscr-btn').nth(2).click();
  await page.locator('.gjscr-settings .gjscr-primary').click();
  await page.waitForSelector('.gjscr-export textarea');
  await shot(page, '11-export');
  await page.click('.gjs-mdl-btn-close');
  const code = await ge(() => window.editor.Scripts.exportPage().then((e) => e.files[0].code));
  const site = await browser.newPage();
  await site.setContent('<button class="js-popup-open">o</button><div id="popup" class="popup"><div class="d"><button class="js-popup-close">x</button></div></div>');
  await site.addScriptTag({ content: code });
  await site.click('.js-popup-open');
  const s1 = await site.evaluate(() => document.getElementById('popup').classList.contains('is-open'));
  await site.keyboard.press('Escape');
  const s2 = await site.evaluate(() => !document.getElementById('popup').classList.contains('is-open'));
  check('8. экспортированный scripts.js работает на странице', s1 && s2);
  await site.close();
  check('нет JS-ошибок', errors.length === 0, errors.join('; '));
  if (process.env.SAVE_BP) console.log(JSON.stringify(await ge(() => window.editor.Scripts.list()[0])));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
