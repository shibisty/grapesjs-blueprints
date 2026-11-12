type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
export type Child = Node | string | number | null | undefined | false | Child[];

/** Element factory: text via text nodes only, `on*` → listeners, false/null attributes skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (k: Child): void => {
    if (Array.isArray(k)) return k.forEach(add);
    if (k === false || k == null) return;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Text lookup: `(key, fallback, ...args)`, `%s` replaced in order. */
export type Text = (key: string, fallback: string, ...args: (string | number)[]) => string;

export const defaultText: Text = (_key, fallback, ...args) => {
  let i = 0;
  return fallback.replace(/%s/g, () => String(args[i++] ?? ''));
};

/** Message of a diagnostic in the UI language: `diag.<code>` with its args (labels translated). */
export function diagnosticText(t: Text, d: { code: string; message: string; args?: string[] }): string {
  if (d.code === 'node-warning' || d.code === 'compile-error') return d.message;
  const args = (d.args || []).map((a) => t(`label.${a}`, a));
  return t(`diag.${d.code}`, d.message, ...args);
}
