import { defineNode } from '../core/registry';
import type { CompileContext, NodeDef, PinDef } from '../core/types';

const EXEC_IN: PinDef = { id: 'exec', type: 'exec' };
const THEN: PinDef = { id: 'then', type: 'exec' };
/** Target elements. A text literal is a selector looked up from the blueprint root. */
const TARGET: PinDef = { id: 'target', type: 'elements', label: 'Target', default: '', required: true };

/**
 * Target as an array of elements. A selector literal compiles straight to a query;
 * a wire goes through `__bp_els` (element, list or selector text).
 */
const els = (c: CompileContext, pin = 'target') => {
  const v = c.in(pin);
  if (!c.linked(pin)) return v === 'null' ? '[]' : v.replace(/^\((.*)\[0\] \|\| null\)$/, '$1');
  return `${c.h('els')}(${c.root}, ${v})`;
};

/** Exec node that does `fn(el)` for each target element, then continues. */
function eachNode(def: {
  type: string;
  title: string;
  description: string;
  keywords?: string[];
  inputs?: PinDef[];
  body: (c: CompileContext, el: string) => string;
}): NodeDef {
  return defineNode({
    type: def.type,
    category: 'dom',
    title: def.title,
    description: def.description,
    keywords: def.keywords,
    ports: { inputs: [EXEC_IN, TARGET, ...(def.inputs || [])], outputs: [THEN] },
    compile(c) {
      return [`${els(c)}.forEach(function (el) { ${def.body(c, 'el')} });`, c.next('then')].filter((s) => s.trim()).join('\n');
    },
  });
}

const CLASS: PinDef = { id: 'className', type: 'string', label: 'Class', default: '', required: true };
/** `el.classList.<method>(…)` for every class of the "Class" input. */
const classOp = (c: CompileContext, el: string, method: 'add' | 'remove' | 'toggle') => {
  if (!c.linked('className')) {
    const list = String(c.prop('className') ?? '').split(/\s+/).filter(Boolean);
    if (list.length <= 1) return list.length ? `${el}.classList.${method}(${c.lit(list[0])});` : '';
    return `${c.lit(list)}.forEach(function (k) { ${el}.classList.${method}(k); });`;
  }
  return `String(${c.in('className')}).split(/\\s+/).filter(Boolean).forEach(function (k) { ${el}.classList.${method}(k); });`;
};

export const query = defineNode({
  type: 'dom.query',
  category: 'dom',
  title: 'Find elements',
  description:
    'Finds elements by a CSS selector: in the whole document (or component), inside the given elements, or the closest ancestor of them.',
  keywords: ['select', 'selector', 'query', 'get', 'element', 'closest', 'find'],
  props: [
    {
      id: 'mode',
      type: 'select',
      label: 'Where',
      default: 'all',
      options: [
        { value: 'all', label: 'Everywhere' },
        { value: 'within', label: 'Inside "From"' },
        { value: 'closest', label: 'Closest ancestor of "From"' },
      ],
    },
  ],
  ports: {
    inputs: [
      { id: 'selector', type: 'string', label: 'Selector', default: '' },
      { id: 'from', type: 'elements', label: 'From', noLiteral: true },
    ],
    outputs: [
      { id: 'result', type: 'elements', label: 'Elements' },
      { id: 'first', type: 'element', label: 'First' },
      { id: 'count', type: 'number', label: 'Count' },
    ],
  },
  compile(c) {
    const mode = String(c.prop('mode') || 'all');
    const from = c.linked('from') ? c.in('from') : 'null';
    const q = `${c.h('q')}(${c.root}, ${c.in('selector')}, ${c.lit(mode)}, ${from})`;
    return { outputs: { result: q, first: `${q}[0] || null`, count: `${q}.length` } };
  },
});

export const rootNode = defineNode({
  type: 'dom.root',
  category: 'dom',
  title: 'Root element',
  description: 'The component element (component blueprints) or <html> (page blueprints).',
  keywords: ['self', 'this', 'component', 'root'],
  ports: { inputs: [], outputs: [{ id: 'element', type: 'element', label: 'Element' }] },
  compile(c) {
    return { outputs: { element: `${c.root}.nodeType === 9 ? ${c.root}.documentElement : ${c.root}` } };
  },
});

export const addClass = eachNode({
  type: 'dom.addClass',
  title: 'Add class',
  description: 'Adds class(es) to the elements. Several classes: separate with spaces.',
  keywords: ['class', 'classList', 'add', 'open', 'active'],
  inputs: [CLASS],
  body: (c, el) => classOp(c, el, 'add'),
});

export const removeClass = eachNode({
  type: 'dom.removeClass',
  title: 'Remove class',
  description: 'Removes class(es) from the elements.',
  keywords: ['class', 'classList', 'remove', 'close'],
  inputs: [CLASS],
  body: (c, el) => classOp(c, el, 'remove'),
});

export const toggleClass = eachNode({
  type: 'dom.toggleClass',
  title: 'Toggle class',
  description: 'Adds the class if it is missing, removes it otherwise.',
  keywords: ['class', 'classList', 'toggle', 'switch'],
  inputs: [CLASS],
  body: (c, el) => classOp(c, el, 'toggle'),
});

export const hasClass = defineNode({
  type: 'dom.hasClass',
  category: 'dom',
  title: 'Has class',
  description: 'True if any of the elements has the class.',
  keywords: ['class', 'contains', 'is'],
  ports: { inputs: [TARGET, CLASS], outputs: [{ id: 'result', type: 'boolean', label: 'Result' }] },
  compile(c) {
    return { outputs: { result: `${els(c)}.some(function (el) { return el.classList.contains(String(${c.in('className')}).trim()); })` } };
  },
});

export const matches = defineNode({
  type: 'dom.matches',
  category: 'dom',
  title: 'Matches selector',
  description: 'True if the element matches the CSS selector (e.g. the click was on the backdrop itself).',
  keywords: ['is', 'matches', 'selector', 'check'],
  ports: {
    inputs: [
      { id: 'target', type: 'element', label: 'Element', noLiteral: true },
      { id: 'selector', type: 'string', label: 'Selector', default: '' },
    ],
    outputs: [{ id: 'result', type: 'boolean', label: 'Result' }],
  },
  compile(c) {
    const el = c.in('target');
    return { outputs: { result: `(function (el, s) { try { return !!(el && el.matches && s && el.matches(s)); } catch (e) { return false; } })(${el}, ${c.in('selector')})` } };
  },
});

export const setAttr = eachNode({
  type: 'dom.setAttribute',
  title: 'Set attribute',
  description: 'Sets an attribute (aria-expanded, data-state…).',
  keywords: ['attribute', 'aria', 'data'],
  inputs: [
    { id: 'name', type: 'string', label: 'Name', default: '', required: true },
    { id: 'value', type: 'string', label: 'Value', default: '' },
  ],
  body: (c, el) => `${el}.setAttribute(${c.in('name')}, ${c.in('value')});`,
});

export const removeAttr = eachNode({
  type: 'dom.removeAttribute',
  title: 'Remove attribute',
  description: 'Removes an attribute.',
  keywords: ['attribute', 'remove'],
  inputs: [{ id: 'name', type: 'string', label: 'Name', default: '', required: true }],
  body: (c, el) => `${el}.removeAttribute(${c.in('name')});`,
});

export const getAttr = defineNode({
  type: 'dom.getAttribute',
  category: 'dom',
  title: 'Get attribute',
  description: 'Attribute of the first element (empty string if missing).',
  keywords: ['attribute', 'read', 'data'],
  ports: {
    inputs: [TARGET, { id: 'name', type: 'string', label: 'Name', default: '', required: true }],
    outputs: [{ id: 'value', type: 'string', label: 'Value' }],
  },
  compile(c) {
    return { outputs: { value: `(function (el) { return (el && el.getAttribute(${c.in('name')})) || ''; })(${els(c)}[0])` } };
  },
});

export const setStyle = eachNode({
  type: 'dom.setStyle',
  title: 'Set style',
  description: 'Sets an inline CSS property (empty value removes it).',
  keywords: ['css', 'style', 'color', 'display'],
  inputs: [
    { id: 'property', type: 'string', label: 'Property', default: '', required: true },
    { id: 'value', type: 'string', label: 'Value', default: '' },
  ],
  body: (c, el) => `${el}.style.setProperty(${c.in('property')}, ${c.in('value')});`,
});

export const setText = eachNode({
  type: 'dom.setText',
  title: 'Set text',
  description: 'Replaces the text of the elements (safe: no HTML is parsed).',
  keywords: ['text', 'content', 'label'],
  inputs: [{ id: 'text', type: 'string', label: 'Text', default: '' }],
  body: (c, el) => `${el}.textContent = ${c.in('text')};`,
});

export const getText = defineNode({
  type: 'dom.getText',
  category: 'dom',
  title: 'Get text',
  description: 'Text of the first element.',
  keywords: ['text', 'content', 'read'],
  ports: { inputs: [TARGET], outputs: [{ id: 'text', type: 'string', label: 'Text' }] },
  compile(c) {
    return { outputs: { text: `((${els(c)}[0] || {}).textContent || '')` } };
  },
});

export const setHtml = eachNode({
  type: 'dom.setHtml',
  title: 'Set HTML (unsafe)',
  description: 'Replaces the inner HTML. Never pass user input here: it can run scripts (XSS). Prefer "Set text".',
  keywords: ['html', 'innerHTML'],
  inputs: [{ id: 'html', type: 'string', label: 'HTML', default: '' }],
  body: (c, el) => `${el}.innerHTML = ${c.in('html')};`,
});

export const getValue = defineNode({
  type: 'dom.getValue',
  category: 'dom',
  title: 'Get value',
  description: 'Value of the first form field (checkbox: checked or not).',
  keywords: ['input', 'value', 'form', 'field', 'checked'],
  ports: { inputs: [TARGET], outputs: [{ id: 'value', type: 'any', label: 'Value' }] },
  compile(c) {
    return {
      outputs: {
        value: `(function (el) { if (!el) return ''; if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked; return el.value; })(${els(c)}[0])`,
      },
    };
  },
});

export const setValue = eachNode({
  type: 'dom.setValue',
  title: 'Set value',
  description: 'Sets the value of form fields (checkbox: checks when the value is truthy).',
  keywords: ['input', 'value', 'form', 'field'],
  inputs: [{ id: 'value', type: 'any', label: 'Value', default: '' }],
  body: (c, el) =>
    `var v = ${c.in('value')}; if (${el}.type === 'checkbox' || ${el}.type === 'radio') ${el}.checked = !!v; else ${el}.value = v == null ? '' : v;`,
});

export const show = eachNode({
  type: 'dom.show',
  title: 'Show',
  description: 'Makes hidden elements visible (removes display: none / hidden).',
  keywords: ['display', 'visible', 'open'],
  body: (c, el) => `${c.h('show')}(${el});`,
});

export const hide = eachNode({
  type: 'dom.hide',
  title: 'Hide',
  description: 'Hides the elements (display: none).',
  keywords: ['display', 'invisible', 'close'],
  body: (c, el) => `${c.h('hide')}(${el});`,
});

export const toggleVisible = eachNode({
  type: 'dom.toggleVisible',
  title: 'Show / hide',
  description: 'Shows hidden elements and hides visible ones.',
  keywords: ['display', 'toggle', 'visible'],
  body: (c, el) => `if (${c.h('visible')}(${el})) ${c.h('hide')}(${el}); else ${c.h('show')}(${el});`,
});

export const isVisible = defineNode({
  type: 'dom.isVisible',
  category: 'dom',
  title: 'Is visible',
  description: 'True if the first element is displayed.',
  keywords: ['display', 'visible', 'shown'],
  ports: { inputs: [TARGET], outputs: [{ id: 'result', type: 'boolean', label: 'Result' }] },
  compile(c) {
    return { outputs: { result: `${c.h('visible')}(${els(c)}[0])` } };
  },
});

export const focus = eachNode({
  type: 'dom.focus',
  title: 'Focus',
  description: 'Moves keyboard focus to the element.',
  keywords: ['focus', 'keyboard', 'input'],
  body: (_c, el) => `if (${el}.focus) { ${el}.focus(); }`,
});

export const scrollTo = eachNode({
  type: 'dom.scrollIntoView',
  title: 'Scroll to',
  description: 'Scrolls the page to the element.',
  keywords: ['scroll', 'anchor', 'jump'],
  inputs: [{ id: 'smooth', type: 'boolean', label: 'Smooth', default: true }],
  body: (c, el) => `${el}.scrollIntoView({ behavior: ${c.in('smooth')} ? 'smooth' : 'auto', block: 'start' });`,
});

export const dispatch = defineNode({
  type: 'dom.dispatch',
  category: 'dom',
  title: 'Send event',
  description: 'Sends a custom event from the elements (bubbles). Other blueprints catch it with "On custom event". Empty target = blueprint root.',
  keywords: ['emit', 'trigger', 'custom', 'message', 'send'],
  ports: {
    inputs: [
      EXEC_IN,
      { id: 'target', type: 'elements', label: 'Target', default: '' },
      { id: 'name', type: 'string', label: 'Event name', default: 'my-event', required: true },
      { id: 'detail', type: 'any', label: 'Data', noLiteral: true },
    ],
    outputs: [THEN],
  },
  compile(c) {
    const hasTarget = c.linked('target') || String(c.prop('target') || '').trim();
    const targets = hasTarget ? els(c) : `[${c.root}]`;
    const detail = c.linked('detail') ? c.in('detail') : 'null';
    return [`${targets}.forEach(function (el) { ${c.h('dispatch')}(el, ${c.in('name')}, ${detail}); });`, c.next('then')]
      .filter((s) => s.trim())
      .join('\n');
  },
});

export const preventDefault = defineNode({
  type: 'event.preventDefault',
  category: 'dom',
  title: 'Prevent default',
  description: 'Stops the browser action of the event (following a link, submitting a form).',
  keywords: ['prevent', 'default', 'stop', 'link', 'submit'],
  ports: { inputs: [EXEC_IN, { id: 'event', type: 'event', label: 'Event', required: true, noLiteral: true }], outputs: [THEN] },
  compile(c) {
    return [`if (${c.in('event')}) ${c.in('event')}.preventDefault();`, c.next('then')].filter((s) => s.trim()).join('\n');
  },
});

export const eventTarget = defineNode({
  type: 'event.target',
  category: 'dom',
  title: 'Event target',
  description: 'The element the event actually happened on (may be a child of the listened element).',
  keywords: ['target', 'event', 'clicked'],
  ports: {
    inputs: [{ id: 'event', type: 'event', label: 'Event', noLiteral: true, required: true }],
    outputs: [{ id: 'target', type: 'element', label: 'Target' }],
  },
  compile(c) {
    return { outputs: { target: `(${c.in('event')} || {}).target || null` } };
  },
});

export const DOM_NODES: NodeDef[] = [
  query,
  rootNode,
  addClass,
  removeClass,
  toggleClass,
  hasClass,
  matches,
  setAttr,
  removeAttr,
  getAttr,
  setStyle,
  setText,
  getText,
  setHtml,
  getValue,
  setValue,
  show,
  hide,
  toggleVisible,
  isVisible,
  focus,
  scrollTo,
  dispatch,
  preventDefault,
  eventTarget,
];
