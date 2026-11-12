import { defineNode } from '../core/registry';
import type { CompileContext, NodeDef } from '../core/types';

/** Common element events (the field accepts any event name). */
export const ELEMENT_EVENTS = [
  'click',
  'dblclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'mouseenter',
  'mouseleave',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'input',
  'change',
  'submit',
  'reset',
  'focus',
  'blur',
  'keydown',
  'keyup',
  'animationend',
  'transitionend',
];

export const PAGE_EVENTS = ['load', 'scroll', 'resize', 'hashchange', 'popstate', 'visibilitychange', 'online', 'offline', 'beforeunload'];

const opts = (list: string[]) => list.map((value) => ({ value }));

function guards(c: CompileContext, ev: string): string[] {
  const out: string[] = [];
  if (c.prop('once')) {
    const done = c.state('done', 'false');
    out.push(`if (${done}) return;`, `${done} = true;`);
  }
  if (c.prop('preventDefault')) out.push(`${ev}.preventDefault();`);
  if (c.prop('stopPropagation')) out.push(`${ev}.stopPropagation();`);
  return out;
}

const body = (lines: string[]) =>
  lines
    .filter((l) => l.trim())
    .join('\n')
    .split('\n')
    .map((l) => (l.trim() ? '  ' + l : l))
    .join('\n');

export const eventElement = defineNode({
  type: 'event.element',
  category: 'events',
  title: 'On element event',
  description:
    'Runs when an event happens on an element matching the selector — on every page, also for elements added later (the listener is delegated to the document). Without a selector: the blueprint root itself (the component element).',
  event: true,
  color: '#b33',
  keywords: ['click', 'trigger', 'listener', 'event', 'on'],
  props: [
    { id: 'selector', type: 'selector', label: 'Selector', default: '' },
    { id: 'event', type: 'string', label: 'Event', default: 'click', options: opts(ELEMENT_EVENTS), required: true },
    { id: 'preventDefault', type: 'boolean', label: 'Prevent default', default: false },
    { id: 'stopPropagation', type: 'boolean', label: 'Stop propagation', default: false },
    { id: 'once', type: 'boolean', label: 'Only once', default: false },
  ],
  ports: {
    inputs: [],
    outputs: [
      { id: 'then', type: 'exec' },
      { id: 'self', type: 'element', label: 'Element' },
      { id: 'event', type: 'event', label: 'Event' },
    ],
  },
  compile(c) {
    const type = String(c.prop('event') || 'click').trim();
    const sel = String(c.prop('selector') || '').trim();
    if (!type) c.warn('No event name');
    const lines = [c.set('event', 'event'), c.set('self', 'self'), ...guards(c, 'event'), c.next('then')];
    return `${c.h('delegate')}(__d, ${c.root}, ${c.lit(type)}, ${c.lit(sel)}, function (event, self) {\n${body(lines)}\n});`;
  },
});

export const eventStart = defineNode({
  type: 'event.start',
  category: 'events',
  title: 'On start',
  description: 'Runs once when the blueprint starts: when the page is ready, or when a component instance appears.',
  event: true,
  order: 100,
  color: '#b33',
  keywords: ['ready', 'init', 'begin', 'mount', 'domcontentloaded'],
  ports: {
    inputs: [],
    outputs: [
      { id: 'then', type: 'exec' },
      { id: 'self', type: 'element', label: 'Root' },
    ],
  },
  compile(c) {
    return [c.set('self', `${c.root}.nodeType === 9 ? ${c.root}.documentElement : ${c.root}`), c.next('then')].filter((s) => s.trim()).join('\n');
  },
});

export const eventPage = defineNode({
  type: 'event.page',
  category: 'events',
  title: 'On page event',
  description: 'Window / document events: load, scroll, resize, hash change, tab visibility…',
  event: true,
  color: '#b33',
  keywords: ['window', 'scroll', 'resize', 'load', 'hash'],
  props: [
    { id: 'event', type: 'string', label: 'Event', default: 'scroll', options: opts(PAGE_EVENTS), required: true },
    { id: 'throttle', type: 'number', label: 'Throttle, ms', default: 0 },
  ],
  ports: {
    inputs: [],
    outputs: [
      { id: 'then', type: 'exec' },
      { id: 'event', type: 'event', label: 'Event' },
    ],
  },
  compile(c) {
    const type = String(c.prop('event') || 'scroll').trim();
    const target = type === 'visibilitychange' ? c.doc : c.win;
    const ms = Math.max(0, Number(c.prop('throttle')) || 0);
    const lines: string[] = [];
    if (ms) {
      const last = c.state('last', '0');
      lines.push(`var now = Date.now();`, `if (now - ${last} < ${ms}) return;`, `${last} = now;`);
    }
    lines.push(c.set('event', 'event'), c.next('then'));
    return `${c.h('on')}(__d, ${target}, ${c.lit(type)}, function (event) {\n${body(lines)}\n});`;
  },
});

export const eventTimer = defineNode({
  type: 'event.timer',
  category: 'events',
  title: 'On timer',
  description: 'Runs after a delay, or every N milliseconds when "Repeat" is on.',
  event: true,
  color: '#b33',
  keywords: ['interval', 'timeout', 'every', 'after', 'time'],
  props: [
    { id: 'ms', type: 'number', label: 'Milliseconds', default: 1000 },
    { id: 'repeat', type: 'boolean', label: 'Repeat', default: false },
  ],
  ports: { inputs: [], outputs: [{ id: 'then', type: 'exec' }] },
  compile(c) {
    const ms = Math.max(0, Number(c.prop('ms')) || 0);
    const fn = c.prop('repeat') ? 'interval' : 'timeout';
    return `${c.h(fn)}(__d, function () {\n${body([c.next('then')])}\n}, ${ms});`;
  },
});

export const eventKey = defineNode({
  type: 'event.key',
  category: 'events',
  title: 'On key',
  description: 'Runs when a key is pressed anywhere on the page (for example Escape). Empty key = any key.',
  event: true,
  color: '#b33',
  keywords: ['keyboard', 'escape', 'enter', 'hotkey', 'shortcut'],
  props: [
    { id: 'key', type: 'string', label: 'Key', default: 'Escape', options: opts(['Escape', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab']) },
    { id: 'event', type: 'select', label: 'Event', default: 'keydown', options: opts(['keydown', 'keyup']) },
    { id: 'ctrl', type: 'boolean', label: 'Ctrl / ⌘', default: false },
    { id: 'shift', type: 'boolean', label: 'Shift', default: false },
    { id: 'alt', type: 'boolean', label: 'Alt', default: false },
    { id: 'preventDefault', type: 'boolean', label: 'Prevent default', default: false },
  ],
  ports: {
    inputs: [],
    outputs: [
      { id: 'then', type: 'exec' },
      { id: 'event', type: 'event', label: 'Event' },
    ],
  },
  compile(c) {
    const key = String(c.prop('key') ?? '');
    const conds: string[] = [];
    if (key) conds.push(`event.key !== ${c.lit(key)}`);
    if (c.prop('ctrl')) conds.push('!(event.ctrlKey || event.metaKey)');
    if (c.prop('shift')) conds.push('!event.shiftKey');
    if (c.prop('alt')) conds.push('!event.altKey');
    const lines = [conds.length ? `if (${conds.join(' || ')}) return;` : '', ...guards(c, 'event'), c.set('event', 'event'), c.next('then')];
    return `${c.h('on')}(__d, ${c.doc}, ${c.lit(c.prop('event') === 'keyup' ? 'keyup' : 'keydown')}, function (event) {\n${body(lines)}\n});`;
  },
});

export const eventCustom = defineNode({
  type: 'event.custom',
  category: 'events',
  title: 'On custom event',
  description: 'Runs when a custom event with this name reaches the blueprint root (see "Send event"). Lets blueprints talk to each other.',
  event: true,
  color: '#b33',
  keywords: ['message', 'receive', 'listen', 'custom', 'emit'],
  props: [{ id: 'name', type: 'string', label: 'Event name', default: 'my-event', required: true }],
  ports: {
    inputs: [],
    outputs: [
      { id: 'then', type: 'exec' },
      { id: 'detail', type: 'any', label: 'Data' },
      { id: 'target', type: 'element', label: 'Sender' },
    ],
  },
  compile(c) {
    const lines = [c.set('detail', 'event.detail'), c.set('target', 'event.target'), c.next('then')];
    return `${c.h('on')}(__d, ${c.root}, ${c.lit(String(c.prop('name') || '').trim())}, function (event) {\n${body(lines)}\n});`;
  },
});

export const EVENT_NODES: NodeDef[] = [eventElement, eventStart, eventPage, eventTimer, eventKey, eventCustom];
