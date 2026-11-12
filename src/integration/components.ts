import type { Editor } from 'grapesjs';
import { buildStandalone, type Blueprint, type ComponentSpec, type NodeRegistry } from '../blueprint';
import type { ScriptsManager } from '../core/ScriptsManager';

export const BLOCK_PREFIX = 'bp:';
export const TYPE_ATTR = 'data-bp';

const MEDIA = '<svg viewBox="0 0 24 24" style="width:40px;height:40px"><path fill="currentColor" d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z"/></svg>';

function traitType(t: string): string {
  return t === 'boolean' ? 'checkbox' : t === 'number' ? 'number' : t === 'select' ? 'select' : 'text';
}

function defaultFor(p: NonNullable<ComponentSpec['params']>[number]): unknown {
  if (p.default !== undefined && p.default !== '') return p.type === 'number' ? Number(p.default) || 0 : p.type === 'boolean' ? p.default === true || p.default === 'true' : p.default;
  return p.type === 'number' ? 0 : p.type === 'boolean' ? false : p.type === 'select' ? p.options?.[0] ?? '' : '';
}

/**
 * The `script-export` of a component type: GrapesJS puts it into the exported HTML (not into the
 * canvas) and calls it with the instance element as `this` and its parameters as `props`.
 */
export function componentScript(bp: Blueprint, registry: NodeRegistry): string {
  const run = buildStandalone(bp, registry, { comments: false }).code;
  return `function (props) {\n  if (this.__bpStop) return;\n  this.__bpStop = (${run})(this, { params: props || {} });\n}`;
}

/** All component models of a type in every page. */
export function componentInstances(editor: Editor, type: string): any[] {
  const roots: any[] = [];
  try {
    const pages = (editor as any).Pages?.getAll?.() || [];
    pages.forEach((p: any) => p.getMainComponent && roots.push(p.getMainComponent()));
  } catch {
    /* no pages module */
  }
  if (!roots.length && editor.getWrapper()) roots.push(editor.getWrapper());
  return roots.flatMap((r) => r.find(`[${TYPE_ATTR}="${type}"]`)).filter((m: any) => m.get('type') === type);
}

/**
 * Keeps GrapesJS component types and blocks in step with the component scripts: one type and
 * one block per script; parameters become traits; instances get the new script on change.
 */
export class ComponentBlueprints {
  private registered = new Map<string, string>(); // type → signature

  constructor(
    private readonly editor: Editor,
    private readonly manager: ScriptsManager,
    private readonly registry: NodeRegistry,
    private readonly category: () => string,
  ) {}

  sync(): void {
    const bps = this.manager.list('component').filter((b) => b.component?.type);
    const live = new Set<string>();
    for (const bp of bps) {
      const spec = bp.component!;
      live.add(spec.type);
      const script = bp.enabled ? componentScript(bp, this.registry) : '';
      const sig = JSON.stringify([spec, script, bp.name]);
      if (this.registered.get(spec.type) === sig) continue;
      this.register(bp, spec, script);
      this.registered.set(spec.type, sig);
    }
    // Scripts deleted (or turned into another kind): their blocks go, the types stay so that
    // existing instances keep rendering.
    for (const type of Array.from(this.registered.keys())) {
      if (live.has(type)) continue;
      this.registered.delete(type);
      this.editor.Blocks.remove(`${BLOCK_PREFIX}${type}`);
      for (const m of componentInstances(this.editor, type)) m.set({ 'script-export': '', 'script-props': [] });
    }
  }

  private register(bp: Blueprint, spec: ComponentSpec, script: string) {
    const params = spec.params || [];
    const dc = this.editor.DomComponents as any;
    const type = spec.type;
    const defaults: Record<string, unknown> = {
      tagName: 'div',
      name: spec.label || bp.name,
      attributes: { [TYPE_ATTR]: type },
      components: spec.html || '',
      traits: [
        ...params.map((p) => ({
          name: p.id,
          label: p.label || p.id,
          type: traitType(p.type),
          changeProp: true,
          ...(p.type === 'select' ? { options: (p.options || []).map((o) => ({ id: o, name: o })) } : {}),
        })),
      ],
      'script-props': params.map((p) => p.id),
      'script-export': script,
    };
    if (spec.css) defaults.styles = spec.css;
    for (const p of params) defaults[p.id] = defaultFor(p);
    dc.addType(type, {
      isComponent: (el: HTMLElement) => (el?.getAttribute?.(TYPE_ATTR) === type ? { type } : false),
      model: { defaults },
    });
    // Existing instances: the new script and any new parameters.
    for (const m of componentInstances(this.editor, type)) {
      const patch: Record<string, unknown> = { 'script-export': script, 'script-props': params.map((p) => p.id), traits: defaults.traits };
      for (const p of params) if (m.get(p.id) === undefined) patch[p.id] = defaultFor(p);
      m.set(patch);
    }
    this.editor.Blocks.add(`${BLOCK_PREFIX}${type}`, {
      label: spec.label || bp.name,
      category: this.category(),
      media: MEDIA,
      content: { type },
      attributes: { title: bp.description || bp.name },
    } as any);
  }
}
