import { HELPER_PREFIX } from './helpers';
import { NodeRegistry, defaultProps } from './registry';
import type { Blueprint, CompileContext, CompileResult, Diagnostic, Link, NodeDef, NodeInstance, PinDef } from './types';

export interface CompiledBlueprint {
  id: string;
  name: string;
  /**
   * Function expression `function (root, ctx) { …; return dispose; }`. `root` is the document
   * (global/template blueprints) or the component element; `ctx.params` are component params.
   */
  code: string;
  /** Helpers the code calls (see `HELPERS`). */
  helpers: string[];
  diagnostics: Diagnostic[];
}

export interface CompileOptions {
  /** Add `// n3 · Add class` comments before node code (default true). */
  comments?: boolean;
  /** Title of a node in comments (translated titles in the editor). */
  title?: (def: NodeDef, node: NodeInstance) => string;
  /** Indentation unit (default two spaces). */
  indent?: string;
}

const ROOT = 'root';
const DOC = '__doc';
const WIN = '__win';
const DISPOSERS = '__d';

/** JSON literal safe to put inside a `<script>` element. */
export function jsLiteral(value: unknown): string {
  const json = JSON.stringify(value === undefined ? null : value);
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function ident(id: string): string {
  const s = String(id).replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[0-9]/.test(s) ? `_${s}` : s;
}

function commentText(s: string): string {
  return s.replace(/\*\//g, '* /').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
}

function indentBlock(code: string, unit: string): string {
  return code
    .split('\n')
    .map((l) => (l.trim() ? unit + l : l))
    .join('\n');
}

const key = (nodeId: string, pinId: string) => `${nodeId}\u0000${pinId}`;

/** Compiles one blueprint into a function expression. Never throws on bad graphs: problems go to `diagnostics`. */
export function compileBlueprint(bp: Blueprint, registry: NodeRegistry, options: CompileOptions = {}): CompiledBlueprint {
  return new Compiler(bp, registry, options).run();
}

class Compiler {
  private nodes = new Map<string, NodeInstance>();
  /** data input → link */
  private dataIn = new Map<string, Link>();
  /** exec output → links (ordered by target position) */
  private execOut = new Map<string, Link[]>();
  /** exec input → number of incoming links */
  private execInCount = new Map<string, number>();
  /** data outputs that have at least one wire */
  private usedOut = new Set<string>();
  private helpers = new Set<string>();
  private diagnostics: Diagnostic[] = [];
  private declared = new Map<string, string>(); // var name → init expression
  private functions = new Map<string, string>(); // fn name → code (empty while compiling)
  private fnOrder: string[] = [];
  private reached = new Set<string>();
  private localCounter = 0;
  private pureStack: string[] = [];
  private readonly unit: string;

  constructor(
    private bp: Blueprint,
    private registry: NodeRegistry,
    private options: CompileOptions,
  ) {
    this.unit = options.indent ?? '  ';
  }

  run(): CompiledBlueprint {
    const bp = this.bp;
    for (const n of bp.nodes || []) {
      if (this.nodes.has(n.id)) this.diag('error', 'duplicate-node', `Duplicate node id "${n.id}"`, n.id, undefined, undefined, [n.id]);
      this.nodes.set(n.id, n);
    }
    this.indexLinks();

    const events = (bp.nodes || [])
      .map((n) => ({ n, def: this.registry.get(n.type) }))
      .filter((x) => {
        if (!x.def) {
          this.diag('error', 'unknown-node', `Unknown node type "${x.n.type}"`, x.n.id, undefined, undefined, [x.n.type]);
          return false;
        }
        return !!x.def.event && !x.n.disabled;
      })
      .sort((a, b) => (a.def!.order || 0) - (b.def!.order || 0) || a.n.pos[1] - b.n.pos[1] || a.n.pos[0] - b.n.pos[0]);

    const setup: string[] = [];
    for (const { n } of events) {
      this.reached.add(n.id);
      const code = this.compileNode(n, '');
      if (code.trim()) setup.push(code);
    }

    for (const n of bp.nodes || []) {
      const def = this.registry.get(n.type);
      if (!def || def.event || n.disabled) continue;
      if (!this.reached.has(n.id) && !this.registry.isPure(n)) {
        this.diag('warning', 'unreachable', 'Not connected to any event, so it never runs', n.id);
      }
    }

    const u = this.unit;
    const vars = (bp.variables || []).map((v) => `var ${this.variable(v.id)} = ${jsLiteral(v.default ?? defaultOf(v.type))};`);
    const state = Array.from(this.declared.entries()).map(([name, init]) => `var ${name}${init ? ` = ${init}` : ''};`);
    const fns = this.fnOrder.map((name) => this.functions.get(name)!);
    const header = this.options.comments === false ? [] : [`// ${commentText(bp.name || bp.id)} (${bp.kind})`];
    const rest = [...vars, ...state, ...fns, ...setup].join('\n');
    // Declare the environment only when the code uses it (keeps the output readable).
    const uses = (name: string) => new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(rest);
    const usesWin = uses(WIN);
    const body = [
      ...header,
      `var ${DISPOSERS} = [];`,
      ...(uses(DOC) || usesWin ? [`var ${DOC} = ${ROOT}.nodeType === 9 ? ${ROOT} : ${ROOT}.ownerDocument;`] : []),
      ...(usesWin ? [`var ${WIN} = ${DOC}.defaultView || window;`] : []),
      ...(uses('params') ? [`var params = (ctx && ctx.params) || {};`] : []),
      rest,
      `return function () {\n${u}${DISPOSERS}.splice(0).forEach(function (f) { try { f(); } catch (e) {} });\n};`,
    ]
      .filter((l) => l.trim())
      .join('\n');

    return {
      id: bp.id,
      name: bp.name,
      code: `function (${ROOT}, ctx) {\n${indentBlock(body, u)}\n}`,
      helpers: Array.from(this.helpers),
      diagnostics: this.diagnostics,
    };
  }

  // ---------------------------------------------------------------- links

  private indexLinks() {
    const seen = new Set<string>();
    for (const l of this.bp.links || []) {
      const from = this.nodes.get(l.from?.[0]);
      const to = this.nodes.get(l.to?.[0]);
      if (!from || !to) {
        this.diag('error', 'dangling-link', 'Wire to a missing node', from?.id || to?.id, undefined, l);
        continue;
      }
      const outPin = this.registry.pin(from, 'out', l.from[1]);
      const inPin = this.registry.pin(to, 'in', l.to[1]);
      if (!outPin || !inPin) {
        this.diag('error', 'dangling-pin', 'Wire to a missing pin', (outPin ? to : from).id, undefined, l);
        continue;
      }
      const sig = `${l.from.join('.')}>${l.to.join('.')}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (inPin.type === 'exec') {
        const k = key(l.from[0], l.from[1]);
        const arr = this.execOut.get(k) || [];
        arr.push(l);
        this.execOut.set(k, arr);
        const ik = key(l.to[0], l.to[1]);
        this.execInCount.set(ik, (this.execInCount.get(ik) || 0) + 1);
      } else {
        const k = key(l.to[0], l.to[1]);
        if (this.dataIn.has(k)) {
          this.diag('error', 'multiple-inputs', `Input "${inPin.label || inPin.id}" has more than one wire`, to.id, inPin.id, l, [inPin.label || inPin.id]);
          continue;
        }
        this.dataIn.set(k, l);
        this.usedOut.add(key(l.from[0], l.from[1]));
      }
    }
    for (const arr of this.execOut.values()) {
      arr.sort((a, b) => {
        const na = this.nodes.get(a.to[0])!;
        const nb = this.nodes.get(b.to[0])!;
        return na.pos[1] - nb.pos[1] || na.pos[0] - nb.pos[0];
      });
    }
  }

  // ---------------------------------------------------------------- nodes

  private title(n: NodeInstance): string {
    const def = this.registry.get(n.type);
    if (!def) return n.type;
    return this.options.title ? this.options.title(def, n) : def.title;
  }

  /** Code that runs exec node `id` entered through `entry`. */
  private emitExec(id: string, entry: string, stack: string[]): string {
    const n = this.nodes.get(id);
    if (!n) return '';
    this.reached.add(id);
    const shared = (this.execInCount.get(key(id, entry)) || 0) > 1;
    const recursive = stack.includes(key(id, entry));
    if (shared || recursive) {
      const fn = `_${ident(id)}_${ident(entry)}`;
      if (!this.functions.has(fn)) {
        this.functions.set(fn, '');
        const body = this.compileNode(n, entry, [...stack, key(id, entry)]);
        this.functions.set(fn, `function ${fn}() {\n${indentBlock(body, this.unit)}\n}`);
        this.fnOrder.push(fn);
      }
      return `${fn}();`;
    }
    return this.compileNode(n, entry, [...stack, key(id, entry)]);
  }

  private compileNode(n: NodeInstance, entry: string, stack: string[] = []): string {
    const def = this.registry.get(n.type);
    if (!def) return '';
    const ports = this.registry.ports(n);
    const ctx = this.context(n, def, ports.inputs, entry, stack);
    let code: string;
    if (n.disabled) {
      const firstExec = ports.outputs.find((p) => p.type === 'exec');
      code = firstExec ? ctx.next(firstExec.id) : '';
    } else {
      let res: CompileResult | string;
      try {
        res = def.compile(ctx);
      } catch (e) {
        this.diag('error', 'compile-error', (e as Error).message, n.id);
        return '';
      }
      code = typeof res === 'string' ? res : res.code || '';
    }
    if (!code.trim()) return '';
    if (this.options.comments === false) return code.trim();
    return `// ${commentText(`${n.id} · ${this.title(n)}`)}\n${code.trim()}`;
  }

  /** Expression of a pure node's output. */
  private pureOutput(n: NodeInstance, pinId: string): string {
    const def = this.registry.get(n.type);
    if (!def) return 'undefined';
    if (this.pureStack.includes(n.id)) {
      this.diag('error', 'cycle', 'Depends on itself (a loop of data wires)', n.id);
      return 'undefined';
    }
    this.pureStack.push(n.id);
    try {
      const ctx = this.context(n, def, this.registry.ports(n).inputs, '', []);
      const res = def.compile(ctx);
      const expr = typeof res === 'string' ? res : res.outputs?.[pinId];
      if (expr == null) {
        this.diag('error', 'compile-error', `No output "${pinId}"`, n.id, pinId);
        return 'undefined';
      }
      return `(${expr})`;
    } catch (e) {
      this.diag('error', 'compile-error', (e as Error).message, n.id);
      return 'undefined';
    } finally {
      this.pureStack.pop();
    }
  }

  private context(n: NodeInstance, def: NodeDef, inputs: PinDef[], entry: string, stack: string[]): CompileContext {
    const props = { ...defaultProps(def), ...(n.props || {}) };
    const self = this;
    return {
      node: n,
      root: ROOT,
      doc: DOC,
      win: WIN,
      entry,
      prop<T>(id: string): T {
        return props[id] as T;
      },
      linked(pinId) {
        return self.dataIn.has(key(n.id, pinId));
      },
      in(pinId) {
        const pin = inputs.find((p) => p.id === pinId);
        const link = self.dataIn.get(key(n.id, pinId));
        if (link) {
          const src = self.nodes.get(link.from[0])!;
          if (self.registry.isPure(src)) return self.pureOutput(src, link.from[1]);
          return self.outVar(src.id, link.from[1]);
        }
        const value = pinId in props ? props[pinId] : pin?.default;
        return self.literal(pin, value);
      },
      next(pinId) {
        const links = self.execOut.get(key(n.id, pinId)) || [];
        return links
          .map((l) => self.emitExec(l.to[0], l.to[1], stack))
          .filter((c) => c.trim())
          .join('\n');
      },
      out(pinId) {
        return self.outVar(n.id, pinId);
      },
      used(pinId) {
        return self.usedOut.has(key(n.id, pinId));
      },
      set(pinId, expr) {
        return self.usedOut.has(key(n.id, pinId)) ? `${self.outVar(n.id, pinId)} = ${expr};` : '';
      },
      h(name) {
        self.helpers.add(name);
        return HELPER_PREFIX + name;
      },
      lit: jsLiteral,
      local(hint = 'l') {
        return `_${ident(hint)}${++self.localCounter}`;
      },
      variable(id) {
        if (!(self.bp.variables || []).some((v) => v.id === id)) {
          self.diag('error', 'unknown-variable', `Unknown variable "${id}"`, n.id);
        }
        return self.variable(id);
      },
      warn(message) {
        self.diag('warning', 'node-warning', message, n.id);
      },
      state(hint, init) {
        const name = `_${ident(n.id)}_${ident(hint)}`;
        if (!self.declared.has(name)) self.declared.set(name, init || '');
        return name;
      },
    };
  }

  private outVar(nodeId: string, pinId: string): string {
    const name = `_${ident(nodeId)}_${ident(pinId)}`;
    if (!this.declared.has(name)) this.declared.set(name, '');
    return name;
  }

  private variable(id: string): string {
    return `v_${ident(id)}`;
  }

  /** JS for an unconnected input's literal, converted to the pin type. */
  private literal(pin: PinDef | undefined, value: unknown): string {
    const type = pin?.type || 'any';
    switch (type) {
      case 'number': {
        const num = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
        return Number.isFinite(num) ? String(num) : '0';
      }
      case 'boolean':
        return value === true || value === 'true' ? 'true' : 'false';
      case 'string':
        return jsLiteral(value == null ? '' : String(value));
      case 'element':
      case 'elements': {
        // A text literal on an element pin is a selector, looked up from the blueprint root.
        if (typeof value === 'string' && value.trim()) {
          this.helpers.add('q');
          const q = `${HELPER_PREFIX}q(${ROOT}, ${jsLiteral(value.trim())})`;
          return type === 'element' ? `(${q}[0] || null)` : q;
        }
        return 'null';
      }
      case 'event':
        return 'null';
      default:
        return value === undefined ? 'undefined' : jsLiteral(value);
    }
  }

  private diag(severity: Diagnostic['severity'], code: string, message: string, nodeId?: string, pinId?: string, link?: Link, args?: string[]) {
    this.diagnostics.push({ severity, code, message, ...(args ? { args } : {}), ...(nodeId ? { nodeId } : {}), ...(pinId ? { pinId } : {}), ...(link ? { link } : {}) });
  }
}

function defaultOf(type: string): unknown {
  switch (type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return '';
    default:
      return null;
  }
}
