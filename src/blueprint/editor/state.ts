import { compileBlueprint } from '../core/compile';
import { NodeRegistry, canConnect, defaultProps } from '../core/registry';
import { normalizeBlueprint, uid } from '../core/schema';
import type { Blueprint, Diagnostic, GraphComment, Link, NodeInstance, PinRef, Variable } from '../core/types';
import { validateBlueprint } from '../core/validate';

export type ChangeKind = 'graph' | 'move' | 'selection' | 'meta' | 'history';
type Listener = (kind: ChangeKind) => void;

/** What goes to the clipboard: a piece of a graph. */
export interface GraphClip {
  bpClip: 1;
  nodes: NodeInstance[];
  links: Link[];
  comments: GraphComment[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const HISTORY = 100;
export const GRID = 8;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

const sameRef = (a: PinRef, b: PinRef) => a[0] === b[0] && a[1] === b[1];

/**
 * Editing model of one blueprint: graph operations, selection, undo/redo and clipboard.
 * No DOM: the view renders it and calls these methods.
 */
export class GraphState {
  bp: Blueprint;
  /** Selected node ids. */
  readonly selection = new Set<string>();
  /** Selected comment ids. */
  readonly selectedComments = new Set<string>();
  /** A selected wire. */
  selectedLink: Link | null = null;
  /** Bumped on every change of the blueprint. */
  version = 0;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private pending: string | null = null;
  private listeners = new Set<Listener>();
  private diagCache: { version: number; list: Diagnostic[] } | null = null;

  constructor(
    bp: Blueprint,
    readonly registry: NodeRegistry,
  ) {
    this.bp = normalizeBlueprint(clone(bp));
    if (!this.bp.comments) this.bp.comments = [];
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind) {
    if (kind !== 'selection') this.version++;
    this.listeners.forEach((fn) => fn(kind));
  }

  /** A copy of the blueprint (what gets saved). */
  toJSON(): Blueprint {
    const out = clone(this.bp);
    if (!out.comments?.length) delete out.comments;
    return out;
  }

  node(id: string): NodeInstance | undefined {
    return this.bp.nodes.find((n) => n.id === id);
  }

  /* ---------------------------------------------------------- history */

  /** Runs a change as one undo step. */
  mutate(fn: () => void, kind: ChangeKind = 'graph'): void {
    const before = JSON.stringify(this.bp);
    fn();
    if (JSON.stringify(this.bp) === before) return;
    this.push(before);
    this.emit(kind);
  }

  private push(snapshot: string) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Start of a gesture (drag): one undo step for all `moveBy` calls until `end`. */
  begin(): void {
    if (this.pending == null) this.pending = JSON.stringify(this.bp);
  }

  end(): void {
    if (this.pending == null) return;
    const before = this.pending;
    this.pending = null;
    if (JSON.stringify(this.bp) !== before) {
      this.push(before);
      this.emit('graph');
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev == null) return false;
    this.redoStack.push(JSON.stringify(this.bp));
    this.bp = JSON.parse(prev);
    this.dropStaleSelection();
    this.emit('history');
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (next == null) return false;
    this.undoStack.push(JSON.stringify(this.bp));
    this.bp = JSON.parse(next);
    this.dropStaleSelection();
    this.emit('history');
    return true;
  }

  private dropStaleSelection() {
    for (const id of Array.from(this.selection)) if (!this.node(id)) this.selection.delete(id);
    for (const id of Array.from(this.selectedComments)) if (!this.bp.comments?.some((c) => c.id === id)) this.selectedComments.delete(id);
    this.selectedLink = null;
  }

  /* -------------------------------------------------------- selection */

  select(ids: string[], { additive = false, comments = [] as string[] } = {}): void {
    if (!additive) {
      this.selection.clear();
      this.selectedComments.clear();
    }
    ids.forEach((id) => this.node(id) && this.selection.add(id));
    comments.forEach((id) => this.selectedComments.add(id));
    this.selectedLink = null;
    this.emit('selection');
  }

  toggleSelect(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.selectedLink = null;
    this.emit('selection');
  }

  selectLink(link: Link | null): void {
    this.selection.clear();
    this.selectedComments.clear();
    this.selectedLink = link;
    this.emit('selection');
  }

  selectAll(): void {
    this.select(this.bp.nodes.map((n) => n.id));
  }

  clearSelection(): void {
    if (!this.selection.size && !this.selectedComments.size && !this.selectedLink) return;
    this.select([]);
  }

  /* ------------------------------------------------------------ nodes */

  nextNodeId(): string {
    const used = new Set(this.bp.nodes.map((n) => n.id));
    let i = this.bp.nodes.length + 1;
    while (used.has(`n${i}`)) i++;
    return `n${i}`;
  }

  addNode(type: string, pos: [number, number], props?: Record<string, unknown>): string {
    const def = this.registry.get(type);
    if (!def) throw new Error(`[blueprint] unknown node type "${type}"`);
    const id = this.nextNodeId();
    this.mutate(() => {
      const node: NodeInstance = { id, type, pos: [snap(pos[0]), snap(pos[1])] };
      const p = { ...defaultProps(def), ...(props || {}) };
      if (Object.keys(p).length) node.props = p;
      this.bp.nodes.push(node);
    });
    this.selection.clear();
    this.selectedComments.clear();
    this.selection.add(id);
    this.emit('selection');
    return id;
  }

  /** Move nodes (no undo step by itself: wrap in begin/end or mutate). */
  moveBy(ids: Iterable<string>, dx: number, dy: number): void {
    for (const id of ids) {
      const n = this.node(id);
      if (n) n.pos = [n.pos[0] + dx, n.pos[1] + dy];
    }
    this.emit('move');
  }

  /** Snap the given nodes to the grid. */
  snapNodes(ids: Iterable<string>): void {
    for (const id of ids) {
      const n = this.node(id);
      if (n) n.pos = [snap(n.pos[0]), snap(n.pos[1])];
    }
  }

  setProps(id: string, patch: Record<string, unknown>): void {
    this.mutate(() => {
      const n = this.node(id);
      if (!n) return;
      n.props = { ...(n.props || {}), ...clone(patch) };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete n.props[k];
      this.dropDeadLinks(n);
    });
  }

  setNodeFlags(id: string, flags: { disabled?: boolean; collapsed?: boolean }): void {
    this.mutate(() => {
      const n = this.node(id);
      if (!n) return;
      for (const [k, v] of Object.entries(flags) as ['disabled' | 'collapsed', boolean][]) {
        if (v) n[k] = true;
        else delete n[k];
      }
    });
  }

  /** Delete the selection (nodes with their wires, comments, or the selected wire). */
  deleteSelection(): void {
    const nodes = new Set(this.selection);
    const comments = new Set(this.selectedComments);
    const link = this.selectedLink;
    if (!nodes.size && !comments.size && !link) return;
    this.selection.clear();
    this.selectedComments.clear();
    this.selectedLink = null;
    this.mutate(() => {
      this.bp.nodes = this.bp.nodes.filter((n) => !nodes.has(n.id));
      this.bp.links = this.bp.links.filter((l) => !nodes.has(l.from[0]) && !nodes.has(l.to[0]) && !(link && sameRef(l.from, link.from) && sameRef(l.to, link.to)));
      this.bp.comments = (this.bp.comments || []).filter((c) => !comments.has(c.id));
    });
  }

  /** Remove wires whose pins disappeared (dynamic pins changed). */
  private dropDeadLinks(n: NodeInstance) {
    const ports = this.registry.ports(n);
    const ins = new Set(ports.inputs.map((p) => p.id));
    const outs = new Set(ports.outputs.map((p) => p.id));
    this.bp.links = this.bp.links.filter((l) => (l.to[0] !== n.id || ins.has(l.to[1])) && (l.from[0] !== n.id || outs.has(l.from[1])));
  }

  /* ------------------------------------------------------------ wires */

  /** The pin's side and type, or null. */
  pinInfo(ref: PinRef): { side: 'in' | 'out'; type: string } | null {
    const n = this.node(ref[0]);
    if (!n) return null;
    const ports = this.registry.ports(n);
    const out = ports.outputs.find((p) => p.id === ref[1]);
    const inp = ports.inputs.find((p) => p.id === ref[1]);
    // Same id on both sides (literal nodes: value → value): the caller says which side via `side`.
    if (out && !inp) return { side: 'out', type: out.type };
    if (inp && !out) return { side: 'in', type: inp.type };
    if (inp && out) return { side: 'in', type: inp.type };
    return null;
  }

  /** Whether `from` (output) may be wired to `to` (input). */
  canLink(from: PinRef, to: PinRef): boolean {
    if (from[0] === to[0]) return false;
    const a = this.node(from[0]);
    const b = this.node(to[0]);
    if (!a || !b) return false;
    const pa = this.registry.pin(a, 'out', from[1]);
    const pb = this.registry.pin(b, 'in', to[1]);
    return !!pa && !!pb && canConnect(pa.type, pb.type);
  }

  /**
   * Wire an output to an input. A data input keeps one wire and an exec output drives one
   * input (as in UE blueprints): the old wire is replaced.
   */
  connect(from: PinRef, to: PinRef): boolean {
    if (!this.canLink(from, to)) return false;
    const a = this.node(from[0])!;
    const outType = this.registry.pin(a, 'out', from[1])!.type;
    this.mutate(() => {
      this.bp.links = this.bp.links.filter((l) => {
        if (sameRef(l.from, from) && sameRef(l.to, to)) return false;
        if (outType === 'exec') return !sameRef(l.from, from);
        return !sameRef(l.to, to);
      });
      this.bp.links.push({ from: [from[0], from[1]], to: [to[0], to[1]] });
    });
    return true;
  }

  /** Remove every wire of a pin. */
  disconnect(ref: PinRef, side: 'in' | 'out'): void {
    this.mutate(() => {
      this.bp.links = this.bp.links.filter((l) => !sameRef(side === 'in' ? l.to : l.from, ref));
    });
  }

  removeLink(link: Link): void {
    this.mutate(() => {
      this.bp.links = this.bp.links.filter((l) => !(sameRef(l.from, link.from) && sameRef(l.to, link.to)));
    });
    if (this.selectedLink && sameRef(this.selectedLink.from, link.from) && sameRef(this.selectedLink.to, link.to)) this.selectedLink = null;
  }

  linksOf(nodeId: string): Link[] {
    return this.bp.links.filter((l) => l.from[0] === nodeId || l.to[0] === nodeId);
  }

  isLinked(ref: PinRef, side: 'in' | 'out'): boolean {
    return this.bp.links.some((l) => sameRef(side === 'in' ? l.to : l.from, ref));
  }

  /* ------------------------------------------------------ meta / vars */

  setMeta(patch: Partial<Pick<Blueprint, 'name' | 'description' | 'enabled' | 'target' | 'component'>>): void {
    this.mutate(() => {
      for (const [k, v] of Object.entries(clone(patch))) {
        if (v === undefined) delete (this.bp as any)[k];
        else (this.bp as any)[k] = v;
      }
    }, 'meta');
  }

  addVariable(init: Partial<Variable> = {}): Variable {
    const used = new Set(this.bp.variables.map((v) => v.id));
    const names = new Set(this.bp.variables.map((v) => v.name));
    let i = this.bp.variables.length + 1;
    while (used.has(`v${i}`)) i++;
    let name = init.name || `var${i}`;
    let k = 2;
    while (names.has(name)) name = `${init.name || 'var'}${k++}`;
    const v: Variable = { id: `v${i}`, name, type: init.type || 'any', ...(init.default !== undefined ? { default: init.default } : {}) };
    this.mutate(() => this.bp.variables.push(v), 'meta');
    return clone(v);
  }

  updateVariable(id: string, patch: Partial<Omit<Variable, 'id'>>): void {
    this.mutate(() => {
      const v = this.bp.variables.find((x) => x.id === id);
      if (!v) return;
      Object.assign(v, clone(patch));
      if (patch.default === undefined && 'default' in patch) delete v.default;
    }, 'meta');
  }

  removeVariable(id: string): void {
    this.mutate(() => {
      this.bp.variables = this.bp.variables.filter((v) => v.id !== id);
    }, 'meta');
  }

  /* --------------------------------------------------------- comments */

  addComment(pos: [number, number], size: [number, number], text = 'Comment'): string {
    const id = uid('c');
    this.mutate(() => {
      this.bp.comments = [...(this.bp.comments || []), { id, text, pos: [snap(pos[0]), snap(pos[1])], size: [snap(size[0]), snap(size[1])] }];
    });
    this.select([], { comments: [id] });
    return id;
  }

  updateComment(id: string, patch: Partial<Omit<GraphComment, 'id'>>, { history = true } = {}): void {
    const apply = () => {
      const c = this.bp.comments?.find((x) => x.id === id);
      if (c) Object.assign(c, clone(patch));
    };
    if (history) this.mutate(apply);
    else {
      apply();
      this.emit('move');
    }
  }

  comment(id: string): GraphComment | undefined {
    return this.bp.comments?.find((c) => c.id === id);
  }

  /* --------------------------------------------------------- clipboard */

  /** The selection as a clip (nodes, the wires between them, selected comments). */
  copy(): GraphClip | null {
    const ids = new Set(this.selection);
    const comments = (this.bp.comments || []).filter((c) => this.selectedComments.has(c.id));
    if (!ids.size && !comments.length) return null;
    return clone({
      bpClip: 1 as const,
      nodes: this.bp.nodes.filter((n) => ids.has(n.id)),
      links: this.bp.links.filter((l) => ids.has(l.from[0]) && ids.has(l.to[0])),
      comments,
    });
  }

  /** Insert a clip with new ids; its top-left goes to `at`. Unknown node types are skipped. */
  paste(clip: GraphClip, at: [number, number]): string[] {
    if (!clip || clip.bpClip !== 1) return [];
    const nodes = (clip.nodes || []).filter((n) => this.registry.has(n.type));
    const xs = [...nodes.map((n) => n.pos[0]), ...(clip.comments || []).map((c) => c.pos[0])];
    const ys = [...nodes.map((n) => n.pos[1]), ...(clip.comments || []).map((c) => c.pos[1])];
    if (!xs.length) return [];
    const dx = at[0] - Math.min(...xs);
    const dy = at[1] - Math.min(...ys);
    const map = new Map<string, string>();
    const newIds: string[] = [];
    const commentIds: string[] = [];
    this.mutate(() => {
      for (const n of nodes) {
        const id = this.nextNodeId();
        map.set(n.id, id);
        newIds.push(id);
        this.bp.nodes.push({ ...clone(n), id, pos: [snap(n.pos[0] + dx), snap(n.pos[1] + dy)] });
      }
      for (const l of clip.links || []) {
        const a = map.get(l.from[0]);
        const b = map.get(l.to[0]);
        if (a && b) this.bp.links.push({ from: [a, l.from[1]], to: [b, l.to[1]] });
      }
      for (const c of clip.comments || []) {
        const id = uid('c');
        commentIds.push(id);
        this.bp.comments = [...(this.bp.comments || []), { ...clone(c), id, pos: [snap(c.pos[0] + dx), snap(c.pos[1] + dy)] }];
      }
    });
    this.select(newIds, { comments: commentIds });
    return newIds;
  }

  /* ------------------------------------------------------- diagnostics */

  diagnostics(): Diagnostic[] {
    if (this.diagCache?.version === this.version) return this.diagCache.list;
    const seen = new Set<string>();
    const list = [...validateBlueprint(this.bp, this.registry), ...compileBlueprint(this.bp, this.registry).diagnostics].filter((d) => {
      const k = `${d.code}|${d.nodeId || ''}|${d.pinId || ''}|${d.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    this.diagCache = { version: this.version, list };
    return list;
  }

  /** Bounding box of nodes (`ids`) using sizes from `size` (the view measures). */
  bounds(ids: Iterable<string> | null, size: (id: string) => [number, number]): { x: number; y: number; w: number; h: number } | null {
    const list = ids ? Array.from(ids).map((id) => this.node(id)).filter(Boolean) as NodeInstance[] : this.bp.nodes;
    if (!list.length) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const n of list) {
      const [w, h] = size(n.id);
      x1 = Math.min(x1, n.pos[0]);
      y1 = Math.min(y1, n.pos[1]);
      x2 = Math.max(x2, n.pos[0] + w);
      y2 = Math.max(y2, n.pos[1] + h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
}
