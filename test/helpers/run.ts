import { buildScript, createRegistry, type Blueprint, type BuildOptions } from '../../src/blueprint';

export const registry = createRegistry();

/** Builds blueprints in preview mode and starts them on the current (jsdom) document. */
export function start(bps: Blueprint[], options: BuildOptions = {}) {
  const res = buildScript(bps, registry, { ...options, target: 'preview' });
  const startFn = new Function(`return (${res.code});`)() as (doc: Document) => () => void;
  const stop = startFn(document);
  return { ...res, stop };
}

export function click(el: Element | null) {
  if (!el) throw new Error('no element to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

export function key(k: string, type = 'keydown') {
  document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
}

/**
 * Compact graph builder for tests: nodes as `[id, type, props?]`, links as `'a.then > b.exec'`.
 */
export function graph(
  nodes: [string, string, Record<string, unknown>?][],
  links: string[] = [],
  extra: Partial<Blueprint> = {},
): Blueprint {
  return {
    schema: 1,
    id: extra.id || 'bp_test',
    name: extra.name || 'Test',
    kind: extra.kind || 'global',
    enabled: true,
    variables: extra.variables || [],
    nodes: nodes.map(([id, type, props], i) => ({ id, type, pos: [0, i * 100] as [number, number], ...(props ? { props } : {}) })),
    links: links.map((s) => {
      const [a, b] = s.split('>').map((x) => x.trim().split('.'));
      return { from: [a[0], a[1]] as [string, string], to: [b[0], b[1]] as [string, string] };
    }),
    ...extra,
  };
}
