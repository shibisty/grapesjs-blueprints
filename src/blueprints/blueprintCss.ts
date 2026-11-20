/**
 * Static CSS of a blueprint: the `css.rule` nodes ("Apply to selector") and the value
 * nodes feeding them are compiled and run in the editor, like a shader graph baked to a
 * texture. The result is CSS text, put into the page CSS as rules of the blueprint.
 */
import { HELPERS, NodeRegistry, buildStandalone, resolveHelpers, type Blueprint, type NodeDef, type NodeInstance } from 'blueprintsjs';
import { RULE_NODE, cssProperty, styleObject, withState } from './cssNodes';

const COLLECT = '__css.collect';

export interface StaticRule {
  nodeId: string;
  selector: string;
  media: string;
  style: Record<string, string>;
}

export interface StaticCss {
  rules: StaticRule[];
  css: string;
  /** Rules that could not be worked out (the node and why). */
  problems: { nodeId: string; message: string }[];
}

const EMPTY: StaticCss = { rules: [], css: '', problems: [] };

/** The rule node as an event that hands its rule to `ctx.__css`. */
function collectDef(rule: NodeDef): NodeDef {
  return {
    type: COLLECT,
    category: 'style',
    title: 'collect',
    event: true,
    props: rule.props,
    ports: rule.ports,
    compile: (c) => {
      const { inputs } = typeof rule.ports === 'function' ? rule.ports((c.node.props || {}) as Record<string, unknown>) : rule.ports;
      const sel = withState(String(c.prop('selector') ?? '').trim(), String(c.prop('state') ?? ''));
      return `ctx.__css.push({ nodeId: ${c.lit(c.node.id)}, selector: ${c.lit(sel)}, media: ${c.lit(String(c.prop('media') ?? '').trim())}, style: ${styleObject(c, inputs)} });`;
    },
  };
}

const clean = (v: unknown): string | null => {
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return null;
  const s = String(v).trim();
  return s && !/^(undefined|null|NaN)$/.test(s) ? s : null;
};

/** Rules → CSS text, `@media` blocks around their rules. */
export function staticCssText(rules: StaticRule[]): string {
  const out: string[] = [];
  for (const r of rules) {
    const decl = Object.entries(r.style).map(([k, v]) => `  ${k}: ${v};`);
    if (!decl.length) continue;
    const block = `${r.selector} {\n${decl.join('\n')}\n}`;
    out.push(r.media ? `@media ${r.media} {\n${block.replace(/^/gm, '  ')}\n}` : block);
  }
  return out.length ? `${out.join('\n\n')}\n` : '';
}

/**
 * Works out the static rules of a blueprint. `root` is what the value nodes see as the
 * page (the canvas document: "Get style" reads the canvas).
 */
export function staticCss(bp: Blueprint, registry: NodeRegistry, root: unknown): StaticCss {
  const ruleDef = registry.get(RULE_NODE);
  const rules = (bp.nodes || []).filter((n) => n.type === RULE_NODE && !n.disabled);
  if (!ruleDef || !rules.length) return EMPTY;
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const problems: StaticCss['problems'] = [];
  const keep = new Set<string>();
  for (const r of rules) {
    if (!String(r.props?.selector ?? '').trim()) {
      problems.push({ nodeId: r.id, message: 'No selector' });
      continue;
    }
    // Everything the rule reads must be a value node (no actions, no events).
    const seen = new Set<string>([r.id]);
    const queue = [r.id];
    let bad: NodeInstance | null = null;
    while (queue.length && !bad) {
      const id = queue.shift()!;
      for (const l of bp.links) {
        if (l.to[0] !== id || seen.has(l.from[0])) continue;
        const src = byId.get(l.from[0]);
        if (!src) continue;
        if (!registry.isPure(src) || src.disabled) {
          bad = src;
          break;
        }
        seen.add(src.id);
        queue.push(src.id);
      }
    }
    if (bad) {
      problems.push({ nodeId: r.id, message: `Reads "${registry.get(bad.type)?.title || bad.type}", which only has a value while the page runs: use "Apply styles" in its chain instead` });
      continue;
    }
    seen.forEach((id) => keep.add(id));
  }
  if (!keep.size) return { ...EMPTY, problems };
  const reg = new NodeRegistry([...registry.list(), collectDef(ruleDef)]);
  const sub: Blueprint = {
    ...bp,
    kind: 'global',
    enabled: true,
    nodes: bp.nodes.filter((n) => keep.has(n.id)).map((n) => (n.type === RULE_NODE ? { ...n, type: COLLECT } : n)),
    links: bp.links.filter((l) => keep.has(l.from[0]) && keep.has(l.to[0])),
  };
  const out: StaticRule[] = [];
  try {
    const compiled = buildStandalone(sub, reg, { comments: false });
    const helpers = resolveHelpers(compiled.helpers || [])
      .map((n) => (HELPERS as Record<string, { code: string }>)[n]?.code || '')
      .join('\n');
    const ctx: { __css: StaticRule[] } = { __css: [] };
    // eslint-disable-next-line no-new-func
    const run = new Function(`${helpers}\nreturn ${compiled.code};`)() as (root: unknown, ctx: unknown) => unknown;
    const dispose = run(root, ctx);
    if (typeof dispose === 'function') dispose();
    for (const r of ctx.__css) {
      const style: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.style || {})) {
        const s = clean(v);
        if (s != null) style[k] = s;
      }
      out.push({ ...r, style });
    }
  } catch (e) {
    problems.push({ nodeId: rules[0].id, message: `Could not compute: ${(e as Error)?.message || e}` });
  }
  // In the order of the nodes on the graph (top to bottom) — later rules win, like in a file.
  const order = new Map(rules.map((n) => [n.id, n.pos?.[1] ?? 0]));
  out.sort((a, b) => (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0));
  return { rules: out, css: staticCssText(out), problems };
}

export { cssProperty };
