/**
 * Minimal JavaScript highlighter for read-only code views: comments, strings, numbers, keywords
 * and `__bp_` helpers. Builds DOM with text nodes only (never innerHTML).
 */
const KEYWORDS = new Set(
  'var let const function return if else for while do switch case break continue default new typeof instanceof in of try catch finally throw this void delete'.split(' '),
);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)/g;

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'literal' | 'helper' | 'text';

export function tokenize(code: string): { kind: TokenKind; text: string }[] {
  const out: { kind: TokenKind; text: string }[] = [];
  let last = 0;
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind && kind === 'text') prev.text += text;
    else out.push({ kind, text });
  };
  for (const m of code.matchAll(TOKEN)) {
    push('text', code.slice(last, m.index));
    if (m[1]) push('comment', m[1]);
    else if (m[2]) push('string', m[2]);
    else if (m[3]) push('number', m[3]);
    else if (m[4]) {
      const w = m[4];
      push(KEYWORDS.has(w) ? 'keyword' : LITERALS.has(w) ? 'literal' : w.startsWith('__bp_') ? 'helper' : 'text', w);
    }
    last = (m.index || 0) + m[0].length;
  }
  push('text', code.slice(last));
  return out;
}

/** `<code>` with one `<span class="<prefix>-ln">` per line and `<prefix>-t-<kind>` tokens. */
export function highlight(code: string, prefix = 'bpe'): HTMLElement {
  const root = document.createElement('code');
  let line = document.createElement('span');
  const newLine = () => {
    line = document.createElement('span');
    line.className = `${prefix}-ln`;
    root.appendChild(line);
  };
  newLine();
  for (const tok of tokenize(code)) {
    tok.text.split('\n').forEach((part, i) => {
      if (i > 0) newLine();
      if (!part) return;
      if (tok.kind === 'text') line.appendChild(document.createTextNode(part));
      else {
        const s = document.createElement('span');
        s.className = `${prefix}-t-${tok.kind}`;
        s.textContent = part;
        line.appendChild(s);
      }
    });
  }
  return root;
}
