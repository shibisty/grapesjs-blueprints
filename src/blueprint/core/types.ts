/**
 * Blueprint model. Everything here is plain JSON-serialisable data; behaviour lives in node
 * definitions (see `NodeDef`), which the compiler turns into JavaScript.
 */

/** Pin types. `exec` pins carry the order of execution, the rest carry values. */
export type PinType = 'exec' | 'any' | 'string' | 'number' | 'boolean' | 'element' | 'elements' | 'event' | 'object';

export const DATA_PIN_TYPES: Exclude<PinType, 'exec'>[] = [
  'any',
  'string',
  'number',
  'boolean',
  'element',
  'elements',
  'event',
  'object',
];

export interface PinDef {
  id: string;
  type: PinType;
  /** English label; the UI translates `bp.pin.<id>` when present. */
  label?: string;
  /** Literal used when an input is not connected (also editable inline on the node). */
  default?: unknown;
  /** Input must be connected or have a non-empty literal. */
  required?: boolean;
  /** Input: hide the inline literal editor (value only comes from a wire). */
  noLiteral?: boolean;
}

export type PropType = 'string' | 'number' | 'boolean' | 'select' | 'selector' | 'code' | 'variable' | 'pins';

/** A node setting that is not a pin (event name, operator, code…). */
export interface PropDef {
  id: string;
  type: PropType;
  label?: string;
  default?: unknown;
  /** For `select`. */
  options?: { value: string; label?: string }[];
  required?: boolean;
}

export type NodeCategory = 'events' | 'flow' | 'dom' | 'data' | 'variables' | 'math' | 'logic' | 'code' | 'debug' | string;

export interface Ports {
  inputs: PinDef[];
  outputs: PinDef[];
}

/** Compiler API passed to `NodeDef.compile`. */
export interface CompileContext {
  /** Node being compiled. */
  readonly node: NodeInstance;
  /** Node setting (`props[id]`, falling back to the PropDef / PinDef default). */
  prop<T = unknown>(id: string): T;
  /** JS expression of an input pin: the wire's source, or the literal. */
  in(pinId: string): string;
  /** Whether an input pin is connected. */
  linked(pinId: string): boolean;
  /** JS statements that run what is connected to an exec output (empty string if nothing). */
  next(pinId: string): string;
  /**
   * Name of the variable holding a data output of an exec node. Assign it before calling
   * `next()`: `${c.out('result')} = …;`.
   */
  out(pinId: string): string;
  /**
   * `<output var> = expr;` — or an empty string when nothing reads that output, so unused
   * values are not kept. Prefer it to `out()` for simple assignments.
   */
  set(pinId: string, expr: string): string;
  /** Whether an output pin is connected. */
  used(pinId: string): boolean;
  /** Name of a runtime helper; the helper's code is added to the output once. */
  h(name: string): string;
  /** JS string literal. */
  lit(value: unknown): string;
  /** A fresh local identifier (unique in the blueprint). */
  local(hint?: string): string;
  /** Variable name of a blueprint variable. */
  variable(id: string): string;
  /** Root of the blueprint (`document` for global ones, the element for component ones). */
  readonly root: string;
  /** Document of the root. */
  readonly doc: string;
  /** Window of the root. */
  readonly win: string;
  /** Report a problem found while compiling (shown in the editor's error list). */
  warn(message: string): void;
  /**
   * Blueprint-level variable that keeps its value between runs of the node (timers,
   * "done" flags). `init` is a JS expression.
   */
  state(hint: string, init?: string): string;
  /** Exec input the node is entered through (nodes with several exec inputs). */
  readonly entry: string;
}

export interface CompileResult {
  /** Statements (exec nodes / events). */
  code?: string;
  /** Expressions of data outputs (pure nodes). */
  outputs?: Record<string, string>;
}

export interface NodeDef {
  type: string;
  category: NodeCategory;
  /** English title (the UI translates `bp.node.<type>` when present). */
  title: string;
  description?: string;
  /** Static pins, or pins computed from the node's props (dynamic pins). */
  ports: Ports | ((props: Record<string, unknown>) => Ports);
  props?: PropDef[];
  /**
   * Event node: no exec input, starts a chain. Its `compile` returns code that sets up the
   * listener and runs `c.next(...)` inside it.
   */
  event?: boolean;
  /** Event nodes are set up in ascending `order` (default 0); "on start" uses 100 to run last. */
  order?: number;
  /** Runtime helpers the node always needs (also available through `c.h`). */
  helpers?: string[];
  /** Search keywords for the palette. */
  keywords?: string[];
  /** Node colour in the editor (CSS colour). */
  color?: string;
  /**
   * Turns the node into code. Pure nodes (no exec pins) return `{ outputs }` — expressions,
   * exec nodes return `{ code }` (or a string).
   */
  compile(c: CompileContext): CompileResult | string;
}

export interface NodeInstance {
  id: string;
  type: string;
  /** Position on the graph, `[x, y]`. */
  pos: [number, number];
  props?: Record<string, unknown>;
  /** Collapsed in the editor. */
  collapsed?: boolean;
  /** Disabled nodes are compiled as pass-through (exec continues to the first exec output). */
  disabled?: boolean;
}

/** `[nodeId, pinId]` */
export type PinRef = [string, string];

export interface Link {
  from: PinRef;
  to: PinRef;
}

export interface Variable {
  id: string;
  name: string;
  type: Exclude<PinType, 'exec'>;
  default?: unknown;
}

export interface GraphComment {
  id: string;
  text: string;
  pos: [number, number];
  size: [number, number];
  color?: string;
}

export type BlueprintKind = 'global' | 'template' | 'component';

export interface TemplateTarget {
  /** Ids of `editor.Pages` the blueprint is exported with (empty = every page). */
  pages?: string[];
  /** Runtime condition: the blueprint runs only when the document has a match. */
  when?: string;
}

export interface ComponentSpec {
  /** GrapesJS component type created by the blueprint. */
  type: string;
  /** Block label in the Block Manager. */
  label?: string;
  /** Markup of a new instance. */
  html?: string;
  css?: string;
  /** Parameters shown as traits, passed to the script (`ctx.params`). */
  params?: { id: string; label?: string; type: 'string' | 'number' | 'boolean' | 'select'; default?: unknown; options?: string[] }[];
}

export interface Blueprint {
  schema: number;
  id: string;
  name: string;
  kind: BlueprintKind;
  enabled: boolean;
  description?: string;
  target?: TemplateTarget;
  component?: ComponentSpec | null;
  /** Ids of CDN libraries the blueprint needs. */
  libraries?: string[];
  variables: Variable[];
  nodes: NodeInstance[];
  links: Link[];
  comments?: GraphComment[];
  /** Free-form data of the editor (viewport…). */
  editor?: { pan?: [number, number]; zoom?: number };
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  /** Stable code, e.g. `unknown-node`, `required-input`. */
  code: string;
  /** English message (UIs translate `diag.<code>` with `args`). */
  message: string;
  /** Values for the `%s` of a translated message, in order. */
  args?: string[];
  nodeId?: string;
  pinId?: string;
  link?: Link;
}
