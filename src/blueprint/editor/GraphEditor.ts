import { buildScript, buildStandalone } from '../core/build';
import { NodeRegistry, canConnect, defaultProps } from '../core/registry';
import type { Blueprint, Link, NodeDef, NodeInstance, PinDef, PinRef } from '../core/types';
import { Details } from './details';
import { defaultText, h, svg, type Text } from './dom';
import { highlight } from './highlight';
import { GraphState, snap, type GraphClip } from './state';
import { CATEGORY_COLORS, PIN_COLORS, injectEditorCss } from './styles';

export interface GraphEditorOptions {
  blueprint: Blueprint;
  registry: NodeRegistry;
  /** Text lookup (translations). Keys: `ui.*`, `node.<type>`, `desc.<type>`, `cat.<id>`, `label.<English label>`. */
  t?: Text;
  /** JavaScript shown in the JS tab (default: the blueprint built alone). */
  code?: (bp: Blueprint) => string;
  /** Pages for template targets. */
  pages?: () => { id: string; name: string }[];
  /** Pick a CSS selector (e.g. by clicking in a page); resolves to null when cancelled. */
  pickSelector?: () => Promise<string | null>;
  /** Check a component type; returns an error message or null. */
  validateComponentType?: (type: string) => string | null;
  /** Called after every change of the blueprint (not on selection or while dragging). */
  onChange?: (bp: Blueprint) => void;
  /** The close button / `close()`. */
  onClose?: (bp: Blueprint) => void;
  /** localStorage key for copy/paste between blueprints (`false` = in-memory only). */
  clipboardKey?: string | false;
  /** Inject the editor CSS (default true). */
  injectCss?: boolean;
  /** Text direction. */
  dir?: 'ltr' | 'rtl';
}

type Drag =
  | { kind: 'nodes'; ids: string[]; x: number; y: number; moved: boolean; comments: string[] }
  | { kind: 'pan'; x: number; y: number; px: number; py: number; moved: boolean; button: number }
  | { kind: 'marquee'; x0: number; y0: number; x: number; y: number; additive: boolean }
  | { kind: 'wire'; ref: PinRef; side: 'in' | 'out'; type: string; x: number; y: number }
  | { kind: 'resize'; id: string; x: number; y: number; w: number; h: number };

let memoryClipboard: GraphClip | null = null;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;

/** Pin types that get an inline literal editor when not connected. */
const LITERAL_TYPES = new Set(['string', 'number', 'boolean', 'element', 'elements', 'any']);

/**
 * Visual blueprint editor: palette, graph canvas (pan, zoom, wires, selection, comments),
 * details panel, problems, JS view. Independent of GrapesJS.
 */
export class GraphEditor {
  readonly root: HTMLDivElement;
  readonly state: GraphState;
  readonly t: Text;
  readonly registry: NodeRegistry;
  zoom = 1;
  pan = { x: 80, y: 60 };
  tab: 'graph' | 'code' = 'graph';

  private readonly opts: GraphEditorOptions;
  private readonly canvas: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly nodesLayer: HTMLDivElement;
  private readonly commentsLayer: HTMLDivElement;
  private readonly wires: SVGSVGElement;
  private readonly overlay: SVGSVGElement;
  private readonly marquee: HTMLDivElement;
  private readonly minimap: SVGSVGElement;
  private readonly hint: HTMLDivElement;
  private readonly zoomLabel: HTMLDivElement;
  private readonly codeView: HTMLPreElement;
  private readonly paletteList: HTMLDivElement;
  private readonly paletteSearch: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private readonly tabs: Record<'graph' | 'code', HTMLButtonElement>;
  private readonly tools: Record<'undo' | 'redo' | 'fit' | 'comment' | 'problems' | 'close', HTMLButtonElement>;
  private readonly details: Details;
  private nodeEls = new Map<string, HTMLDivElement>();
  private drag: Drag | null = null;
  private spaceDown = false;
  private mouse: { x: number; y: number } | null = null;
  private search: { el: HTMLDivElement; close: () => void } | null = null;
  private rafQueued = false;
  private destroyed = false;
  private readonly offs: (() => void)[] = [];

  constructor(opts: GraphEditorOptions) {
    this.opts = opts;
    this.t = opts.t || defaultText;
    this.registry = opts.registry;
    this.state = new GraphState(opts.blueprint, opts.registry);
    if (opts.injectCss !== false) injectEditorCss();
    const t = this.t;
    const ed = this.state.bp.editor;
    if (ed?.pan) this.pan = { x: ed.pan[0], y: ed.pan[1] };
    if (ed?.zoom) this.zoom = clamp(ed.zoom, ZOOM_MIN, ZOOM_MAX);

    /* top bar */
    const tbtn = (label: string, title: string, onclick: () => void, cls = '') =>
      h('button', { type: 'button', class: `bpe-tbtn ${cls}`, title, 'aria-label': title, onclick }, label);
    this.nameInput = h('input', {
      class: 'bpe-name',
      type: 'text',
      'aria-label': t('ui.name', 'Name'),
      onchange: () => {
        const v = this.nameInput.value.trim();
        if (v) this.state.setMeta({ name: v });
        else this.nameInput.value = this.state.bp.name;
      },
    });
    this.tabs = {
      graph: h('button', { type: 'button', class: 'bpe-tab', onclick: () => this.setTab('graph') }, t('ui.graph', 'Graph')),
      code: h('button', { type: 'button', class: 'bpe-tab', onclick: () => this.setTab('code') }, 'JavaScript'),
    };
    this.tools = {
      undo: tbtn('↶', t('ui.undo', 'Undo (Ctrl+Z)'), () => this.state.undo()),
      redo: tbtn('↷', t('ui.redo', 'Redo (Ctrl+Y)'), () => this.state.redo()),
      fit: tbtn('⤢', t('ui.fit', 'Fit to screen (F)'), () => this.fit()),
      comment: tbtn('▭', t('ui.comment', 'Comment around the selection (C)'), () => this.commentSelection()),
      problems: tbtn('', t('ui.problems', 'Problems'), () => this.details.focusProblems(), 'bpe-problems-btn'),
      close: tbtn(t('ui.done', 'Done'), t('ui.close', 'Close the editor'), () => this.close(), 'is-primary'),
    };
    const top = h(
      'div',
      { class: 'bpe-top' },
      this.nameInput,
      h('span', { class: 'bpe-badge' }, this.kindLabel()),
      h('div', { class: 'bpe-tabs', role: 'tablist' }, this.tabs.graph, this.tabs.code),
      h('span', { class: 'bpe-spacer' }),
      this.tools.problems,
      this.tools.undo,
      this.tools.redo,
      this.tools.comment,
      this.tools.fit,
      this.tools.close,
    );

    /* palette */
    this.paletteSearch = h('input', {
      class: 'bpe-palette-search',
      type: 'search',
      placeholder: t('ui.searchBlocks', 'Search blocks'),
      'aria-label': t('ui.searchBlocks', 'Search blocks'),
      oninput: () => this.renderPalette(),
    });
    this.paletteList = h('div', { class: 'bpe-palette-list' });
    const palette = h('div', { class: 'bpe-palette' }, this.paletteSearch, this.paletteList);

    /* canvas */
    this.commentsLayer = h('div', { class: 'bpe-comments' });
    this.wires = svg('svg', { class: 'bpe-wires' });
    this.nodesLayer = h('div', { class: 'bpe-nodes' });
    this.overlay = svg('svg', { class: 'bpe-overlay' });
    this.viewport = h('div', { class: 'bpe-viewport' }, this.commentsLayer, this.wires as unknown as Node, this.nodesLayer, this.overlay as unknown as Node);
    this.marquee = h('div', { class: 'bpe-marquee', hidden: true });
    this.minimap = svg('svg', { class: 'bpe-minimap' });
    this.hint = h('div', { class: 'bpe-hint' }, t('ui.hint', 'Drag blocks from the left, or right-click / double-click the canvas to add one. Connect pins by dragging.'));
    this.zoomLabel = h('div', { class: 'bpe-zoom' });
    this.canvas = h('div', { class: 'bpe-canvas', tabindex: 0 }, this.viewport, this.marquee, this.hint, this.zoomLabel, this.minimap as unknown as Node);
    this.codeView = h('pre', { class: 'bpe-code', hidden: true, tabindex: 0 });

    this.details = new Details(this);
    this.root = h(
      'div',
      { class: 'bpe', dir: opts.dir || 'ltr', role: 'dialog', 'aria-label': t('ui.editor', 'Blueprint editor') },
      top,
      h('div', { class: 'bpe-main' }, palette, this.canvas, this.codeView, this.details.root),
    );

    this.bindCanvas();
    this.bindKeys();
    this.offs.push(
      this.state.on((kind) => {
        if (kind === 'move') this.scheduleWires(), this.positionNodes();
        else if (kind === 'selection') this.renderSelection();
        else this.renderAll();
        if (kind !== 'selection' && kind !== 'move') this.opts.onChange?.(this.state.toJSON());
      }),
    );
    this.renderPalette();
    this.renderAll();
    this.setTab('graph');
  }

  /* --------------------------------------------------------- lifecycle */

  /** Insert into the page (default `document.body`) and fit the graph. */
  mount(parent: HTMLElement = document.body): this {
    parent.appendChild(this.root);
    if (!this.state.bp.editor?.pan) requestAnimationFrame(() => this.fit());
    else this.renderWires();
    this.canvas.focus({ preventScroll: true });
    return this;
  }

  close(): void {
    if (this.destroyed) return;
    const bp = this.state.toJSON();
    bp.editor = { pan: [Math.round(this.pan.x), Math.round(this.pan.y)], zoom: Math.round(this.zoom * 100) / 100 };
    this.opts.onClose?.(bp);
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.search?.close();
    this.offs.splice(0).forEach((f) => f());
    this.root.dispatchEvent(new CustomEvent('bpe:closed'));
    this.root.remove();
  }

  /* ------------------------------------------------------------- text */

  nodeTitle(def: NodeDef | undefined, type: string): string {
    return def ? this.t(`node.${type}`, def.title) : type;
  }

  nodeDesc(def: NodeDef): string {
    return this.t(`desc.${def.type}`, def.description || '');
  }

  label(s: string | undefined, fallback = ''): string {
    const v = s ?? fallback;
    return v ? this.t(`label.${v}`, v) : '';
  }

  categoryLabel(cat: string): string {
    return this.t(`cat.${cat}`, cat.charAt(0).toUpperCase() + cat.slice(1));
  }

  private kindLabel(): string {
    const k = this.state.bp.kind;
    return k === 'template' ? this.t('ui.kindTemplate', 'Template') : k === 'component' ? this.t('ui.kindComponent', 'Component') : this.t('ui.kindGlobal', 'Global');
  }

  /* ------------------------------------------------------------ render */

  private renderAll() {
    if (this.destroyed) return;
    this.nameInput.value = this.state.bp.name;
    this.renderNodes();
    this.renderComments();
    this.renderSelection();
    this.applyView();
    this.scheduleWires();
    if (this.tab === 'code') this.renderCode();
    this.tools.undo.disabled = !this.state.canUndo;
    this.tools.redo.disabled = !this.state.canRedo;
    const diags = this.state.diagnostics();
    const errors = diags.filter((d) => d.severity === 'error').length;
    const warnings = diags.length - errors;
    this.tools.problems.textContent = errors ? `⚠ ${errors}` : warnings ? `⚠ ${warnings}` : '✓';
    this.tools.problems.classList.toggle('has-errors', errors > 0);
    this.hint.hidden = this.state.bp.nodes.length > 0;
  }

  private renderSelection() {
    for (const [id, el] of this.nodeEls) el.classList.toggle('is-selected', this.state.selection.has(id));
    this.commentsLayer.querySelectorAll<HTMLElement>('.bpe-comment').forEach((el) => el.classList.toggle('is-selected', this.state.selectedComments.has(el.dataset.id!)));
    this.renderWires();
    this.details.render();
  }

  private positionNodes() {
    for (const n of this.state.bp.nodes) {
      const el = this.nodeEls.get(n.id);
      if (el) {
        el.style.left = `${n.pos[0]}px`;
        el.style.top = `${n.pos[1]}px`;
      }
    }
    for (const c of this.state.bp.comments || []) {
      const el = this.commentsLayer.querySelector<HTMLElement>(`[data-id="${c.id}"]`);
      if (el) Object.assign(el.style, { left: `${c.pos[0]}px`, top: `${c.pos[1]}px`, width: `${c.size[0]}px`, height: `${c.size[1]}px` });
    }
  }

  private renderNodes() {
    const errors = new Set(this.state.diagnostics().filter((d) => d.severity === 'error' && d.nodeId).map((d) => d.nodeId!));
    this.nodeEls.clear();
    const frag = document.createDocumentFragment();
    for (const n of this.state.bp.nodes) {
      const el = this.nodeEl(n);
      if (errors.has(n.id)) el.classList.add('has-error');
      this.nodeEls.set(n.id, el);
      frag.appendChild(el);
    }
    this.nodesLayer.replaceChildren(frag);
  }

  private nodeEl(n: NodeInstance): HTMLDivElement {
    const def = this.registry.get(n.type);
    const ports = this.registry.ports(n);
    const color = def?.color || CATEGORY_COLORS[def?.category || ''] || '#5b5f66';
    const head = h(
      'div',
      { class: 'bpe-node-head', style: `background:${color}` },
      def?.event ? h('span', { class: 'bpe-ev' }, '◆') : null,
      def ? this.nodeTitle(def, n.type) : `? ${n.type}`,
    );
    const summary = def ? this.summary(n, def) : '';
    const ins = h('div', { class: 'bpe-col is-in' }, ports.inputs.map((p) => this.pinEl(n, p, 'in')));
    const outs = h('div', { class: 'bpe-col is-out' }, ports.outputs.map((p) => this.pinEl(n, p, 'out')));
    const el = h(
      'div',
      {
        class: `bpe-node${n.disabled ? ' is-disabled' : ''}${def ? '' : ' has-error'}`,
        'data-id': n.id,
        title: def ? this.nodeDesc(def) : '',
        style: `left:${n.pos[0]}px;top:${n.pos[1]}px`,
      },
      head,
      summary ? h('div', { class: 'bpe-node-sub' }, summary) : null,
      h('div', { class: 'bpe-node-body' }, ins, outs),
    );
    return el;
  }

  /** Short line under the title: the node's settings (event, selector, operator…). */
  private summary(n: NodeInstance, def: NodeDef): string {
    const props = { ...defaultProps(def), ...(n.props || {}) };
    const parts: string[] = [];
    for (const p of def.props || []) {
      const v = props[p.id];
      if (v == null || v === '' || p.type === 'code' || p.type === 'pins') continue;
      if (p.type === 'boolean') {
        if (v === true) parts.push(this.label(p.label, p.id));
      } else if (p.type === 'variable') {
        parts.push(this.state.bp.variables.find((x) => x.id === v)?.name || String(v));
      } else if (p.type === 'select') {
        const opt = p.options?.find((o) => o.value === v);
        parts.push(this.label(opt?.label, String(v)));
      } else parts.push(String(v));
    }
    const s = parts.join(' · ');
    return s.length > 48 ? `${s.slice(0, 47)}…` : s;
  }

  private pinEl(n: NodeInstance, p: PinDef, side: 'in' | 'out'): HTMLElement {
    const linked = this.state.isLinked([n.id, p.id], side);
    const color = PIN_COLORS[p.type] || PIN_COLORS.any;
    const label = p.type === 'exec' && (p.id === 'exec' || p.id === 'then') ? '' : this.label(p.label, p.id);
    const row = h(
      'div',
      {
        class: `bpe-pin is-${side}${linked ? ' is-linked' : ''}`,
        'data-node': n.id,
        'data-pin': p.id,
        'data-side': side,
        'data-type': p.type,
        style: `--c:${color}`,
        title: `${label || p.id}: ${p.type}`,
      },
      h('span', { class: 'bpe-dot' }),
      label ? h('span', { class: 'bpe-pin-label' }, label) : null,
    );
    if (side === 'in' && !linked && !p.noLiteral && LITERAL_TYPES.has(p.type)) row.appendChild(this.literalEl(n, p));
    return row;
  }

  private literalEl(n: NodeInstance, p: PinDef): HTMLElement {
    const value = n.props && p.id in n.props ? n.props[p.id] : p.default;
    const commit = (v: unknown) => this.state.setProps(n.id, { [p.id]: v });
    if (p.type === 'boolean') {
      return h('input', { type: 'checkbox', class: 'bpe-lit', checked: value === true, onchange: (e: Event) => commit((e.target as HTMLInputElement).checked) });
    }
    const input = h('input', {
      class: 'bpe-lit',
      type: p.type === 'number' ? 'number' : 'text',
      spellcheck: 'false',
      placeholder: p.type === 'element' || p.type === 'elements' ? this.t('ui.selector', 'selector') : '',
      onchange: () => commit(p.type === 'number' ? (input.value === '' ? 0 : Number(input.value)) : input.value),
      onkeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === 'Enter') input.blur();
      },
    });
    input.value = value == null ? '' : String(value);
    return input;
  }

  private renderComments() {
    const frag = document.createDocumentFragment();
    for (const c of this.state.bp.comments || []) {
      const head = h('div', { class: 'bpe-comment-head', title: this.t('ui.commentHint', 'Double-click to rename') }, c.text);
      const el = h(
        'div',
        { class: 'bpe-comment', 'data-id': c.id, style: `left:${c.pos[0]}px;top:${c.pos[1]}px;width:${c.size[0]}px;height:${c.size[1]}px${c.color ? `;background:${c.color}` : ''}` },
        head,
        h('div', { class: 'bpe-comment-resize' }),
      );
      head.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.editCommentText(c.id, head);
      });
      frag.appendChild(el);
    }
    this.commentsLayer.replaceChildren(frag);
  }

  private editCommentText(id: string, head: HTMLElement) {
    const c = this.state.comment(id);
    if (!c) return;
    const input = h('input', { type: 'text', style: 'width:100%' });
    input.value = c.text;
    const done = (save: boolean) => {
      if (save && input.value.trim()) this.state.updateComment(id, { text: input.value.trim() });
      else this.renderComments();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
    head.replaceChildren(input);
    input.focus();
    input.select();
  }

  /* ------------------------------------------------------------- wires */

  private scheduleWires() {
    if (this.rafQueued) return;
    this.rafQueued = true;
    const run = () => {
      this.rafQueued = false;
      if (!this.destroyed) this.renderWires();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /** Centre of a pin's dot in graph coordinates. */
  pinPos(ref: PinRef, side: 'in' | 'out'): [number, number] | null {
    const nodeEl = this.nodeEls.get(ref[0]);
    const n = this.state.node(ref[0]);
    if (!nodeEl || !n) return null;
    const dot = nodeEl.querySelector<HTMLElement>(`.bpe-pin[data-side="${side}"][data-pin="${cssEscape(ref[1])}"] .bpe-dot`);
    if (!dot) return null;
    const a = nodeEl.getBoundingClientRect();
    const b = dot.getBoundingClientRect();
    return [n.pos[0] + (b.left - a.left + b.width / 2) / this.zoom, n.pos[1] + (b.top - a.top + b.height / 2) / this.zoom];
  }

  renderWires(): void {
    const frag = document.createDocumentFragment();
    const sel = this.state.selectedLink;
    this.state.bp.links.forEach((l, i) => {
      const a = this.pinPos(l.from, 'out');
      const b = this.pinPos(l.to, 'in');
      if (!a || !b) return;
      const fromNode = this.state.node(l.from[0])!;
      const type = this.registry.pin(fromNode, 'out', l.from[1])?.type || 'any';
      const d = wirePath(a, b);
      const selected = !!sel && sel.from[0] === l.from[0] && sel.from[1] === l.from[1] && sel.to[0] === l.to[0] && sel.to[1] === l.to[1];
      const touchesSel = this.state.selection.has(l.from[0]) || this.state.selection.has(l.to[0]);
      frag.appendChild(svg('path', { class: `bpe-wire${type === 'exec' ? ' is-exec' : ''}${selected ? ' is-selected' : ''}`, d, stroke: PIN_COLORS[type] || PIN_COLORS.any, opacity: touchesSel ? 1 : 0.85 }));
      frag.appendChild(svg('path', { class: 'bpe-wire-hit', d, 'data-link': i }));
    });
    this.wires.replaceChildren(frag);
    this.renderMinimap();
  }

  /* -------------------------------------------------------------- view */

  /** Screen (client) point → graph coordinates. */
  toGraph(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left - this.pan.x) / this.zoom, (clientY - r.top - this.pan.y) / this.zoom];
  }

  private applyView() {
    this.viewport.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    const g = 16 * this.zoom;
    this.canvas.style.backgroundSize = `${g}px ${g}px`;
    this.canvas.style.backgroundPosition = `${this.pan.x}px ${this.pan.y}px`;
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    this.renderMinimap();
  }

  setZoom(z: number, at?: { x: number; y: number }): void {
    const nz = clamp(z, ZOOM_MIN, ZOOM_MAX);
    const r = this.canvas.getBoundingClientRect();
    const ax = at ? at.x - r.left : r.width / 2;
    const ay = at ? at.y - r.top : r.height / 2;
    this.pan.x = ax - ((ax - this.pan.x) * nz) / this.zoom;
    this.pan.y = ay - ((ay - this.pan.y) * nz) / this.zoom;
    this.zoom = nz;
    this.applyView();
  }

  private nodeSize = (id: string): [number, number] => {
    const el = this.nodeEls.get(id);
    return [el?.offsetWidth || 180, el?.offsetHeight || 80];
  };

  /** Fit the whole graph (or the selection) into the canvas. */
  fit(onlySelection = false): void {
    const ids = onlySelection && this.state.selection.size ? this.state.selection : null;
    let b = this.state.bounds(ids, this.nodeSize);
    for (const c of ids ? [] : this.state.bp.comments || []) {
      b = b
        ? (() => {
            const x = Math.min(b!.x, c.pos[0]);
            const y = Math.min(b!.y, c.pos[1]);
            return { x, y, w: Math.max(b!.x + b!.w, c.pos[0] + c.size[0]) - x, h: Math.max(b!.y + b!.h, c.pos[1] + c.size[1]) - y };
          })()
        : { x: c.pos[0], y: c.pos[1], w: c.size[0], h: c.size[1] };
    }
    const r = this.canvas.getBoundingClientRect();
    if (!b || !r.width) {
      this.pan = { x: 80, y: 60 };
      this.zoom = 1;
    } else {
      const pad = 60;
      // Keep clear of the minimap in the bottom-right corner.
      const mm = this.state.bp.nodes.length > 1 ? 150 : 0;
      const w = r.width - pad * 2 - mm;
      const hh = r.height - pad * 2;
      this.zoom = clamp(Math.min(w / Math.max(b.w, 1), hh / Math.max(b.h, 1), 1), 0.3, 1);
      this.pan = { x: pad + (w - b.w * this.zoom) / 2 - b.x * this.zoom, y: pad + (hh - b.h * this.zoom) / 2 - b.y * this.zoom };
    }
    this.applyView();
    this.renderWires();
  }

  /** Centre the view on a node and select it. */
  focusNode(id: string): void {
    const n = this.state.node(id);
    if (!n) return;
    if (this.tab !== 'graph') this.setTab('graph');
    this.state.select([id]);
    const r = this.canvas.getBoundingClientRect();
    const [w, hh] = this.nodeSize(id);
    this.pan = { x: r.width / 2 - (n.pos[0] + w / 2) * this.zoom, y: r.height / 2 - (n.pos[1] + hh / 2) * this.zoom };
    this.applyView();
  }

  setTab(tab: 'graph' | 'code'): void {
    this.tab = tab;
    this.tabs.graph.classList.toggle('is-active', tab === 'graph');
    this.tabs.code.classList.toggle('is-active', tab === 'code');
    this.tabs.graph.setAttribute('aria-selected', String(tab === 'graph'));
    this.tabs.code.setAttribute('aria-selected', String(tab === 'code'));
    this.canvas.hidden = tab !== 'graph';
    this.codeView.hidden = tab !== 'code';
    if (tab === 'code') this.renderCode();
    else {
      this.renderWires();
      this.canvas.focus({ preventScroll: true });
    }
  }

  /** The JavaScript of the blueprint as it is now. */
  code(): string {
    const bp = this.state.toJSON();
    if (this.opts.code) return this.opts.code(bp);
    if (bp.kind === 'component') return `(${buildStandalone(bp, this.registry).code});\n`;
    return buildScript([bp], this.registry, { includeDisabled: true }).code;
  }

  private renderCode() {
    const hl = highlight(this.code(), 'bpe');
    // Lines with `// <nodeId> · Title` jump to the node.
    hl.querySelectorAll<HTMLElement>('.bpe-ln').forEach((line) => {
      const m = /^\s*\/\/ (\S+) · /.exec(line.textContent || '');
      if (m && this.state.node(m[1])) {
        line.classList.add('is-node');
        line.dataset.node = m[1];
      }
    });
    this.codeView.replaceChildren(hl);
  }

  private renderMinimap() {
    const mm = this.minimap;
    const r = this.canvas.getBoundingClientRect();
    const nodes = this.state.bp.nodes;
    mm.style.display = nodes.length > 1 ? '' : 'none';
    if (!nodes.length) return mm.replaceChildren();
    const view = { x: -this.pan.x / this.zoom, y: -this.pan.y / this.zoom, w: (r.width || 800) / this.zoom, h: (r.height || 600) / this.zoom };
    const b = this.state.bounds(null, this.nodeSize)!;
    const x1 = Math.min(b.x, view.x) - 40;
    const y1 = Math.min(b.y, view.y) - 40;
    const x2 = Math.max(b.x + b.w, view.x + view.w) + 40;
    const y2 = Math.max(b.y + b.h, view.y + view.h) + 40;
    mm.setAttribute('viewBox', `${x1} ${y1} ${x2 - x1} ${y2 - y1}`);
    mm.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const frag = document.createDocumentFragment();
    for (const n of nodes) {
      const [w, hh] = this.nodeSize(n.id);
      frag.appendChild(svg('rect', { class: `n${this.state.selection.has(n.id) ? ' s' : ''}`, x: n.pos[0], y: n.pos[1], width: w, height: hh, rx: 6 }));
    }
    frag.appendChild(svg('rect', { class: 'v', x: view.x, y: view.y, width: view.w, height: view.h, 'vector-effect': 'non-scaling-stroke' }));
    mm.replaceChildren(frag);
  }

  private minimapTo(e: PointerEvent) {
    const vb = this.minimap.viewBox.baseVal;
    const r = this.minimap.getBoundingClientRect();
    if (!vb || !r.width) return;
    const scale = Math.max(vb.width / r.width, vb.height / r.height);
    const ox = (r.width - vb.width / scale) / 2;
    const oy = (r.height - vb.height / scale) / 2;
    const gx = vb.x + (e.clientX - r.left - ox) * scale;
    const gy = vb.y + (e.clientY - r.top - oy) * scale;
    const cr = this.canvas.getBoundingClientRect();
    this.pan = { x: cr.width / 2 - gx * this.zoom, y: cr.height / 2 - gy * this.zoom };
    this.applyView();
  }

  /* ----------------------------------------------------------- palette */

  private renderPalette() {
    const q = this.paletteSearch.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    for (const [cat, defs] of this.groupedDefs(q)) {
      frag.appendChild(h('div', { class: 'bpe-cat' }, h('i', { style: `background:${CATEGORY_COLORS[cat] || '#5b5f66'}` }), this.categoryLabel(cat)));
      for (const def of defs) {
        const item = h(
          'div',
          {
            class: 'bpe-pitem',
            draggable: 'true',
            title: this.nodeDesc(def),
            'data-type': def.type,
            onclick: () => this.addNodeAtCenter(def.type),
            ondragstart: (e: Event) => {
              const dt = (e as DragEvent).dataTransfer;
              dt?.setData('application/x-bp-node', def.type);
              dt?.setData('text/plain', def.type);
            },
          },
          this.nodeTitle(def, def.type),
        );
        frag.appendChild(item);
      }
    }
    this.paletteList.replaceChildren(frag);
  }

  /** Definitions matching a query, grouped by category in registry order. */
  groupedDefs(q: string, filter?: (def: NodeDef) => boolean): [string, NodeDef[]][] {
    const groups = new Map<string, NodeDef[]>();
    for (const def of this.registry.list()) {
      if (filter && !filter(def)) continue;
      if (q) {
        const hay = [this.nodeTitle(def, def.type), def.title, def.type, ...(def.keywords || [])].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) continue;
      }
      const list = groups.get(def.category) || [];
      list.push(def);
      groups.set(def.category, list);
    }
    return Array.from(groups.entries());
  }

  addNodeAtCenter(type: string): string {
    const r = this.canvas.getBoundingClientRect();
    const [x, y] = this.toGraph(r.left + r.width / 2 - 80, r.top + r.height / 2 - 40);
    // Do not stack new nodes exactly on top of each other.
    let pos: [number, number] = [snap(x), snap(y)];
    while (this.state.bp.nodes.some((n) => n.pos[0] === pos[0] && n.pos[1] === pos[1])) pos = [pos[0] + 24, pos[1] + 24];
    return this.state.addNode(type, pos);
  }

  /* ------------------------------------------------------ node search */

  /**
   * Node search popup at a client point. With `from`, only nodes with a pin compatible with a
   * dragged wire are offered, and the new node is wired to it.
   */
  openSearch(clientX: number, clientY: number, from?: { ref: PinRef; side: 'in' | 'out'; type: string }): void {
    this.search?.close();
    const t = this.t;
    const r = this.canvas.getBoundingClientRect();
    const graphPos = this.toGraph(clientX, clientY);
    const compatible = (def: NodeDef): PinDef | undefined => {
      if (!from) return undefined;
      const ports = this.registry.ports(def.type, defaultProps(def));
      const list = from.side === 'out' ? ports.inputs : ports.outputs;
      return list.find((p) => (from.side === 'out' ? canConnect(from.type as any, p.type) : canConnect(p.type, from.type as any)) && (from.type !== 'exec' || p.type === 'exec'));
    };
    const input = h('input', { type: 'search', placeholder: t('ui.searchBlocks', 'Search blocks'), 'aria-label': t('ui.searchBlocks', 'Search blocks') });
    const list = h('div', { class: 'bpe-search-list', role: 'listbox' });
    const desc = h('div', { class: 'bpe-search-desc' });
    const el = h('div', { class: 'bpe-search' }, input, list, desc);
    let items: HTMLElement[] = [];
    let active = 0;
    const setActive = (i: number) => {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach((it, k) => it.classList.toggle('is-active', k === active));
      items[active].scrollIntoView?.({ block: 'nearest' });
      const def = this.registry.get(items[active].dataset.type!);
      desc.textContent = def ? this.nodeDesc(def) : '';
    };
    const choose = (type: string) => {
      close();
      const id = this.state.addNode(type, [graphPos[0], graphPos[1] - 20]);
      if (from) {
        const def = this.registry.get(type)!;
        const pin = compatible(def);
        if (pin) {
          if (from.side === 'out') this.state.connect(from.ref, [id, pin.id]);
          else this.state.connect([id, pin.id], from.ref);
        }
      }
      this.canvas.focus({ preventScroll: true });
    };
    const render = () => {
      const frag = document.createDocumentFragment();
      items = [];
      for (const [cat, defs] of this.groupedDefs(input.value.trim().toLowerCase(), from ? (d) => !!compatible(d) : undefined)) {
        frag.appendChild(h('div', { class: 'bpe-cat' }, h('i', { style: `background:${CATEGORY_COLORS[cat] || '#5b5f66'}` }), this.categoryLabel(cat)));
        for (const def of defs) {
          const it = h('div', { class: 'bpe-pitem', role: 'option', 'data-type': def.type, onmousedown: (e: Event) => e.preventDefault(), onclick: () => choose(def.type) }, this.nodeTitle(def, def.type));
          items.push(it);
          frag.appendChild(it);
        }
      }
      list.replaceChildren(frag);
      setActive(0);
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') (e.preventDefault(), setActive(active + 1));
      else if (e.key === 'ArrowUp') (e.preventDefault(), setActive(active - 1));
      else if (e.key === 'Enter') (e.preventDefault(), items[active] && choose(items[active].dataset.type!));
      else if (e.key === 'Escape') close();
    });
    const onDown = (e: Event) => {
      if (!el.contains(e.target as Node)) close();
    };
    const close = () => {
      document.removeEventListener('pointerdown', onDown, true);
      el.remove();
      this.overlay.replaceChildren();
      if (this.search?.el === el) this.search = null;
    };
    document.addEventListener('pointerdown', onDown, true);
    el.style.left = `${clamp(clientX - r.left, 0, Math.max(0, r.width - 290))}px`;
    el.style.top = `${clamp(clientY - r.top, 0, Math.max(0, r.height - 370))}px`;
    this.canvas.appendChild(el);
    this.search = { el, close };
    render();
    input.focus();
  }

  /* ------------------------------------------------------ interactions */

  private bindCanvas() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => this.cancelDrag());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => {
      const tg = e.target as HTMLElement;
      if (!tg.closest('.bpe-node, .bpe-comment-head, .bpe-search, .bpe-minimap')) this.openSearch(e.clientX, e.clientY);
    });
    c.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-bp-node')) e.preventDefault();
    });
    c.addEventListener('drop', (e) => {
      const type = e.dataTransfer?.getData('application/x-bp-node');
      if (!type || !this.registry.has(type)) return;
      e.preventDefault();
      const [x, y] = this.toGraph(e.clientX, e.clientY);
      this.state.addNode(type, [x - 20, y - 14]);
      c.focus({ preventScroll: true });
    });
    this.minimap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.minimapTo(e);
      const move = (ev: PointerEvent) => this.minimapTo(ev);
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    this.codeView.addEventListener('click', (e) => {
      const line = (e.target as HTMLElement).closest<HTMLElement>('.bpe-ln.is-node');
      if (line?.dataset.node) this.focusNode(line.dataset.node);
    });
  }

  private onDown(e: PointerEvent) {
    const tg = e.target as HTMLElement;
    if (tg.closest('.bpe-search, .bpe-minimap')) return;
    if (tg.closest('input, textarea, select, button')) return;
    this.search?.close();
    this.canvas.focus({ preventScroll: true });
    const dot = tg.closest<HTMLElement>('.bpe-dot');
    const pinEl = dot?.closest<HTMLElement>('.bpe-pin');
    if (pinEl && e.button === 0) {
      e.preventDefault();
      const ref: PinRef = [pinEl.dataset.node!, pinEl.dataset.pin!];
      const side = pinEl.dataset.side as 'in' | 'out';
      if (e.altKey) {
        this.state.disconnect(ref, side);
        return;
      }
      // Dragging from a connected data input picks its wire up (as in UE).
      if (side === 'in' && pinEl.dataset.type !== 'exec') {
        const l = this.state.bp.links.find((x) => x.to[0] === ref[0] && x.to[1] === ref[1]);
        if (l) {
          this.state.removeLink(l);
          const from = this.state.node(l.from[0]);
          const type = (from && this.registry.pin(from, 'out', l.from[1])?.type) || 'any';
          this.startWire(l.from, 'out', type, e);
          return;
        }
      }
      this.startWire(ref, side, pinEl.dataset.type || 'any', e);
      return;
    }
    const resize = tg.closest<HTMLElement>('.bpe-comment-resize');
    if (resize && e.button === 0) {
      const id = resize.closest<HTMLElement>('.bpe-comment')!.dataset.id!;
      const cm = this.state.comment(id)!;
      this.state.begin();
      this.drag = { kind: 'resize', id, x: e.clientX, y: e.clientY, w: cm.size[0], h: cm.size[1] };
      this.capture(e);
      return;
    }
    const nodeEl = tg.closest<HTMLElement>('.bpe-node');
    const commentHead = tg.closest<HTMLElement>('.bpe-comment-head');
    if ((nodeEl || commentHead) && (e.button === 0 || e.button === 2)) {
      e.preventDefault();
      let ids: string[];
      let comments: string[] = [];
      if (nodeEl) {
        const id = nodeEl.dataset.id!;
        if (e.shiftKey || e.ctrlKey || e.metaKey) this.state.toggleSelect(id);
        else if (!this.state.selection.has(id)) this.state.select([id]);
        ids = Array.from(this.state.selection);
        comments = Array.from(this.state.selectedComments);
      } else {
        const id = commentHead!.closest<HTMLElement>('.bpe-comment')!.dataset.id!;
        if (!this.state.selectedComments.has(id)) this.state.select([], { comments: [id] });
        comments = Array.from(this.state.selectedComments);
        ids = Array.from(new Set([...this.state.selection, ...comments.flatMap((cid) => this.nodesInComment(cid))]));
      }
      if (e.button === 2) return;
      this.state.begin();
      this.drag = { kind: 'nodes', ids, comments, x: e.clientX, y: e.clientY, moved: false };
      this.capture(e);
      return;
    }
    const hit = tg.closest('.bpe-wire-hit') as SVGPathElement | null;
    if (hit && e.button === 0) {
      const link = this.state.bp.links[Number(hit.getAttribute('data-link'))];
      if (link) {
        if (e.altKey) this.state.removeLink(link);
        else this.state.selectLink(link);
      }
      return;
    }
    // Empty canvas.
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, moved: false, button: e.button };
      this.canvas.classList.add('is-panning');
      this.capture(e);
      return;
    }
    if (e.button === 0) {
      const r = this.canvas.getBoundingClientRect();
      this.drag = { kind: 'marquee', x0: e.clientX - r.left, y0: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top, additive: e.shiftKey || e.ctrlKey || e.metaKey };
      this.capture(e);
    }
  }

  private capture(e: PointerEvent) {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
  }

  private startWire(ref: PinRef, side: 'in' | 'out', type: string, e: PointerEvent) {
    this.drag = { kind: 'wire', ref, side, type, x: e.clientX, y: e.clientY };
    this.capture(e);
    // Dim pins that cannot take this wire.
    this.nodesLayer.querySelectorAll<HTMLElement>('.bpe-pin').forEach((p) => {
      const ok =
        p.dataset.side !== side &&
        p.dataset.node !== ref[0] &&
        (side === 'out' ? canConnect(type as any, p.dataset.type as any) : canConnect(p.dataset.type as any, type as any));
      p.classList.toggle('is-bad', !ok);
    });
    this.drawTempWire(e.clientX, e.clientY);
  }

  private drawTempWire(cx: number, cy: number) {
    const d = this.drag;
    if (d?.kind !== 'wire') return;
    const p = this.pinPos(d.ref, d.side);
    if (!p) return;
    const m = this.toGraph(cx, cy);
    const path = d.side === 'out' ? wirePath(p, m) : wirePath(m, p);
    this.overlay.replaceChildren(svg('path', { class: 'bpe-temp', d: path, stroke: PIN_COLORS[d.type] || PIN_COLORS.any }));
  }

  private onMove(e: PointerEvent) {
    this.mouse = { x: e.clientX, y: e.clientY };
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'nodes') {
      const dx = (e.clientX - d.x) / this.zoom;
      const dy = (e.clientY - d.y) / this.zoom;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      for (const cid of d.comments) {
        const cm = this.state.comment(cid);
        if (cm) cm.pos = [cm.pos[0] + dx, cm.pos[1] + dy];
      }
      this.state.moveBy(d.ids, dx, dy);
    } else if (d.kind === 'pan') {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      this.pan = { x: d.px + dx, y: d.py + dy };
      this.applyView();
    } else if (d.kind === 'marquee') {
      const r = this.canvas.getBoundingClientRect();
      d.x = e.clientX - r.left;
      d.y = e.clientY - r.top;
      Object.assign(this.marquee.style, {
        left: `${Math.min(d.x0, d.x)}px`,
        top: `${Math.min(d.y0, d.y)}px`,
        width: `${Math.abs(d.x - d.x0)}px`,
        height: `${Math.abs(d.y - d.y0)}px`,
      });
      this.marquee.hidden = false;
    } else if (d.kind === 'wire') {
      this.drawTempWire(e.clientX, e.clientY);
      this.nodesLayer.querySelectorAll('.bpe-pin.is-target').forEach((p) => p.classList.remove('is-target'));
      this.pinAt(e.clientX, e.clientY)?.classList.add('is-target');
    } else if (d.kind === 'resize') {
      const w = Math.max(120, d.w + (e.clientX - d.x) / this.zoom);
      const hh = Math.max(60, d.h + (e.clientY - d.y) / this.zoom);
      this.state.updateComment(d.id, { size: [w, hh] }, { history: false });
    }
  }

  /** The pin element under a client point (a whole pin row counts, not just its dot). */
  private pinAt(x: number, y: number): HTMLElement | null {
    const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    const pin = (el as HTMLElement | null)?.closest?.<HTMLElement>('.bpe-pin');
    return pin && !pin.classList.contains('is-bad') ? pin : null;
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    this.canvas.classList.remove('is-panning');
    if (!d) return;
    if (d.kind === 'nodes') {
      if (d.moved) {
        this.state.snapNodes(d.ids);
        for (const cid of d.comments) {
          const cm = this.state.comment(cid);
          if (cm) cm.pos = [snap(cm.pos[0]), snap(cm.pos[1])];
        }
      }
      this.state.end();
    } else if (d.kind === 'resize') {
      const cm = this.state.comment(d.id);
      if (cm) cm.size = [snap(cm.size[0]), snap(cm.size[1])];
      this.state.end();
    } else if (d.kind === 'pan') {
      if (!d.moved && d.button === 2) this.openSearch(e.clientX, e.clientY);
    } else if (d.kind === 'marquee') {
      this.marquee.hidden = true;
      const r = this.canvas.getBoundingClientRect();
      if (Math.abs(d.x - d.x0) < 4 && Math.abs(d.y - d.y0) < 4) {
        if (!d.additive) this.state.clearSelection();
        return;
      }
      const [ax, ay] = this.toGraph(r.left + Math.min(d.x0, d.x), r.top + Math.min(d.y0, d.y));
      const [bx, by] = this.toGraph(r.left + Math.max(d.x0, d.x), r.top + Math.max(d.y0, d.y));
      const hit = this.state.bp.nodes
        .filter((n) => {
          const [w, hh] = this.nodeSize(n.id);
          return n.pos[0] < bx && n.pos[0] + w > ax && n.pos[1] < by && n.pos[1] + hh > ay;
        })
        .map((n) => n.id);
      this.state.select(d.additive ? [...this.state.selection, ...hit] : hit);
    } else if (d.kind === 'wire') {
      this.overlay.replaceChildren();
      this.nodesLayer.querySelectorAll('.bpe-pin').forEach((p) => p.classList.remove('is-bad', 'is-target'));
      const target = this.pinAt(e.clientX, e.clientY);
      if (target) {
        const ref: PinRef = [target.dataset.node!, target.dataset.pin!];
        if (d.side === 'out') this.state.connect(d.ref, ref);
        else this.state.connect(ref, d.ref);
      } else if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 8) {
        const over = document.elementFromPoint?.(e.clientX, e.clientY);
        if (!over || (this.canvas.contains(over) && !(over as Element).closest?.('.bpe-minimap'))) this.openSearch(e.clientX, e.clientY, { ref: d.ref, side: d.side, type: d.type });
      }
    }
  }

  private cancelDrag() {
    if (this.drag?.kind === 'nodes' || this.drag?.kind === 'resize') this.state.end();
    this.drag = null;
    this.marquee.hidden = true;
    this.overlay.replaceChildren();
    this.canvas.classList.remove('is-panning');
  }

  private onWheel(e: WheelEvent) {
    if ((e.target as HTMLElement).closest('.bpe-search')) return;
    e.preventDefault();
    if (e.ctrlKey || !e.shiftKey) this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
    else {
      this.pan.x -= e.deltaY;
      this.applyView();
    }
  }

  private nodesInComment(id: string): string[] {
    const c = this.state.comment(id);
    if (!c) return [];
    return this.state.bp.nodes
      .filter((n) => {
        const [w, hh] = this.nodeSize(n.id);
        return n.pos[0] >= c.pos[0] && n.pos[1] >= c.pos[1] && n.pos[0] + w <= c.pos[0] + c.size[0] && n.pos[1] + hh <= c.pos[1] + c.size[1];
      })
      .map((n) => n.id);
  }

  /** A comment box around the selected nodes (or in the middle of the view). */
  commentSelection(): string {
    const b = this.state.bounds(this.state.selection.size ? this.state.selection : [], this.nodeSize);
    if (b) return this.state.addComment([b.x - 24, b.y - 48], [b.w + 48, b.h + 72], this.t('ui.commentText', 'Comment'));
    const r = this.canvas.getBoundingClientRect();
    const [x, y] = this.toGraph(r.left + r.width / 2 - 160, r.top + r.height / 2 - 100);
    return this.state.addComment([x, y], [320, 200], this.t('ui.commentText', 'Comment'));
  }

  /* ---------------------------------------------------------- keyboard */

  private bindKeys() {
    this.root.addEventListener('keydown', (e) => {
      // Nothing reaches the host page (GrapesJS keymaps would act on the canvas behind).
      e.stopPropagation();
      const tg = e.target as HTMLElement;
      const typing = tg.closest('input, textarea, select, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (typing) return;
      if (this.tab !== 'graph') {
        if (mod && (k === 'z' || k === 'y')) (e.preventDefault(), k === 'y' || e.shiftKey ? this.state.redo() : this.state.undo());
        return;
      }
      if (k === ' ') {
        this.spaceDown = true;
        e.preventDefault();
        return;
      }
      if (mod && k === 'z') return e.preventDefault(), e.shiftKey ? this.state.redo() : this.state.undo(), undefined;
      if (mod && k === 'y') return e.preventDefault(), this.state.redo(), undefined;
      if (mod && k === 'a') return e.preventDefault(), this.state.selectAll(), undefined;
      if (mod && k === 'c') return e.preventDefault(), this.copy(), undefined;
      if (mod && k === 'x') return e.preventDefault(), this.copy() && this.state.deleteSelection(), undefined;
      if (mod && k === 'v') return e.preventDefault(), this.paste(), undefined;
      if (mod && k === 'd') {
        e.preventDefault();
        const clip = this.state.copy();
        if (clip) {
          const b = this.state.bounds(this.state.selection, this.nodeSize);
          this.state.paste(clip, b ? [b.x + 32, b.y + 32] : [0, 0]);
        }
        return;
      }
      if (mod) return;
      if (k === 'delete' || k === 'backspace') return e.preventDefault(), this.state.deleteSelection(), undefined;
      if (k === 'f') return this.fit(this.state.selection.size > 0);
      if (k === 'c') return void this.commentSelection();
      if (k === 'tab' || k === 'a') {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        const p = this.mouse && this.canvas.contains(document.elementFromPoint?.(this.mouse.x, this.mouse.y) || null) ? this.mouse : { x: r.left + r.width / 2, y: r.top + r.height / 3 };
        return this.openSearch(p.x, p.y);
      }
      if (k === 'escape') return this.state.clearSelection();
    });
    this.root.addEventListener('keyup', (e) => {
      e.stopPropagation();
      if (e.key === ' ') this.spaceDown = false;
    });
    this.root.addEventListener('keypress', (e) => e.stopPropagation());
  }

  copy(): boolean {
    const clip = this.state.copy();
    if (!clip) return false;
    memoryClipboard = clip;
    const key = this.opts.clipboardKey ?? 'bp-clipboard';
    if (key) {
      try {
        localStorage.setItem(key, JSON.stringify(clip));
      } catch {
        /* quota / privacy mode */
      }
    }
    return true;
  }

  paste(): string[] {
    let clip = memoryClipboard;
    const key = this.opts.clipboardKey ?? 'bp-clipboard';
    if (key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) clip = JSON.parse(raw);
      } catch {
        /* ignore */
      }
    }
    if (!clip) return [];
    const r = this.canvas.getBoundingClientRect();
    const p = this.mouse || { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return this.state.paste(clip, this.toGraph(p.x, p.y));
  }

  /* --------------------------------------------------- options (panels) */

  get options(): GraphEditorOptions {
    return this.opts;
  }

  /** A link's endpoints for the details panel. */
  describeLink(l: Link): string {
    const a = this.state.node(l.from[0]);
    const b = this.state.node(l.to[0]);
    return `${a ? this.nodeTitle(this.registry.get(a.type), a.type) : l.from[0]} → ${b ? this.nodeTitle(this.registry.get(b.type), b.type) : l.to[0]}`;
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** Bezier wire from an output point to an input point. */
export function wirePath(a: [number, number], b: [number, number]): string {
  const dx = Math.max(40, Math.abs(b[0] - a[0]) / 2);
  return `M${a[0]} ${a[1]} C${a[0] + dx} ${a[1]} ${b[0] - dx} ${b[1]} ${b[0]} ${b[1]}`;
}
