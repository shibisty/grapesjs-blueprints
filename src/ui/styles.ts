export const STYLE_ID = 'gjscr-style';

const ACCENT = 'var(--gjs-quaternary-color,#d278c9)';

export const CSS = `
.gjscr{display:flex;flex-direction:column;min-height:100%;font-size:13px;text-align:start;font-family:var(--gjs-main-font,Helvetica,sans-serif)}
.gjscr[hidden]{display:none !important}
.gjscr.gjscr-docked{width:100%;height:100%;overflow:hidden;background:var(--gjs-primary-color,#444)}
.gjscr.gjscr-floating{position:absolute;top:0;right:0;bottom:0;width:300px;z-index:50;box-shadow:-2px 0 8px rgba(0,0,0,.35);background:var(--gjs-primary-color,#444)}
.gjscr-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.25);font-weight:600}
.gjscr-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjscr-tools{display:flex;gap:2px}
.gjscr-btn,.gjscr-act{background:none;border:0;color:inherit;cursor:pointer;padding:4px;border-radius:3px;line-height:0}
.gjscr-btn:hover,.gjscr-act:hover{background:rgba(255,255,255,.14)}
.gjscr-btn:focus-visible,.gjscr-act:focus-visible{outline:1px solid ${ACCENT}}
.gjscr-searchbox{padding:8px 10px 4px}
.gjscr-search{width:100%;box-sizing:border-box;padding:5px 8px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.15);border-radius:3px;color:inherit;font:inherit}
.gjscr-search:focus{outline:none;border-color:${ACCENT}}
.gjscr-body{flex:1;overflow:auto;padding-bottom:10px}
.gjscr-section{display:flex;align-items:center;justify-content:space-between;padding:10px 10px 4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.7}
.gjscr-section .gjscr-count{opacity:.7;margin-inline-start:4px}
.gjscr-list{list-style:none;margin:0;padding:0}
.gjscr-item{position:relative;display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-inline-start:3px solid transparent}
.gjscr-item:hover,.gjscr-item:focus-visible{background:rgba(255,255,255,.06);outline:none}
.gjscr-item:focus-visible{border-inline-start-color:${ACCENT}}
.gjscr-item.is-off .gjscr-name{opacity:.5;text-decoration:line-through}
.gjscr-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#5cb85c}
.gjscr-item.is-off .gjscr-dot{background:rgba(255,255,255,.3)}
.gjscr-item.has-errors .gjscr-dot{background:#e5534b}
.gjscr-main{flex:1;min-width:0}
.gjscr-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gjscr-sub{font-size:10px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gjscr-sub .gjscr-err{color:#ff8a80;opacity:1}
.gjscr-acts{display:none;gap:1px;position:absolute;inset-inline-end:6px;top:50%;transform:translateY(-50%);padding-inline-start:16px;background:linear-gradient(to right,transparent,var(--gjs-primary-color,#444) 16px)}
.gjscr[dir=rtl] .gjscr-acts{background:linear-gradient(to left,transparent,var(--gjs-primary-color,#444) 16px)}
.gjscr-item:hover .gjscr-acts,.gjscr-item:focus-within .gjscr-acts{display:flex}
.gjscr-empty{padding:4px 10px 6px 21px;opacity:.55;font-size:12px}
.gjscr-toggle{position:absolute;top:8px;right:8px;z-index:60;background:var(--gjs-primary-color,#444);color:var(--gjs-font-color,#ddd);border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:6px;cursor:pointer;line-height:0}
.gjscr-toggle.gjscr-btn-inline{position:static;border:0;padding:5px;background:transparent}
.gjscr-modal{font-size:13px;text-align:start}
.gjscr-field{margin:0 0 12px}
.gjscr-field>label,.gjscr-label{display:block;font-weight:600;margin-bottom:4px}
.gjscr-hint{display:block;font-size:11px;opacity:.6;margin-top:3px}
.gjscr-input{width:100%;box-sizing:border-box;padding:6px 8px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:3px;font:inherit}
.gjscr-input:focus{outline:none;border-color:${ACCENT}}
.gjscr-input.is-invalid{border-color:#e5534b}
.gjscr-kinds{display:grid;gap:6px}
.gjscr-kind{display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid rgba(255,255,255,.15);border-radius:4px;cursor:pointer}
.gjscr-kind:has(input:checked){border-color:${ACCENT};background:rgba(210,120,201,.1)}
.gjscr-kind input{margin-top:2px}
.gjscr-kind b{display:block}
.gjscr-kind small{opacity:.65}
.gjscr-pages{max-height:140px;overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:3px;padding:4px 8px}
.gjscr-check{display:flex;align-items:center;gap:6px;margin:3px 0}
.gjscr-msg{min-height:18px;color:#ff8a80;margin:4px 0}
.gjscr-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:10px}
.gjscr-primary,.gjscr-secondary{padding:7px 14px;border-radius:3px;border:0;cursor:pointer;color:inherit;font:inherit}
.gjscr-primary{background:${ACCENT}}
.gjscr-secondary{background:rgba(255,255,255,.15)}
.gjscr-codebar{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.gjscr-codebar .gjscr-spacer{flex:1}
.gjscr-diags{list-style:none;margin:0 0 8px;padding:0;font-size:12px}
.gjscr-diags li{padding:3px 0 3px 18px;position:relative}
.gjscr-diags li::before{content:'';position:absolute;left:4px;top:8px;width:8px;height:8px;border-radius:50%;background:#e5534b}
.gjscr-diags li.is-warning::before{background:#e0a33a}
.gjscr-diags li.is-ok::before{background:#5cb85c}
.gjscr-code{margin:0;max-height:60vh;overflow:auto;background:#1e1e1e;color:#d4d4d4;border-radius:4px;padding:8px 0;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;counter-reset:ln;tab-size:2;text-align:left;direction:ltr}
.gjscr-code code{display:block;white-space:pre}
.gjscr-ln{display:block;padding:0 12px 0 0}
.gjscr-ln::before{counter-increment:ln;content:counter(ln);display:inline-block;width:3.5em;padding-right:1em;text-align:right;opacity:.35;user-select:none}
.gjscr-t-comment{color:#6a9955}
.gjscr-t-string{color:#ce9178}
.gjscr-t-number{color:#b5cea8}
.gjscr-t-keyword{color:#569cd6}
.gjscr-t-literal{color:#4fc1ff}
.gjscr-t-helper{color:#dcdcaa}
.gjscr-h{margin:16px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.7}
.gjscr-h:first-child{margin-top:0}
.gjscr-inline{display:flex;gap:6px;align-items:center;margin:4px 0}
.gjscr-spacer{flex:1}
.gjscr-check-top{align-items:flex-start;margin:6px 0}
.gjscr-check-top input{margin-top:3px}
.gjscr-rc-list{list-style:none;margin:4px 0 10px;padding:0}
.gjscr-rc-item{display:flex;align-items:center;gap:6px}
.gjscr-rc-item>label{flex:1;min-width:0}
.gjscr-rc-item.is-off{opacity:.6}
.gjscr-rc-lang{font-size:10px;opacity:.7;min-width:26px}
.gjscr-check-top small{display:block;margin-top:2px}
.gjscr-tags{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;margin:4px 0}
.gjscr-tabs{display:flex;gap:2px;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,.15)}
.gjscr-tab{border:0;background:none;color:inherit;cursor:pointer;padding:6px 12px;border-bottom:2px solid transparent;font:inherit}
.gjscr-tab.is-active{border-bottom-color:${ACCENT}}
.gjscr-liblist{list-style:none;margin:6px 0;padding:0;max-height:46vh;overflow:auto}
.gjscr-liblist li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:3px}
.gjscr-liblist li.is-clickable{cursor:pointer}
.gjscr-liblist li:hover,.gjscr-liblist li:focus{background:rgba(255,255,255,.08);outline:none}
.gjscr-liblist small{opacity:.6}
.gjscr-libsplit{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gjscr-libdetail h4{margin:6px 0}
.gjscr-files{max-height:32vh;overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:3px;padding:4px 8px}
.gjscr-files code,.gjscr-libfiles code{font-size:11px;word-break:break-all}
.gjscr-lib{border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:6px 8px;margin:6px 0}
.gjscr-lib.is-off{opacity:.55}
.gjscr-libhead{display:flex;align-items:center;gap:4px}
.gjscr-libfiles{list-style:none;margin:4px 0;padding:0;opacity:.75}
.gjscr-lib details{margin-top:4px;font-size:12px}
.gjscr-export .gjscr-inline code{font-size:12px}
.gjscr-pick{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
.gjscr-pick-panel{background:#26282c;color:#d7d9dd;border-radius:6px;padding:14px;min-width:360px;max-width:560px;max-height:80vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.6);font:13px system-ui,sans-serif}
.gjscr-pick-panel h3{margin:0 0 10px;font-size:14px}
.gjscr-pick-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:start;background:#1b1c1f;border:1px solid #3a3d43;border-radius:4px;color:inherit;padding:7px 10px;margin:5px 0;cursor:pointer;font:inherit}
.gjscr-pick-item:hover,.gjscr-pick-item:focus{border-color:${ACCENT};outline:none}
.gjscr-pick-item code{font-size:13px;color:#ffd580}
.gjscr-pick-item small{opacity:.6}
.gjscr-pick-item.is-unstable code,.gjscr-pick-item.is-generic code{color:#aaa}
.gjscr-pick-item.is-hook{border-style:dashed}
.gjscr-pick-banner{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10002;background:#ffb300;color:#222;padding:8px 16px;border-radius:20px;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);pointer-events:none}
.gjscr-libdialog{min-height:300px}

.gjscr-stabs{display:flex;gap:2px;padding:6px 8px 0;border-bottom:1px solid rgba(0,0,0,.25)}
.gjscr-stab{flex:1;background:none;border:0;border-bottom:2px solid transparent;color:inherit;font:inherit;font-size:12px;padding:6px 4px;cursor:pointer;opacity:.7;white-space:nowrap}
.gjscr-stab:hover{opacity:1}
.gjscr-stab.is-active{opacity:1;border-bottom-color:${ACCENT};font-weight:600}
.gjscr-stab:focus-visible{outline:1px solid ${ACCENT}}
.gjscr-stab .gjscr-count{margin-inline-start:4px;opacity:.6;font-size:11px}
.gjscr-ce{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;font-size:13px;font-family:var(--gjs-main-font,Helvetica,sans-serif);background:var(--gjs-primary-color,#444);text-align:start}
.gjscr-ce.gjscr-ce--embedded{position:absolute;z-index:auto}
.gjscr-ce-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.3)}
.gjscr-ce-lang{font-size:11px;font-weight:700;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,.12)}
.gjscr-ce[data-lang=js] .gjscr-ce-lang{color:#f0db4f}
.gjscr-ce[data-lang=css] .gjscr-ce-lang{color:#6cb8ff}
.gjscr-ce-name{flex:1;max-width:420px}
.gjscr-ce-on{margin:0 0 0 auto}
.gjscr-ce-body{flex:1;display:flex;min-height:0}
.gjscr-ce-main{flex:1;display:flex;flex-direction:column;min-width:0}
.gjscr-ce-hint{padding:6px 10px;font-size:12px;opacity:.7}
.gjscr-ce-main>.gjscr-cm,.gjscr-ce-main>.gjscr-code-input{flex:1;min-height:0}
.gjscr-cm{position:relative;overflow:hidden}
.gjscr-cm>div{position:absolute;inset:0}
.gjscr-cm .CodeMirror{height:100%;font-size:13px}
.gjscr-ce .gjscr-primary{color:#fff;font-weight:600}
.gjscr-ce-small{height:120px;border:1px solid rgba(255,255,255,.15);border-radius:3px}
.gjscr-code-input{display:block;width:100%;box-sizing:border-box;margin:0;padding:8px 10px;border:0;resize:none;background:rgba(0,0,0,.3);color:inherit;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2;white-space:pre}
textarea.gjscr-ce-small{height:120px;border:1px solid rgba(255,255,255,.15)}
.gjscr-ce-status{padding:5px 10px;font-size:12px;border-top:1px solid rgba(0,0,0,.3);opacity:.85}
.gjscr-ce-status.is-error{color:#ff8a80;opacity:1}
.gjscr-ce-side{width:300px;flex-shrink:0;overflow:auto;padding:10px;border-inline-start:1px solid rgba(0,0,0,.3)}
.gjscr-tgroup{margin:6px 0 2px}
.gjscr-tgroup-title{font-size:11px;opacity:.7;margin:6px 0 2px}
.gjscr-check.is-gone{opacity:.6;text-decoration:line-through}
.gjscr-row{display:flex;gap:4px;align-items:center}
.gjscr-params{display:flex;flex-direction:column;gap:6px}
.gjscr-param{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:6px;border:1px solid rgba(255,255,255,.12);border-radius:3px}
.gjscr-param .gjscr-act{justify-self:end}
`;

export function injectCss(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.appendChild(s);
}
