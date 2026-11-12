import { defineNode } from '../core/registry';
import type { NodeDef, PinDef } from '../core/types';

const EXEC_IN: PinDef = { id: 'exec', type: 'exec' };
const THEN: PinDef = { id: 'then', type: 'exec' };

const block = (code: string) =>
  code
    .split('\n')
    .map((l) => (l.trim() ? '  ' + l : l))
    .join('\n');

/** `if (x) {…}` / `fn(function () {…})` without empty bodies. */
const wrap = (head: string, inner: string, tail = '}') => (inner.trim() ? `${head}\n${block(inner)}\n${tail}` : '');

export const branch = defineNode({
  type: 'flow.branch',
  category: 'flow',
  title: 'Branch',
  description: 'If the condition is true, runs "True", otherwise "False".',
  keywords: ['if', 'else', 'condition'],
  ports: {
    inputs: [EXEC_IN, { id: 'condition', type: 'boolean', label: 'Condition', default: false }],
    outputs: [
      { id: 'true', type: 'exec', label: 'True' },
      { id: 'false', type: 'exec', label: 'False' },
    ],
  },
  compile(c) {
    const t = c.next('true');
    const f = c.next('false');
    const cond = c.in('condition');
    if (!t.trim() && !f.trim()) return '';
    if (!t.trim()) return wrap(`if (!${cond}) {`, f);
    return f.trim() ? `if (${cond}) {\n${block(t)}\n} else {\n${block(f)}\n}` : wrap(`if (${cond}) {`, t);
  },
});

export const sequence = defineNode({
  type: 'flow.sequence',
  category: 'flow',
  title: 'Sequence',
  description: 'Runs the outputs one after another, top to bottom.',
  keywords: ['then', 'order', 'steps'],
  props: [{ id: 'count', type: 'number', label: 'Outputs', default: 2 }],
  ports: (p) => {
    const n = Math.min(10, Math.max(2, Math.floor(Number(p.count) || 2)));
    return { inputs: [EXEC_IN], outputs: Array.from({ length: n }, (_, i) => ({ id: `then${i}`, type: 'exec' as const, label: `Then ${i}` })) };
  },
  compile(c) {
    const n = Math.min(10, Math.max(2, Math.floor(Number(c.prop('count')) || 2)));
    return Array.from({ length: n }, (_, i) => c.next(`then${i}`))
      .filter((s) => s.trim())
      .join('\n');
  },
});

export const delay = defineNode({
  type: 'flow.delay',
  category: 'flow',
  title: 'Delay',
  description: 'Waits, then continues.',
  keywords: ['wait', 'timeout', 'sleep', 'later'],
  ports: { inputs: [EXEC_IN, { id: 'ms', type: 'number', label: 'Milliseconds', default: 300 }], outputs: [THEN] },
  compile(c) {
    const inner = c.next('then');
    return inner.trim() ? `${c.h('timeout')}(__d, function () {\n${block(inner)}\n}, ${c.in('ms')});` : '';
  },
});

export const debounce = defineNode({
  type: 'flow.debounce',
  category: 'flow',
  title: 'Debounce',
  description: 'Continues only after calls stop for the given time (typing, resizing).',
  keywords: ['wait', 'typing', 'rate'],
  ports: { inputs: [EXEC_IN, { id: 'ms', type: 'number', label: 'Milliseconds', default: 300 }], outputs: [THEN] },
  compile(c) {
    const t = c.state('timer', 'null');
    const inner = c.next('then');
    return [`clearTimeout(${t});`, `${t} = ${c.h('timeout')}(__d, function () {\n${block(inner)}\n}, ${c.in('ms')});`].join('\n');
  },
});

export const throttle = defineNode({
  type: 'flow.throttle',
  category: 'flow',
  title: 'Throttle',
  description: 'Continues at most once per the given time.',
  keywords: ['rate', 'limit'],
  ports: { inputs: [EXEC_IN, { id: 'ms', type: 'number', label: 'Milliseconds', default: 200 }], outputs: [THEN] },
  compile(c) {
    const last = c.state('last', '0');
    const inner = c.next('then');
    return wrap(`if (Date.now() - ${last} >= ${c.in('ms')}) {`, `${last} = Date.now();\n${inner}`);
  },
});

export const doOnce = defineNode({
  type: 'flow.doOnce',
  category: 'flow',
  title: 'Do once',
  description: 'Continues only the first time, until "Reset" is run.',
  keywords: ['once', 'first', 'gate'],
  ports: {
    inputs: [EXEC_IN, { id: 'reset', type: 'exec', label: 'Reset' }],
    outputs: [THEN],
  },
  compile(c) {
    const done = c.state('done', 'false');
    if (c.entry === 'reset') return `${done} = false;`;
    return `if (!${done}) {\n${block(`${done} = true;\n${c.next('then')}`)}\n}`;
  },
});

export const forEach = defineNode({
  type: 'flow.forEach',
  category: 'flow',
  title: 'For each',
  description: 'Runs "Loop body" for every item (elements found by a selector, an array…), then "Completed".',
  keywords: ['loop', 'each', 'iterate', 'array', 'list'],
  ports: {
    inputs: [EXEC_IN, { id: 'items', type: 'any', label: 'Items', noLiteral: true }],
    outputs: [
      { id: 'body', type: 'exec', label: 'Loop body' },
      { id: 'item', type: 'any', label: 'Item' },
      { id: 'index', type: 'number', label: 'Index' },
      { id: 'completed', type: 'exec', label: 'Completed' },
    ],
  },
  compile(c) {
    const list = c.local('list');
    const i = c.local('i');
    const loop = c.next('body');
    return [
      loop.trim()
        ? `for (var ${i} = 0, ${list} = ${c.h('list')}(${c.in('items')}); ${i} < ${list}.length; ${i}++) {\n${block(
            [c.set('item', `${list}[${i}]`), c.set('index', i), loop].filter((x) => x.trim()).join('\n'),
          )}\n}`
        : '',
      c.next('completed'),
    ]
      .filter((s) => s.trim())
      .join('\n');
  },
});

export const switchString = defineNode({
  type: 'flow.switch',
  category: 'flow',
  title: 'Switch',
  description: 'Runs the output whose case equals the value, otherwise "Default". Cases are comma-separated.',
  keywords: ['case', 'match', 'select'],
  props: [{ id: 'cases', type: 'string', label: 'Cases', default: 'a, b' }],
  ports: (p) => {
    const cases = splitCases(p.cases);
    return {
      inputs: [EXEC_IN, { id: 'value', type: 'any', label: 'Value', default: '' }],
      outputs: [...cases.map((v, i) => ({ id: `case${i}`, type: 'exec' as const, label: v })), { id: 'default', type: 'exec', label: 'Default' }],
    };
  },
  compile(c) {
    const cases = splitCases(c.prop('cases'));
    const v = c.local('v');
    const parts: string[] = [];
    cases.forEach((value, i) => {
      parts.push(`case ${c.lit(value)}:\n${block(`${c.next(`case${i}`)}\nbreak;`)}`);
    });
    const def = c.next('default');
    if (def.trim()) parts.push(`default:\n${block(def)}`);
    return `var ${v} = String(${c.in('value')});\nswitch (${v}) {\n${block(parts.join('\n'))}\n}`;
  },
});

function splitCases(v: unknown): string[] {
  return Array.from(
    new Set(
      String(v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

export const FLOW_NODES: NodeDef[] = [branch, sequence, delay, debounce, throttle, doOnce, forEach, switchString];
