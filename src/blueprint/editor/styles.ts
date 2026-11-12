export const EDITOR_STYLE_ID = 'bpe-style';

/** Colours of pin types (wires use the output's colour). */
export const PIN_COLORS: Record<string, string> = {
  exec: '#ffffff',
  any: '#9aa0a6',
  string: '#f06292',
  number: '#7cc576',
  boolean: '#e05252',
  element: '#4aa3ff',
  elements: '#36d6e7',
  event: '#ffa94d',
  object: '#b388ff',
};

/** Header colours of node categories. */
export const CATEGORY_COLORS: Record<string, string> = {
  events: '#8e2a2a',
  flow: '#5b5f66',
  dom: '#1f5f8b',
  data: '#2f6b3a',
  variables: '#7a5a1c',
  math: '#2e6b62',
  logic: '#6b2f5f',
  code: '#4f6b1f',
  debug: '#4a4a4a',
};

export const EDITOR_CSS = `
.bpe{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;background:#1b1c1f;color:#d7d9dd;font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:start}
.bpe *{box-sizing:border-box}
.bpe button{font:inherit;color:inherit}
.bpe input,.bpe select,.bpe textarea{font:inherit;color:inherit;background:#121315;border:1px solid #3a3d43;border-radius:3px;padding:4px 6px;min-width:0}
.bpe input:focus,.bpe select:focus,.bpe textarea:focus{outline:none;border-color:var(--bpe-accent,#d278c9)}
.bpe select option{background:#222;color:#ddd}
.bpe input[type=checkbox]{width:auto;accent-color:var(--bpe-accent,#d278c9)}
.bpe-top{display:flex;align-items:center;gap:6px;padding:6px 8px;background:#26282c;border-bottom:1px solid #111}
.bpe-name{font-weight:600;font-size:14px;background:transparent !important;border-color:transparent !important;width:260px}
.bpe-name:hover{border-color:#3a3d43 !important}
.bpe-badge{font-size:11px;padding:2px 7px;border-radius:9px;background:#3a3d43;white-space:nowrap}
.bpe-tabs{display:flex;margin-inline-start:12px;background:#121315;border-radius:4px;padding:2px}
.bpe-tab{border:0;background:none;padding:4px 12px;border-radius:3px;cursor:pointer}
.bpe-tab.is-active{background:#3a3d43}
.bpe-spacer{flex:1}
.bpe-tbtn{border:0;background:none;cursor:pointer;padding:5px 8px;border-radius:3px;line-height:1;white-space:nowrap}
.bpe-tbtn:hover{background:#3a3d43}
.bpe-tbtn[disabled]{opacity:.35;cursor:default;background:none}
.bpe-tbtn.is-primary{background:var(--bpe-accent,#d278c9);color:#fff}
.bpe-problems-btn.has-errors{color:#ff8a80}
.bpe-main{flex:1;display:flex;min-height:0}
.bpe-palette{width:230px;flex-shrink:0;display:flex;flex-direction:column;background:#232528;border-inline-end:1px solid #111}
.bpe-palette-search{margin:8px;width:calc(100% - 16px)}
.bpe-palette-list{flex:1;overflow:auto;padding-bottom:12px}
.bpe-cat{padding:8px 10px 3px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;opacity:.6;display:flex;align-items:center;gap:6px}
.bpe-cat i{width:8px;height:8px;border-radius:2px;display:inline-block}
.bpe-pitem{padding:4px 10px 4px 24px;cursor:grab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bpe-pitem:hover,.bpe-pitem.is-active{background:#34373c}
.bpe-canvas{flex:1;position:relative;overflow:hidden;outline:none;background-color:#1b1c1f;background-image:linear-gradient(#26282c 1px,transparent 1px),linear-gradient(90deg,#26282c 1px,transparent 1px);touch-action:none;user-select:none;-webkit-user-select:none}
.bpe-canvas.is-panning{cursor:grabbing}
.bpe-viewport{position:absolute;left:0;top:0;transform-origin:0 0}
.bpe-wires,.bpe-overlay{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.bpe-wire{fill:none;stroke-width:2;opacity:.9}
.bpe-wire.is-exec{stroke-width:3}
.bpe-wire.is-selected{stroke:#ffd54f !important;stroke-width:4;opacity:1}
.bpe-wire-hit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke;cursor:pointer}
.bpe-temp{fill:none;stroke-width:2;stroke-dasharray:6 4}
.bpe-node{position:absolute;min-width:150px;background:rgba(32,34,38,.96);border:1px solid #0b0b0c;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:default}
.bpe-node.is-selected{outline:2px solid #ffb300;outline-offset:1px}
.bpe-node.has-error{border-color:#e05252;box-shadow:0 0 0 1px #e05252,0 2px 8px rgba(0,0,0,.45)}
.bpe-node.is-disabled{opacity:.45}
.bpe-node.is-disabled .bpe-node-head{background-image:repeating-linear-gradient(45deg,transparent 0 6px,rgba(0,0,0,.25) 6px 12px)}
.bpe-node-head{padding:5px 10px;border-radius:5px 5px 0 0;font-weight:600;color:#fff;cursor:move;white-space:nowrap;display:flex;align-items:center;gap:6px}
.bpe-node-head .bpe-ev{font-size:10px;opacity:.85}
.bpe-node-sub{padding:3px 10px 0;font-size:11px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.bpe-node-body{display:flex;justify-content:space-between;gap:14px;padding:5px 0 7px}
.bpe-col{display:flex;flex-direction:column;gap:3px;min-width:0}
.bpe-col.is-out{align-items:flex-end}
.bpe-pin{display:flex;align-items:center;gap:5px;min-height:20px;white-space:nowrap}
.bpe-pin.is-in{padding-inline-start:6px}
.bpe-pin.is-out{padding-inline-end:6px;flex-direction:row-reverse}
.bpe-dot{width:12px;height:12px;border-radius:50%;border:2px solid var(--c);background:transparent;cursor:crosshair;flex-shrink:0}
.bpe-pin.is-linked .bpe-dot{background:var(--c)}
.bpe-pin[data-type=exec] .bpe-dot{border-radius:0;border:0;background:var(--c);clip-path:polygon(0 0,60% 0,100% 50%,60% 100%,0 100%);opacity:.45;width:13px;height:14px}
.bpe-pin[data-type=exec].is-linked .bpe-dot{opacity:1}
.bpe-dot:hover,.bpe-pin.is-target .bpe-dot{box-shadow:0 0 0 3px rgba(255,255,255,.25)}
.bpe-pin.is-bad .bpe-dot{opacity:.15}
.bpe-pin-label{font-size:12px;opacity:.9}
.bpe-lit{width:96px;padding:1px 4px !important;font-size:11px}
.bpe-lit[type=number]{width:64px}
.bpe-comment{position:absolute;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)}
.bpe-comment.is-selected{border-color:#ffb300}
.bpe-comment-head{padding:4px 8px;font-weight:600;font-size:14px;background:rgba(255,255,255,.08);border-radius:6px 6px 0 0;cursor:move;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bpe-comment-resize{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.3) 50%)}
.bpe-marquee{position:absolute;border:1px dashed #ffb300;background:rgba(255,179,0,.08);pointer-events:none}
.bpe-hint{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);opacity:.45;text-align:center;pointer-events:none;max-width:360px}
.bpe-zoom{position:absolute;left:8px;bottom:6px;font-size:11px;opacity:.5;pointer-events:none}
.bpe-minimap{position:absolute;right:10px;bottom:10px;width:180px;height:116px;opacity:.85;background:rgba(18,19,21,.85);border:1px solid #3a3d43;border-radius:4px;cursor:pointer}
.bpe-minimap rect.n{fill:#5b5f66}
.bpe-minimap rect.n.s{fill:#ffb300}
.bpe-minimap rect.v{fill:rgba(255,255,255,.06);stroke:#d7d9dd;stroke-width:1}
.bpe-search{position:absolute;z-index:5;width:280px;max-height:360px;display:flex;flex-direction:column;background:#26282c;border:1px solid #111;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.6)}
.bpe-search input{margin:6px}
.bpe-search-list{overflow:auto;padding-bottom:6px}
.bpe-search .bpe-pitem{cursor:pointer;padding-inline-start:16px}
.bpe-search .bpe-cat{padding-top:6px}
.bpe-search-desc{padding:6px 10px;border-top:1px solid #111;font-size:11px;opacity:.7;min-height:30px}
.bpe-details{width:300px;flex-shrink:0;overflow:auto;background:#232528;border-inline-start:1px solid #111;padding:10px 12px 20px}
.bpe-details h3{margin:0 0 2px;font-size:14px}
.bpe-details h4{margin:16px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6;display:flex;justify-content:space-between;align-items:center}
.bpe-details .bpe-type{font-size:11px;opacity:.5;font-family:ui-monospace,Menlo,Consolas,monospace}
.bpe-details p{margin:6px 0;opacity:.75;font-size:12px}
.bpe-field{margin:0 0 9px}
.bpe-field>label{display:block;font-size:12px;opacity:.8;margin-bottom:3px}
.bpe-field input:not([type=checkbox]),.bpe-field select,.bpe-field textarea{width:100%}
.bpe-field textarea{font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;resize:vertical;min-height:120px;tab-size:2}
.bpe-field.is-invalid input{border-color:#e05252}
.bpe-err-msg{color:#ff8a80;font-size:11px;margin-top:2px}
.bpe-check{display:flex;align-items:center;gap:6px;margin:4px 0}
.bpe-row{display:flex;gap:4px;align-items:center;margin-bottom:4px}
.bpe-row input,.bpe-row select{flex:1}
.bpe-row .bpe-x{flex:0 0 auto}
.bpe-x{border:0;background:none;cursor:pointer;opacity:.6;padding:2px 6px;border-radius:3px}
.bpe-x:hover{opacity:1;background:#3a3d43}
.bpe-add{border:1px dashed #4a4d53;background:none;border-radius:3px;cursor:pointer;padding:3px 8px;font-size:12px;opacity:.8}
.bpe-add:hover{opacity:1;border-color:#888}
.bpe-btn{border:0;background:#3a3d43;border-radius:3px;cursor:pointer;padding:5px 10px}
.bpe-btn:hover{background:#4a4d53}
.bpe-btn.is-danger:hover{background:#8e2a2a}
.bpe-inline{display:flex;gap:4px}
.bpe-inline input{flex:1}
.bpe-problems{list-style:none;margin:0;padding:0;font-size:12px}
.bpe-problems li{padding:4px 4px 4px 18px;position:relative;cursor:pointer;border-radius:3px}
.bpe-problems li:hover{background:#2e3034}
.bpe-problems li::before{content:'';position:absolute;left:5px;top:9px;width:7px;height:7px;border-radius:50%;background:#e05252}
.bpe-problems li.is-warning::before{background:#e0a33a}
.bpe-problems li.is-ok{cursor:default}
.bpe-problems li.is-ok::before{background:#5cb85c}
.bpe-code{flex:1;overflow:auto;margin:0;background:#141517;padding:10px 0;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;counter-reset:ln;tab-size:2;direction:ltr;text-align:left}
.bpe-code[hidden],.bpe-canvas[hidden]{display:none}
.bpe-code code{display:block;white-space:pre}
.bpe-ln{display:block;padding-right:12px}
.bpe-ln::before{counter-increment:ln;content:counter(ln);display:inline-block;width:3.5em;padding-right:1em;text-align:right;opacity:.3;user-select:none}
.bpe-ln.is-node{cursor:pointer}
.bpe-ln.is-node:hover{background:#22252a}
.bpe-t-comment{color:#6a9955}.bpe-t-string{color:#ce9178}.bpe-t-number{color:#b5cea8}.bpe-t-keyword{color:#569cd6}.bpe-t-literal{color:#4fc1ff}.bpe-t-helper{color:#dcdcaa}
.bpe-help{font-size:11px;opacity:.55;line-height:1.6}
.bpe-help kbd{background:#3a3d43;border-radius:3px;padding:0 4px;font:11px ui-monospace,Menlo,Consolas,monospace}
.bpe[dir=rtl] .bpe-pin.is-in{flex-direction:row}
`;

export function injectEditorCss(doc: Document = document): void {
  if (doc.getElementById(EDITOR_STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = EDITOR_STYLE_ID;
  s.textContent = EDITOR_CSS;
  doc.head.appendChild(s);
}
