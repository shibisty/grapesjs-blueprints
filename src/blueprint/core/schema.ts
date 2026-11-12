import type { Blueprint, BlueprintKind, Link, NodeInstance, Variable } from './types';

export const SCHEMA_VERSION = 1;

let counter = 0;
/** Short random id with a prefix (`bp_k3x9a1`). */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`;
}

export function createBlueprint(init: Partial<Blueprint> & { name: string; kind?: BlueprintKind }): Blueprint {
  return normalizeBlueprint({ ...init, id: init.id || uid('bp') });
}

const KINDS: BlueprintKind[] = ['global', 'template', 'component'];

/**
 * Brings any stored blueprint to the current schema and drops what cannot be valid
 * (unknown kind → global, links without both ends, non-numeric positions…).
 * Migrations from older schemas go here: `if (raw.schema < 2) …`.
 */
export function normalizeBlueprint(raw: unknown): Blueprint {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const nodes: NodeInstance[] = (Array.isArray(r.nodes) ? r.nodes : [])
    .filter((n: any) => n && typeof n.id === 'string' && n.id && typeof n.type === 'string')
    .map((n: any) => {
      const out: NodeInstance = { id: n.id, type: n.type, pos: [num(n.pos?.[0]), num(n.pos?.[1])] };
      if (n.props && typeof n.props === 'object') out.props = JSON.parse(JSON.stringify(n.props));
      if (n.collapsed) out.collapsed = true;
      if (n.disabled) out.disabled = true;
      return out;
    });
  const ids = new Set(nodes.map((n) => n.id));
  const links: Link[] = (Array.isArray(r.links) ? r.links : [])
    .filter((l: any) => validRef(l?.from) && validRef(l?.to) && ids.has(l.from[0]) && ids.has(l.to[0]))
    .map((l: any) => ({ from: [l.from[0], l.from[1]], to: [l.to[0], l.to[1]] }));
  const variables: Variable[] = (Array.isArray(r.variables) ? r.variables : [])
    .filter((v: any) => v && typeof v.id === 'string' && v.id)
    .map((v: any) => ({ id: v.id, name: String(v.name || v.id), type: v.type || 'any', ...(v.default !== undefined ? { default: v.default } : {}) }));
  const bp: Blueprint = {
    schema: SCHEMA_VERSION,
    id: typeof r.id === 'string' && r.id ? r.id : uid('bp'),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Blueprint',
    kind: KINDS.includes(r.kind) ? r.kind : 'global',
    enabled: r.enabled !== false,
    variables,
    nodes,
    links,
  };
  if (typeof r.description === 'string' && r.description) bp.description = r.description;
  if (r.target && typeof r.target === 'object') {
    bp.target = {};
    if (Array.isArray(r.target.pages)) bp.target.pages = r.target.pages.filter((x: unknown) => typeof x === 'string');
    if (typeof r.target.when === 'string' && r.target.when.trim()) bp.target.when = r.target.when.trim();
  }
  if (r.component && typeof r.component === 'object') bp.component = JSON.parse(JSON.stringify(r.component));
  if (Array.isArray(r.libraries)) bp.libraries = r.libraries.filter((x: unknown) => typeof x === 'string');
  if (Array.isArray(r.comments)) bp.comments = JSON.parse(JSON.stringify(r.comments));
  if (r.editor && typeof r.editor === 'object') bp.editor = JSON.parse(JSON.stringify(r.editor));
  return bp;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function validRef(r: unknown): r is [string, string] {
  return Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string' && !!r[0] && !!r[1];
}
