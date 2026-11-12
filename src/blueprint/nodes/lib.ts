import { defineNode } from '../core/registry';
import type { CompileContext, NodeDef, PinDef } from '../core/types';

const EXEC_IN: PinDef = { id: 'exec', type: 'exec' };
const THEN: PinDef = { id: 'then', type: 'exec' };
const argc = (p: Record<string, unknown>) => Math.min(6, Math.max(0, Math.floor(Number(p.args) || 0)));
const argPins = (n: number): PinDef[] => Array.from({ length: n }, (_, i) => ({ id: `arg${i + 1}`, type: 'any' as const, label: `Argument ${i + 1}` }));
const args = (c: CompileContext) => `[${Array.from({ length: argc({ args: c.prop('args') }) }, (_, i) => c.in(`arg${i + 1}`)).join(', ')}]`;
const pathOk = (s: string) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(s);

function path(c: CompileContext, id: string): string {
  const p = String(c.prop(id) || '').trim();
  if (!pathOk(p)) c.warn(`"${p}" is not a global name like gsap.to`);
  return c.lit(p);
}

export const libCall = defineNode({
  type: 'lib.call',
  category: 'code',
  title: 'Call function',
  description: 'Calls a global function, e.g. a library one: `gsap.to`, `AOS.init`, `alert`. Arguments are passed in order.',
  keywords: ['library', 'call', 'function', 'global', 'gsap', 'invoke'],
  color: '#5d4f8a',
  props: [
    { id: 'fn', type: 'string', label: 'Function', default: 'console.log', required: true },
    { id: 'args', type: 'number', label: 'Arguments', default: 1 },
  ],
  helpers: ['lib'],
  ports: (p) => ({ inputs: [EXEC_IN, ...argPins(argc(p))], outputs: [THEN, { id: 'result', type: 'any', label: 'Result' }] }),
  compile(c) {
    const call = `${c.h('lib')}.call(${c.win}, ${path(c, 'fn')}, ${args(c)})`;
    return [c.used('result') ? c.set('result', call) : `${call};`, c.next('then')].filter((s) => s.trim()).join('\n');
  },
});

export const libNew = defineNode({
  type: 'lib.new',
  category: 'code',
  title: 'Create object',
  description: 'Creates an object of a library class: `new Swiper(element, options)`, `new Chart(canvas, config)`.',
  keywords: ['library', 'new', 'class', 'construct', 'swiper', 'instance'],
  color: '#5d4f8a',
  props: [
    { id: 'cls', type: 'string', label: 'Class', default: 'Swiper', required: true },
    { id: 'args', type: 'number', label: 'Arguments', default: 2 },
  ],
  helpers: ['lib'],
  ports: (p) => ({ inputs: [EXEC_IN, ...argPins(argc(p))], outputs: [THEN, { id: 'object', type: 'object', label: 'Object' }] }),
  compile(c) {
    const expr = `${c.h('lib')}.create(${c.win}, ${path(c, 'cls')}, ${args(c)})`;
    return [c.used('object') ? c.set('object', expr) : `${expr};`, c.next('then')].filter((s) => s.trim()).join('\n');
  },
});

export const libMethod = defineNode({
  type: 'lib.method',
  category: 'code',
  title: 'Call method',
  description: 'Calls a method of an object, e.g. `slideNext` of a Swiper, `play` of a video element.',
  keywords: ['method', 'call', 'object', 'invoke'],
  color: '#5d4f8a',
  props: [
    { id: 'method', type: 'string', label: 'Method', default: '', required: true },
    { id: 'args', type: 'number', label: 'Arguments', default: 0 },
  ],
  helpers: ['lib'],
  ports: (p) => ({
    inputs: [EXEC_IN, { id: 'target', type: 'any', label: 'Object', noLiteral: true, required: true }, ...argPins(argc(p))],
    outputs: [THEN, { id: 'result', type: 'any', label: 'Result' }],
  }),
  compile(c) {
    const call = `${c.h('lib')}.method(${c.in('target')}, ${c.lit(String(c.prop('method') || ''))}, ${args(c)})`;
    return [c.used('result') ? c.set('result', call) : `${call};`, c.next('then')].filter((s) => s.trim()).join('\n');
  },
});

export const libGet = defineNode({
  type: 'lib.get',
  category: 'code',
  title: 'Global value',
  description: 'Reads a global value: `location.pathname`, `innerWidth`, a library object.',
  keywords: ['global', 'window', 'read', 'property', 'location'],
  color: '#5d4f8a',
  props: [{ id: 'name', type: 'string', label: 'Name', default: 'location.pathname', required: true }],
  helpers: ['lib'],
  ports: { inputs: [], outputs: [{ id: 'value', type: 'any', label: 'Value' }] },
  compile(c) {
    return { outputs: { value: `${c.h('lib')}.get(${c.win}, ${path(c, 'name')})` } };
  },
});

export const dataObject = defineNode({
  type: 'data.object',
  category: 'data',
  title: 'Object (JSON)',
  description: 'An object or array written as JSON — for library options: `{ "loop": true, "speed": 600 }`.',
  keywords: ['json', 'object', 'options', 'config', 'array', 'settings'],
  props: [{ id: 'json', type: 'code', label: 'JSON', default: '{}' }],
  ports: { inputs: [], outputs: [{ id: 'value', type: 'object', label: 'Object' }] },
  compile(c) {
    const raw = String(c.prop('json') ?? '').trim() || 'null';
    let value: unknown = null;
    try {
      value = JSON.parse(raw);
    } catch (e) {
      c.warn(`Invalid JSON: ${(e as Error).message}`);
    }
    // A fresh copy on every use: library calls may change the options object.
    return { outputs: { value: `JSON.parse(${c.lit(JSON.stringify(value))})` } };
  },
});

export const LIB_NODES: NodeDef[] = [libCall, libNew, libMethod, libGet, dataObject];
