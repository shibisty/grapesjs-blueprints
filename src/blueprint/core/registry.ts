import type { NodeDef, NodeInstance, PinDef, PinType, Ports } from './types';

/** Define a node (identity helper for type inference). */
export function defineNode(def: NodeDef): NodeDef {
  return def;
}

/** Whether a wire may go from an output of type `from` to an input of type `to`. */
export function canConnect(from: PinType, to: PinType): boolean {
  if (from === 'exec' || to === 'exec') return from === to;
  if (from === to || from === 'any' || to === 'any') return true;
  if (to === 'elements' && from === 'element') return true;
  if (to === 'string' && (from === 'number' || from === 'boolean')) return true;
  if (to === 'boolean') return true; // anything is truthy or falsy
  return false;
}

/** Set of node definitions. One registry per editor; built-in nodes are added by `createRegistry()`. */
export class NodeRegistry {
  private defs = new Map<string, NodeDef>();

  constructor(defs: NodeDef[] = []) {
    defs.forEach((d) => this.add(d));
  }

  add(def: NodeDef): this {
    if (!def || typeof def.type !== 'string' || !def.type) throw new Error('[blueprint] node definition without type');
    if (typeof def.compile !== 'function') throw new Error(`[blueprint] node "${def.type}" has no compile()`);
    this.defs.set(def.type, def);
    return this;
  }

  remove(type: string): boolean {
    return this.defs.delete(type);
  }

  get(type: string): NodeDef | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  list(): NodeDef[] {
    return Array.from(this.defs.values());
  }

  categories(): string[] {
    return Array.from(new Set(this.list().map((d) => d.category)));
  }

  /** Pins of a node instance (dynamic pins are computed from its props). */
  ports(node: NodeInstance | string, props?: Record<string, unknown>): Ports {
    const type = typeof node === 'string' ? node : node.type;
    const def = this.defs.get(type);
    if (!def) return { inputs: [], outputs: [] };
    const p = typeof node === 'string' ? props || {} : { ...defaultProps(def), ...(node.props || {}) };
    const ports = typeof def.ports === 'function' ? def.ports(p) : def.ports;
    return { inputs: ports.inputs || [], outputs: ports.outputs || [] };
  }

  pin(node: NodeInstance, side: 'in' | 'out', pinId: string): PinDef | undefined {
    const ports = this.ports(node);
    return (side === 'in' ? ports.inputs : ports.outputs).find((p) => p.id === pinId);
  }

  /** Whether the node is pure (no exec pins at all). */
  isPure(node: NodeInstance): boolean {
    const def = this.defs.get(node.type);
    if (!def || def.event) return false;
    const { inputs, outputs } = this.ports(node);
    return !inputs.some((p) => p.type === 'exec') && !outputs.some((p) => p.type === 'exec');
  }
}

/** Defaults of a definition's props and input literals. */
export function defaultProps(def: NodeDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of def.props || []) if (p.default !== undefined) out[p.id] = clone(p.default);
  if (typeof def.ports !== 'function') {
    for (const pin of def.ports.inputs) if (pin.default !== undefined && !(pin.id in out)) out[pin.id] = clone(pin.default);
  }
  return out;
}

function clone<T>(v: T): T {
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}
