import { NodeRegistry, canConnect, defaultProps } from './registry';
import type { Blueprint, Diagnostic } from './types';

/**
 * Problems the editor shows while the graph is edited (the compiler reports its own too).
 * `checkSelector` validates CSS selectors (default: via `document` when there is one).
 */
export function validateBlueprint(
  bp: Blueprint,
  registry: NodeRegistry,
  options: { checkSelector?: (sel: string) => boolean } = {},
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const check = options.checkSelector ?? defaultSelectorCheck();
  const nodes = new Map(bp.nodes.map((n) => [n.id, n]));
  const vars = new Set((bp.variables || []).map((v) => v.id));
  const connectedIn = new Set<string>();

  for (const l of bp.links) {
    const a = nodes.get(l.from[0]);
    const b = nodes.get(l.to[0]);
    if (!a || !b) {
      out.push({ severity: 'error', code: 'dangling-link', message: 'Wire to a missing node', link: l });
      continue;
    }
    const pa = registry.pin(a, 'out', l.from[1]);
    const pb = registry.pin(b, 'in', l.to[1]);
    if (!pa || !pb) {
      out.push({ severity: 'error', code: 'dangling-pin', message: 'Wire to a missing pin', link: l, nodeId: (pa ? b : a).id });
      continue;
    }
    if (!canConnect(pa.type, pb.type)) {
      out.push({ severity: 'error', code: 'type-mismatch', message: `Cannot connect ${pa.type} to ${pb.type}`, args: [pa.type, pb.type], link: l, nodeId: b.id, pinId: pb.id });
    }
    connectedIn.add(`${b.id}\u0000${pb.id}`);
  }

  let events = 0;
  for (const n of bp.nodes) {
    const def = registry.get(n.type);
    if (!def) {
      out.push({ severity: 'error', code: 'unknown-node', message: `Unknown node type "${n.type}"`, args: [n.type], nodeId: n.id });
      continue;
    }
    if (def.event && !n.disabled) events++;
    const props = { ...defaultProps(def), ...(n.props || {}) };
    for (const p of def.props || []) {
      const v = props[p.id];
      if (p.required && (v == null || String(v).trim() === '')) {
        out.push({ severity: 'error', code: 'required-prop', message: `"${p.label || p.id}" is required`, args: [p.label || p.id], nodeId: n.id, pinId: p.id });
      }
      if (p.type === 'variable' && v && !vars.has(String(v))) {
        out.push({ severity: 'error', code: 'unknown-variable', message: `Unknown variable "${v}"`, args: [String(v)], nodeId: n.id, pinId: p.id });
      }
      if (p.type === 'selector' && typeof v === 'string' && v.trim() && !check(v.trim())) {
        out.push({ severity: 'error', code: 'bad-selector', message: `Invalid selector "${v}"`, args: [String(v)], nodeId: n.id, pinId: p.id });
      }
    }
    for (const pin of registry.ports(n).inputs) {
      if (pin.type === 'exec' || connectedIn.has(`${n.id}\u0000${pin.id}`)) continue;
      const v = props[pin.id];
      if (pin.required && (v == null || String(v).trim() === '' || pin.noLiteral)) {
        out.push({ severity: 'error', code: 'required-input', message: `Input "${pin.label || pin.id}" is not set`, args: [pin.label || pin.id], nodeId: n.id, pinId: pin.id });
      }
      if ((pin.type === 'elements' || pin.type === 'element') && typeof v === 'string' && v.trim() && !check(v.trim())) {
        out.push({ severity: 'error', code: 'bad-selector', message: `Invalid selector "${v}"`, args: [String(v)], nodeId: n.id, pinId: pin.id });
      }
    }
  }
  if (bp.nodes.length && !events) {
    out.push({ severity: 'warning', code: 'no-events', message: 'The blueprint has no event node, so nothing will ever run' });
  }
  return out;
}

function defaultSelectorCheck(): (sel: string) => boolean {
  if (typeof document === 'undefined') return () => true;
  const frag = document.createDocumentFragment();
  return (sel) => {
    try {
      frag.querySelector(sel);
      return true;
    } catch {
      return false;
    }
  };
}
