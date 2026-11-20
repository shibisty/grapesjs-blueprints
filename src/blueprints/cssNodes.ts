/**
 * Style nodes of the blueprints — "shaders" for CSS.
 *
 * Values (colours, units, gradients, shadows…) are pure nodes: their JS expressions
 * work in the page script and in the editor, where `css.rule` graphs are worked out
 * ahead of time (see `blueprintCss.ts`) and become ordinary GrapesJS rules.
 *
 * - `css.rule` ("Apply to selector") has no exec pins: the editor computes it and puts
 *   the rule into the page CSS (canvas, Style Manager, publish). Nothing at runtime.
 * - `css.apply`, `css.setVar` are actions: they change styles while the page runs.
 */
import type { CompileContext, NodeDef, PinDef, Ports } from 'blueprintsjs';

export const STYLE_CATEGORY = 'style';
const COLOR = '#c2185b';
const EXEC_IN: PinDef = { id: 'exec', type: 'exec' };
const THEN: PinDef = { id: 'then', type: 'exec' };

/** Colour maths in ES5 (the page script runs as is). */
const COLOR_LIB = `(function () {
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    if (!s) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  var NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', transparent: '#00000000' };
  function parse(c) {
    c = String(c == null ? '' : c).trim().toLowerCase();
    if (NAMED[c]) c = NAMED[c];
    var m = /^#([0-9a-f]{3,8})$/.exec(c);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.replace(/./g, function (x) { return x + x; });
      if (h.length !== 6 && h.length !== 8) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    m = /^(rgba?|hsla?)\\(([^)]*)\\)$/.exec(c);
    if (!m) return null;
    var p = m[2].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(isNaN)) return null;
    var a = p.length > 3 ? (/%/.test(m[2].split(/[\\s,\\/]+/).filter(Boolean)[3]) ? p[3] / 100 : p[3]) : 1;
    var rgb = m[1].charAt(0) === 'h' ? hsl2rgb(p[0], p[1], p[2]) : [p[0], p[1], p[2]];
    return [rgb[0], rgb[1], rgb[2], a];
  }
  function hex(x) { var s = Math.round(clamp(x, 0, 255)).toString(16); return s.length < 2 ? '0' + s : s; }
  function fmt(c) {
    var a = Math.round(clamp(c[3], 0, 1) * 1000) / 1000;
    if (a >= 1) return '#' + hex(c[0]) + hex(c[1]) + hex(c[2]);
    return 'rgba(' + Math.round(clamp(c[0], 0, 255)) + ', ' + Math.round(clamp(c[1], 0, 255)) + ', ' + Math.round(clamp(c[2], 0, 255)) + ', ' + a + ')';
  }
  function mix(a, b, t) {
    t = clamp(Number(t) || 0, 0, 1);
    var x = parse(a), y = parse(b);
    if (!x || !y) return 'color-mix(in srgb, ' + a + ' ' + Math.round((1 - t) * 100) + '%, ' + b + ')';
    return fmt([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, x[3] + (y[3] - x[3]) * t]);
  }
  return {
    mix: mix,
    shade: function (c, t) { t = Number(t) || 0; return t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#000000', -t); },
    alpha: function (c, a) { var x = parse(c); a = clamp(Number(a), 0, 1); if (!x) return 'color-mix(in srgb, ' + c + ' ' + Math.round(a * 100) + '%, transparent)'; x[3] = a; return fmt(x); },
    hsl: function (h, s, l, a) { var x = hsl2rgb(Number(h) || 0, Number(s) || 0, Number(l) || 0); return fmt([x[0], x[1], x[2], a == null || a === '' ? 1 : Number(a)]); },
    rgb: function (r, g, b, a) { return fmt([Number(r) || 0, Number(g) || 0, Number(b) || 0, a == null || a === '' ? 1 : Number(a)]); }
  };
})()`;

/** Pin name → CSS property: `backgroundColor` → `background-color`, `__brand` → `--brand`. */
export function cssProperty(pin: string): string {
  if (pin.startsWith('__')) return `--${pin.slice(2).replace(/_/g, '-')}`;
  return pin.replace(/_/g, '-').replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Runtime: one `<style>` per node, replaced on each run. */
const RULE_FN = `function (doc, key, sel, media, style) {
  var id = 'bp-css-' + key, el = doc.getElementById(id), body = '';
  for (var k in style) { var v = style[k]; if (v === '' || v == null || v !== v) continue; body += k + ': ' + v + '; '; }
  if (!el) { el = doc.createElement('style'); el.id = id; (doc.head || doc.documentElement).appendChild(el); }
  var css = sel + ' { ' + body + '}';
  el.textContent = media ? '@media ' + media + ' { ' + css + ' }' : css;
}`;

const lib = (c: CompileContext) => c.state('css', COLOR_LIB);

/** The target pin's elements, or the root (the page / the component) when it is empty. */
const targets = (c: CompileContext): string =>
  `(function (l) { return l.length ? l : [${c.root}.nodeType === 9 ? ${c.root}.documentElement : ${c.root}]; })(${c.h('els')}(${c.root}, ${c.in('target')}))`;

type PinList = { id: string; type: string }[];
const DEFAULT_PROPS: PinList = [{ id: 'color', type: 'string' }];
const propPins = (p: Record<string, unknown>): PinDef[] =>
  (Array.isArray(p.properties) ? (p.properties as PinList) : DEFAULT_PROPS)
    .filter((x) => x && typeof x.id === 'string' && x.id)
    .map((x) => ({ id: x.id, type: (x.type || 'string') as PinDef['type'], label: cssProperty(x.id), default: '' }));

/** `{ "color": <expr>, … }` of the property pins. */
export function styleObject(c: CompileContext, pins: PinDef[]): string {
  return `{ ${pins.map((p) => `${c.lit(cssProperty(p.id))}: ${c.in(p.id)}`).join(', ')} }`;
}

const STATES = [
  { value: '', label: '—' },
  { value: ':hover', label: ':hover' },
  { value: ':focus', label: ':focus' },
  { value: ':active', label: ':active' },
  { value: ':focus-within', label: ':focus-within' },
  { value: '::before', label: '::before' },
  { value: '::after', label: '::after' },
];

/** `.a, .b` + `:hover` → `.a:hover, .b:hover`. */
export function withState(sel: string, state: string): string {
  if (!state) return sel;
  return sel
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s}${state}`)
    .join(', ');
}

const pure = (def: Omit<NodeDef, 'category' | 'color'>): NodeDef => ({ category: STYLE_CATEGORY, color: COLOR, ...def });

const num = (id: string, label: string, d: number): PinDef => ({ id, type: 'number', label, default: d });
const str = (id: string, label: string, d: string): PinDef => ({ id, type: 'string', label, default: d });

export const RULE_NODE = 'css.rule';
export const APPLY_NODE = 'css.apply';

export const CSS_NODES: NodeDef[] = [
  pure({
    type: 'css.color',
    title: 'Color',
    description: 'A colour value (hex, rgb(), hsl(), a name or var(--x)).',
    keywords: ['colour', 'hex', 'css'],
    ports: { inputs: [str('color', 'Color', '#3b82f6')], outputs: [{ id: 'value', type: 'string', label: 'Color' }] },
    compile: (c) => ({ outputs: { value: `String(${c.in('color')})` } }),
  }),
  pure({
    type: 'css.unit',
    title: 'Length',
    description: 'A number with a CSS unit: 16 + px → "16px".',
    keywords: ['px', 'rem', 'em', 'percent', 'unit', 'size'],
    props: [
      { id: 'unit', type: 'select', label: 'Unit', default: 'px', options: ['px', 'rem', 'em', '%', 'vw', 'vh', 'deg', 'ms', 's', ''].map((u) => ({ value: u, label: u || '—' })) },
    ],
    ports: { inputs: [num('value', 'Value', 16)], outputs: [{ id: 'value', type: 'string', label: 'Value' }] },
    compile: (c) => ({ outputs: { value: `(Math.round(Number(${c.in('value')}) * 1000) / 1000 + ${c.lit(String(c.prop('unit') ?? 'px'))})` } }),
  }),
  pure({
    type: 'css.mix',
    title: 'Mix colors',
    description: 'Blends A into B: amount 0 → A, 1 → B.',
    keywords: ['blend', 'lerp', 'colour'],
    ports: { inputs: [str('a', 'A', '#3b82f6'), str('b', 'B', '#ffffff'), num('amount', 'Amount', 0.5)], outputs: [{ id: 'value', type: 'string', label: 'Color' }] },
    compile: (c) => ({ outputs: { value: `${lib(c)}.mix(${c.in('a')}, ${c.in('b')}, ${c.in('amount')})` } }),
  }),
  pure({
    type: 'css.shade',
    title: 'Lighten / darken',
    description: 'Amount above 0 mixes in white, below 0 mixes in black (−1…1).',
    keywords: ['lighten', 'darken', 'tint', 'shade', 'colour'],
    ports: { inputs: [str('color', 'Color', '#3b82f6'), num('amount', 'Amount', 0.2)], outputs: [{ id: 'value', type: 'string', label: 'Color' }] },
    compile: (c) => ({ outputs: { value: `${lib(c)}.shade(${c.in('color')}, ${c.in('amount')})` } }),
  }),
  pure({
    type: 'css.alpha',
    title: 'Transparency',
    description: 'The colour with an alpha (0…1).',
    keywords: ['opacity', 'alpha', 'rgba', 'colour'],
    ports: { inputs: [str('color', 'Color', '#3b82f6'), num('alpha', 'Alpha', 0.5)], outputs: [{ id: 'value', type: 'string', label: 'Color' }] },
    compile: (c) => ({ outputs: { value: `${lib(c)}.alpha(${c.in('color')}, ${c.in('alpha')})` } }),
  }),
  pure({
    type: 'css.hsl',
    title: 'HSL color',
    description: 'A colour from hue (0…360), saturation and lightness (0…100).',
    keywords: ['hue', 'saturation', 'lightness', 'colour'],
    ports: {
      inputs: [num('h', 'Hue', 220), num('s', 'Saturation', 90), num('l', 'Lightness', 55), num('a', 'Alpha', 1)],
      outputs: [{ id: 'value', type: 'string', label: 'Color' }],
    },
    compile: (c) => ({ outputs: { value: `${lib(c)}.hsl(${c.in('h')}, ${c.in('s')}, ${c.in('l')}, ${c.in('a')})` } }),
  }),
  pure({
    type: 'css.rgb',
    title: 'RGB color',
    description: 'A colour from red, green, blue (0…255) and alpha (0…1).',
    keywords: ['red', 'green', 'blue', 'colour'],
    ports: {
      inputs: [num('r', 'Red', 59), num('g', 'Green', 130), num('b', 'Blue', 246), num('a', 'Alpha', 1)],
      outputs: [{ id: 'value', type: 'string', label: 'Color' }],
    },
    compile: (c) => ({ outputs: { value: `${lib(c)}.rgb(${c.in('r')}, ${c.in('g')}, ${c.in('b')}, ${c.in('a')})` } }),
  }),
  pure({
    type: 'css.gradient',
    title: 'Gradient',
    description: 'linear-gradient() / radial-gradient() of two or three colours.',
    keywords: ['linear', 'radial', 'background'],
    props: [
      {
        id: 'kind',
        type: 'select',
        label: 'Kind',
        default: 'linear',
        options: [
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
        ],
      },
    ],
    ports: {
      inputs: [num('angle', 'Angle', 180), str('from', 'From', '#3b82f6'), str('via', 'Via', ''), str('to', 'To', '#9333ea')],
      outputs: [{ id: 'value', type: 'string', label: 'Gradient' }],
    },
    compile: (c) => {
      const stops = `[${c.in('from')}, ${c.in('via')}, ${c.in('to')}].filter(function (x) { return x !== '' && x != null; }).join(', ')`;
      return {
        outputs: {
          value: c.prop('kind') === 'radial' ? `('radial-gradient(circle, ' + ${stops} + ')')` : `('linear-gradient(' + Number(${c.in('angle')}) + 'deg, ' + ${stops} + ')')`,
        },
      };
    },
  }),
  pure({
    type: 'css.shadow',
    title: 'Shadow',
    description: 'A box-shadow value.',
    keywords: ['box-shadow', 'drop', 'elevation'],
    props: [{ id: 'inset', type: 'boolean', label: 'Inset', default: false }],
    ports: {
      inputs: [num('x', 'X', 0), num('y', 'Y', 8), num('blur', 'Blur', 24), num('spread', 'Spread', 0), str('color', 'Color', 'rgba(0, 0, 0, 0.15)')],
      outputs: [{ id: 'value', type: 'string', label: 'Shadow' }],
    },
    compile: (c) => ({
      outputs: {
        value: `(${c.lit(c.prop('inset') ? 'inset ' : '')} + Number(${c.in('x')}) + 'px ' + Number(${c.in('y')}) + 'px ' + Number(${c.in('blur')}) + 'px ' + Number(${c.in('spread')}) + 'px ' + ${c.in('color')})`,
      },
    }),
  }),
  pure({
    type: 'css.var',
    title: 'CSS variable',
    description: 'var(--name, fallback): a custom property set elsewhere.',
    keywords: ['custom property', 'token', 'variable'],
    props: [{ id: 'name', type: 'string', label: 'Name', default: 'brand' }],
    ports: { inputs: [str('fallback', 'Fallback', '')], outputs: [{ id: 'value', type: 'string', label: 'Value' }] },
    compile: (c) => {
      const name = `--${String(c.prop('name') ?? '').replace(/^-+/, '').trim() || 'x'}`;
      return { outputs: { value: `('var(' + ${c.lit(name)} + (${c.in('fallback')} !== '' ? ', ' + ${c.in('fallback')} : '') + ')')` } };
    },
  }),
  pure({
    type: 'css.getStyle',
    title: 'Get style',
    description: 'The computed value of a CSS property of an element.',
    keywords: ['computed', 'getComputedStyle', 'read'],
    ports: {
      inputs: [{ id: 'target', type: 'element', label: 'Target', default: '' }, str('property', 'Property', 'color')],
      outputs: [{ id: 'value', type: 'string', label: 'Value' }],
    },
    compile: (c) => ({
      outputs: {
        value: `(function (el, p) { el = ${c.h('els')}(${c.root}, el)[0]; if (!el) return ''; var w = el.ownerDocument.defaultView; return w ? w.getComputedStyle(el).getPropertyValue(p).trim() : ''; })(${c.in('target')}, ${c.in('property')})`,
      },
    }),
  }),
  {
    type: RULE_NODE,
    category: STYLE_CATEGORY,
    color: '#ad1457',
    title: 'Apply to selector',
    description: 'A CSS rule worked out in the editor: it goes into the page CSS (canvas, Style Manager, publish). Add a pin per property: backgroundColor, padding, __brand (--brand).',
    keywords: ['rule', 'style', 'selector', 'static', 'shader'],
    props: [
      { id: 'selector', type: 'selector', label: 'Selector', default: '' },
      { id: 'state', type: 'select', label: 'State', default: '', options: STATES },
      { id: 'media', type: 'string', label: 'Media', default: '' },
      { id: 'properties', type: 'pins', label: 'Properties', default: DEFAULT_PROPS },
    ],
    ports: (p): Ports => ({ inputs: propPins(p), outputs: [] }),
    // Nothing at runtime: the editor computes the rule (blueprintCss.ts).
    compile: () => ({ outputs: {} }),
  },
  {
    type: APPLY_NODE,
    category: STYLE_CATEGORY,
    color: '#ad1457',
    title: 'Apply styles',
    description: 'Sets a CSS rule while the page runs (each run replaces it). Without a selector: inline styles of the target.',
    keywords: ['rule', 'style', 'runtime', 'set'],
    props: [
      { id: 'selector', type: 'selector', label: 'Selector', default: '' },
      { id: 'state', type: 'select', label: 'State', default: '', options: STATES },
      { id: 'media', type: 'string', label: 'Media', default: '' },
      { id: 'properties', type: 'pins', label: 'Properties', default: DEFAULT_PROPS },
    ],
    ports: (p): Ports => ({ inputs: [EXEC_IN, { id: 'target', type: 'elements', label: 'Target', default: '' }, ...propPins(p)], outputs: [THEN] }),
    compile: (c) => {
      const pins = propPins((c.node.props || {}) as Record<string, unknown>);
      const style = styleObject(c, pins);
      const sel = String(c.prop('selector') ?? '').trim();
      let code: string;
      if (sel) {
        const fn = c.state('cssRule', RULE_FN);
        code = `${fn}(${c.doc}, ${c.lit(c.node.id)}, ${c.lit(withState(sel, String(c.prop('state') ?? '')))}, ${c.lit(String(c.prop('media') ?? '').trim())}, ${style});`;
      } else {
        const t = targets(c);
        code = `(function (s) { ${t}.forEach(function (el) { for (var k in s) { if (s[k] === '' || s[k] == null) el.style.removeProperty(k); else el.style.setProperty(k, String(s[k])); } }); })(${style});`;
      }
      return [code, c.next('then')].filter((x) => x.trim()).join('\n');
    },
  },
  {
    type: 'css.setVar',
    category: STYLE_CATEGORY,
    color: '#ad1457',
    title: 'Set CSS variable',
    description: 'Sets a custom property (--name) on the target (the page root by default); every rule using var(--name) follows.',
    keywords: ['custom property', 'token', 'theme', 'variable'],
    props: [{ id: 'name', type: 'string', label: 'Name', default: 'brand' }],
    ports: { inputs: [EXEC_IN, { id: 'target', type: 'elements', label: 'Target', default: '' }, str('value', 'Value', '')], outputs: [THEN] },
    compile: (c) => {
      const name = `--${String(c.prop('name') ?? '').replace(/^-+/, '').trim() || 'x'}`;
      const t = targets(c);
      return [`${t}.forEach(function (el) { el.style.setProperty(${c.lit(name)}, String(${c.in('value')})); });`, c.next('then')].filter((x) => x.trim()).join('\n');
    },
  },
];
