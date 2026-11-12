// Generates docs/nodes.md (English) and docs/nodes.ru.md (Russian) from the node registry.
// Run after `npm run build`: node scripts/gen-nodes.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_NODES, createRegistry, defaultProps, graphLocales } from '../dist/grapesjs-scripts.js';

const reg = createRegistry();
const CATS = ['events', 'flow', 'dom', 'data', 'variables', 'math', 'logic', 'code', 'debug'];
const L = {
  en: { title: 'Blocks reference', intro: 'Generated from the node registry (`scripts/gen-nodes.mjs`). Pin types: `exec` (order of execution), `string`, `number`, `boolean`, `element`, `elements`, `event`, `object`, `any`. A text value on an element pin is a CSS selector.', inputs: 'Inputs', outputs: 'Outputs', settings: 'Settings', type: 'Type', dyn: 'pins depend on the settings', none: '—', cat: (c) => c.charAt(0).toUpperCase() + c.slice(1) },
  ru: { title: 'Справочник блоков', intro: 'Сгенерировано из реестра нод (`scripts/gen-nodes.mjs`). Типы пинов: `exec` (порядок выполнения), `string`, `number`, `boolean`, `element`, `elements`, `event`, `object`, `any`. Текст на пине элемента — это CSS-селектор.', inputs: 'Входы', outputs: 'Выходы', settings: 'Настройки', type: 'Тип', dyn: 'пины зависят от настроек', none: '—', cat: (c) => graphLocales.ru[`cat.${c}`] || c },
};
for (const lang of ['en', 'ru']) {
  const T = L[lang];
  const tr = (key, fb) => (lang === 'en' ? fb : graphLocales.ru[key] || fb);
  const label = (s) => (s ? tr(`label.${s}`, s) : '');
  const pin = (p) => `\`${p.type}\` ${label(p.label) || (p.type === 'exec' ? '' : p.id)}${p.default !== undefined && p.default !== '' ? ` = \`${JSON.stringify(p.default)}\`` : ''}`.trim();
  let out = `# ${T.title}\n\n${T.intro}\n`;
  for (const cat of CATS) {
    const defs = BUILTIN_NODES.filter((d) => d.category === cat);
    if (!defs.length) continue;
    out += `\n## ${T.cat(cat)}\n`;
    for (const d of defs) {
      const ports = reg.ports(d.type, defaultProps(d));
      out += `\n### ${tr(`node.${d.type}`, d.title)} — \`${d.type}\`\n\n${tr(`desc.${d.type}`, d.description || '')}\n\n`;
      if (typeof d.ports === 'function') out += `*${T.dyn}*\n\n`;
      out += `- **${T.inputs}:** ${ports.inputs.map(pin).join(', ') || T.none}\n`;
      out += `- **${T.outputs}:** ${ports.outputs.map(pin).join(', ') || T.none}\n`;
      if (d.props?.length) out += `- **${T.settings}:** ${d.props.map((p) => `${label(p.label) || p.id} (\`${p.id}\`${p.default !== undefined && p.default !== '' && p.type !== 'code' ? ` = \`${JSON.stringify(p.default)}\`` : ''}${p.options ? `; ${p.options.map((o) => `\`${o.value}\``).join(' ')}` : ''})`).join(', ')}\n`;
    }
  }
  writeFileSync(join(import.meta.dirname, '..', 'docs', lang === 'en' ? 'nodes.md' : 'nodes.ru.md'), out);
  console.log(lang, out.length);
}
