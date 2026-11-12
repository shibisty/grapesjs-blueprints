import { defineNode } from '../core/registry';
import type { NodeDef, PinDef, PinType } from '../core/types';

const EXEC_IN: PinDef = { id: 'exec', type: 'exec' };
const THEN: PinDef = { id: 'then', type: 'exec' };

function literalNode(type: 'string' | 'number' | 'boolean', title: string, def: unknown): NodeDef {
  return defineNode({
    type: `data.${type}`,
    category: 'data',
    title,
    description: `A ${type} value.`,
    keywords: ['value', 'constant', 'literal', type],
    ports: { inputs: [{ id: 'value', type, label: 'Value', default: def }], outputs: [{ id: 'value', type, label: 'Value' }] },
    compile(c) {
      return { outputs: { value: c.in('value') } };
    },
  });
}

export const stringNode = literalNode('string', 'Text', '');
export const numberNode = literalNode('number', 'Number', 0);
export const booleanNode = literalNode('boolean', 'Boolean', false);

export const getVar = defineNode({
  type: 'var.get',
  category: 'variables',
  title: 'Get variable',
  description: 'Value of a blueprint variable.',
  keywords: ['variable', 'state', 'read'],
  props: [{ id: 'variable', type: 'variable', label: 'Variable', required: true }],
  ports: { inputs: [], outputs: [{ id: 'value', type: 'any', label: 'Value' }] },
  compile(c) {
    return { outputs: { value: c.variable(String(c.prop('variable') || '')) } };
  },
});

export const setVar = defineNode({
  type: 'var.set',
  category: 'variables',
  title: 'Set variable',
  description: 'Stores a value in a blueprint variable (kept while the page is open).',
  keywords: ['variable', 'state', 'write', 'assign'],
  props: [{ id: 'variable', type: 'variable', label: 'Variable', required: true }],
  ports: {
    inputs: [EXEC_IN, { id: 'value', type: 'any', label: 'Value', default: '' }],
    outputs: [THEN, { id: 'value', type: 'any', label: 'Value' }],
  },
  compile(c) {
    const v = c.variable(String(c.prop('variable') || ''));
    return [`${v} = ${c.in('value')};`, c.set('value', v), c.next('then')].filter((s) => s.trim()).join('\n');
  },
});

const MATH_OPS: Record<string, (a: string, b: string) => string> = {
  '+': (a, b) => `${a} + ${b}`,
  '-': (a, b) => `${a} - ${b}`,
  '*': (a, b) => `${a} * ${b}`,
  '/': (a, b) => `(${b} === 0 ? 0 : ${a} / ${b})`,
  '%': (a, b) => `(${b} === 0 ? 0 : ${a} % ${b})`,
  min: (a, b) => `Math.min(${a}, ${b})`,
  max: (a, b) => `Math.max(${a}, ${b})`,
  pow: (a, b) => `Math.pow(${a}, ${b})`,
};

export const math = defineNode({
  type: 'math.op',
  category: 'math',
  title: 'Math',
  description: 'Arithmetic on two numbers. Division by zero gives 0.',
  keywords: ['add', 'plus', 'minus', 'multiply', 'divide', 'sum', 'min', 'max'],
  props: [{ id: 'op', type: 'select', label: 'Operation', default: '+', options: Object.keys(MATH_OPS).map((value) => ({ value })) }],
  ports: {
    inputs: [
      { id: 'a', type: 'number', label: 'A', default: 0 },
      { id: 'b', type: 'number', label: 'B', default: 0 },
    ],
    outputs: [{ id: 'result', type: 'number', label: 'Result' }],
  },
  compile(c) {
    const op = MATH_OPS[String(c.prop('op'))] || MATH_OPS['+'];
    return { outputs: { result: op(`Number(${c.in('a')})`, `Number(${c.in('b')})`) } };
  },
});

const CMP_OPS = ['==', '!=', '<', '>', '<=', '>='];

export const compare = defineNode({
  type: 'logic.compare',
  category: 'logic',
  title: 'Compare',
  description: 'Compares two values. "==" compares loosely ("1" equals 1).',
  keywords: ['equal', 'equals', 'greater', 'less', 'if', 'compare'],
  props: [{ id: 'op', type: 'select', label: 'Operator', default: '==', options: CMP_OPS.map((value) => ({ value })) }],
  ports: {
    inputs: [
      { id: 'a', type: 'any', label: 'A', default: '' },
      { id: 'b', type: 'any', label: 'B', default: '' },
    ],
    outputs: [{ id: 'result', type: 'boolean', label: 'Result' }],
  },
  compile(c) {
    const op = CMP_OPS.includes(String(c.prop('op'))) ? String(c.prop('op')) : '==';
    return { outputs: { result: `${c.in('a')} ${op} ${c.in('b')}` } };
  },
});

function logicNode(type: 'and' | 'or', title: string): NodeDef {
  return defineNode({
    type: `logic.${type}`,
    category: 'logic',
    title,
    description: type === 'and' ? 'True if both are true.' : 'True if at least one is true.',
    keywords: [type, 'boolean', 'logic'],
    ports: {
      inputs: [
        { id: 'a', type: 'boolean', label: 'A', default: false },
        { id: 'b', type: 'boolean', label: 'B', default: false },
      ],
      outputs: [{ id: 'result', type: 'boolean', label: 'Result' }],
    },
    compile(c) {
      return { outputs: { result: `!!(${c.in('a')} ${type === 'and' ? '&&' : '||'} ${c.in('b')})` } };
    },
  });
}

export const and = logicNode('and', 'AND');
export const or = logicNode('or', 'OR');

export const not = defineNode({
  type: 'logic.not',
  category: 'logic',
  title: 'NOT',
  description: 'Inverts a boolean.',
  keywords: ['not', 'invert', 'negate'],
  ports: { inputs: [{ id: 'value', type: 'boolean', label: 'Value', default: false }], outputs: [{ id: 'result', type: 'boolean', label: 'Result' }] },
  compile(c) {
    return { outputs: { result: `!${c.in('value')}` } };
  },
});

export const concat = defineNode({
  type: 'string.concat',
  category: 'data',
  title: 'Join text',
  description: 'Joins two texts with an optional separator.',
  keywords: ['concat', 'join', 'string', 'text', 'append'],
  ports: {
    inputs: [
      { id: 'a', type: 'string', label: 'A', default: '' },
      { id: 'b', type: 'string', label: 'B', default: '' },
      { id: 'separator', type: 'string', label: 'Separator', default: '' },
    ],
    outputs: [{ id: 'result', type: 'string', label: 'Result' }],
  },
  compile(c) {
    return { outputs: { result: `String(${c.in('a')}) + ${c.in('separator')} + String(${c.in('b')})` } };
  },
});

export const toNumber = defineNode({
  type: 'convert.number',
  category: 'data',
  title: 'To number',
  description: 'Converts a value to a number (0 if it is not a number).',
  keywords: ['parse', 'number', 'convert', 'int', 'float'],
  ports: { inputs: [{ id: 'value', type: 'any', label: 'Value', default: '' }], outputs: [{ id: 'result', type: 'number', label: 'Number' }] },
  compile(c) {
    return { outputs: { result: `(parseFloat(${c.in('value')}) || 0)` } };
  },
});

export const toText = defineNode({
  type: 'convert.string',
  category: 'data',
  title: 'To text',
  description: 'Converts a value to text (objects as JSON).',
  keywords: ['string', 'text', 'convert', 'json'],
  ports: { inputs: [{ id: 'value', type: 'any', label: 'Value', noLiteral: true }], outputs: [{ id: 'result', type: 'string', label: 'Text' }] },
  compile(c) {
    return {
      outputs: {
        result: `(function (v) { if (v == null) return ''; if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } } return String(v); })(${c.in('value')})`,
      },
    };
  },
});

export const storageGet = defineNode({
  type: 'storage.get',
  category: 'data',
  title: 'Read from storage',
  description: 'Value saved in the browser (localStorage) under the key; empty text if none.',
  keywords: ['localStorage', 'save', 'remember', 'persist', 'cookie'],
  ports: { inputs: [{ id: 'key', type: 'string', label: 'Key', default: '', required: true }], outputs: [{ id: 'value', type: 'string', label: 'Value' }] },
  compile(c) {
    return { outputs: { value: `(${c.h('store')}.get(${c.in('key')}) || '')` } };
  },
});

export const storageSet = defineNode({
  type: 'storage.set',
  category: 'data',
  title: 'Save to storage',
  description: 'Saves a value in the browser (localStorage); it survives reloads.',
  keywords: ['localStorage', 'save', 'remember', 'persist'],
  ports: {
    inputs: [EXEC_IN, { id: 'key', type: 'string', label: 'Key', default: '', required: true }, { id: 'value', type: 'string', label: 'Value', default: '' }],
    outputs: [THEN],
  },
  compile(c) {
    return [`${c.h('store')}.set(${c.in('key')}, ${c.in('value')});`, c.next('then')].filter((s) => s.trim()).join('\n');
  },
});

export const param = defineNode({
  type: 'component.param',
  category: 'variables',
  title: 'Component parameter',
  description: 'Value of a component parameter (set in the component traits). Component blueprints only.',
  keywords: ['param', 'prop', 'trait', 'option', 'setting'],
  props: [{ id: 'param', type: 'string', label: 'Parameter', default: '', required: true }],
  ports: { inputs: [], outputs: [{ id: 'value', type: 'any', label: 'Value' }] },
  compile(c) {
    return { outputs: { value: `params[${c.lit(String(c.prop('param') || ''))}]` } };
  },
});

export const log = defineNode({
  type: 'debug.log',
  category: 'debug',
  title: 'Print to console',
  description: 'Writes a value to the browser console.',
  keywords: ['console', 'log', 'print', 'debug'],
  ports: {
    inputs: [EXEC_IN, { id: 'label', type: 'string', label: 'Label', default: '' }, { id: 'value', type: 'any', label: 'Value', default: '' }],
    outputs: [THEN],
  },
  compile(c) {
    return [`if (typeof console !== 'undefined') console.log(${c.in('label')}, ${c.in('value')});`, c.next('then')].join('\n');
  },
});

// ------------------------------------------------------------------- code

export interface CodePin {
  id: string;
  type: Exclude<PinType, 'exec'>;
  label?: string;
}

function codePins(v: unknown, fallback: CodePin[]): CodePin[] {
  const list = Array.isArray(v) ? v : fallback;
  const seen = new Set<string>();
  const out: CodePin[] = [];
  for (const raw of list) {
    const id = String((raw as CodePin)?.id || '').trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(id) || seen.has(id) || id === 'exec' || id === 'then') continue;
    seen.add(id);
    const type = (raw as CodePin).type;
    out.push({ id, type: (['any', 'string', 'number', 'boolean', 'element', 'elements', 'event', 'object'] as const).includes(type as any) ? type : 'any', label: (raw as CodePin).label });
  }
  return out;
}

export const jsCode = defineNode({
  type: 'code.js',
  category: 'code',
  title: 'JavaScript',
  description:
    'Your own code. Inputs come in `inputs`, return an object with the outputs (`return { result: 42 };`). `ctx` has `root`, `document`, `window`, `params`. With "Async", return a Promise: the chain continues when it resolves.',
  keywords: ['code', 'script', 'custom', 'javascript', 'function'],
  color: '#7a4',
  props: [
    { id: 'code', type: 'code', label: 'Code', default: 'return { result: inputs.value };' },
    { id: 'inputs', type: 'pins', label: 'Inputs', default: [{ id: 'value', type: 'any' }] },
    { id: 'outputs', type: 'pins', label: 'Outputs', default: [{ id: 'result', type: 'any' }] },
    { id: 'async', type: 'boolean', label: 'Async', default: false },
  ],
  ports: (p) => ({
    inputs: [EXEC_IN, ...codePins(p.inputs, [{ id: 'value', type: 'any' }]).map((x) => ({ ...x, default: x.type === 'string' ? '' : undefined }))],
    outputs: [THEN, ...codePins(p.outputs, [{ id: 'result', type: 'any' }]).map((x) => ({ ...x }))],
  }),
  compile(c) {
    const ins = codePins(c.prop('inputs'), [{ id: 'value', type: 'any' }]);
    const outs = codePins(c.prop('outputs'), [{ id: 'result', type: 'any' }]);
    const user = String(c.prop('code') ?? '');
    const fn = c.local('code');
    const r = c.local('r');
    const inputsObj = `{ ${ins.map((p) => `${p.id}: ${c.in(p.id)}`).join(', ')} }`;
    const ctxObj = `{ root: ${c.root}, document: ${c.doc}, window: ${c.win}, params: params }`;
    const assign = outs.map((p) => c.set(p.id, `${r}[${c.lit(p.id)}]`)).filter(Boolean).join('\n');
    const indented = user
      .split('\n')
      .map((l) => (l.trim() ? '  ' + l : l))
      .join('\n');
    const decl = `var ${fn} = function (inputs, ctx) {\n${indented}\n};`;
    const next = c.next('then');
    if (c.prop('async')) {
      const tail = [assign, next].filter((s) => s.trim()).join('\n');
      return `${decl}\nPromise.resolve(${fn}(${inputsObj}, ${ctxObj})).then(function (${r}) {\n${[`${r} = ${r} || {};`, tail]
        .join('\n')
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n')}\n})['catch'](function (e) { if (typeof console !== 'undefined') console.error(e); });`;
    }
    return [decl, `var ${r} = ${fn}(${inputsObj}, ${ctxObj}) || {};`, assign, next].filter((s) => s.trim()).join('\n');
  },
});

export const jsExpression = defineNode({
  type: 'code.expression',
  category: 'code',
  title: 'Expression',
  description: 'A JavaScript expression of `a` and `b`, e.g. `a * 2 + b` or `a.trim()`.',
  keywords: ['formula', 'expression', 'calc', 'javascript'],
  color: '#7a4',
  props: [{ id: 'expression', type: 'code', label: 'Expression', default: 'a' }],
  ports: {
    inputs: [
      { id: 'a', type: 'any', label: 'a', default: '' },
      { id: 'b', type: 'any', label: 'b', default: '' },
    ],
    outputs: [{ id: 'result', type: 'any', label: 'Result' }],
  },
  compile(c) {
    const expr = String(c.prop('expression') || 'undefined').replace(/;\s*$/, '');
    return { outputs: { result: `(function (a, b) { return (${expr}); })(${c.in('a')}, ${c.in('b')})` } };
  },
});

export const DATA_NODES: NodeDef[] = [
  stringNode,
  numberNode,
  booleanNode,
  getVar,
  setVar,
  param,
  math,
  compare,
  and,
  or,
  not,
  concat,
  toNumber,
  toText,
  storageGet,
  storageSet,
  log,
  jsCode,
  jsExpression,
];
