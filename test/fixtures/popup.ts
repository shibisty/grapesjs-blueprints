import type { Blueprint } from '../../src/blueprint';

/** Markup of the popup example (also used in docs/article-popup.md). */
export const POPUP_HTML = `
<button class="js-popup-open" type="button">Open popup</button>
<div id="popup" class="popup" role="dialog" aria-modal="true">
  <div class="popup__dialog">
    <button class="js-popup-close" type="button" aria-label="Close">×</button>
    <p>Hello from the popup!</p>
  </div>
</div>`;

export const POPUP_CSS = `.popup{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center}
.popup.is-open{display:flex}
.popup__dialog{background:#fff;padding:24px;border-radius:8px;position:relative}`;

/** The first test: click "open" → add class, click "close" → remove class. */
export const POPUP_BLUEPRINT: Blueprint = {
  schema: 1,
  id: 'bp_popup',
  name: 'Popup',
  kind: 'global',
  enabled: true,
  variables: [],
  nodes: [
    { id: 'open', type: 'event.element', pos: [40, 40], props: { selector: '.js-popup-open', event: 'click' } },
    { id: 'show', type: 'dom.addClass', pos: [360, 40], props: { target: '#popup', className: 'is-open' } },
    { id: 'close', type: 'event.element', pos: [40, 240], props: { selector: '.js-popup-close', event: 'click' } },
    { id: 'hide', type: 'dom.removeClass', pos: [360, 240], props: { target: '#popup', className: 'is-open' } },
  ],
  links: [
    { from: ['open', 'then'], to: ['show', 'exec'] },
    { from: ['close', 'then'], to: ['hide', 'exec'] },
  ],
};

/** Bonus from the article: Escape and a click on the backdrop close it too. */
export const POPUP_BONUS_BLUEPRINT: Blueprint = {
  ...POPUP_BLUEPRINT,
  id: 'bp_popup_bonus',
  name: 'Popup + Escape + backdrop',
  nodes: [
    ...POPUP_BLUEPRINT.nodes,
    { id: 'esc', type: 'event.key', pos: [40, 420], props: { key: 'Escape' } },
    { id: 'backdrop', type: 'event.element', pos: [40, 560], props: { selector: '.popup', event: 'click' } },
    { id: 'target', type: 'event.target', pos: [200, 700] },
    { id: 'isBackdrop', type: 'dom.matches', pos: [360, 700], props: { selector: '.popup' } },
    { id: 'if', type: 'flow.branch', pos: [360, 560] },
  ],
  links: [
    ...POPUP_BLUEPRINT.links,
    { from: ['esc', 'then'], to: ['hide', 'exec'] },
    { from: ['backdrop', 'then'], to: ['if', 'exec'] },
    { from: ['backdrop', 'event'], to: ['target', 'event'] },
    { from: ['target', 'target'], to: ['isBackdrop', 'target'] },
    { from: ['isBackdrop', 'result'], to: ['if', 'condition'] },
    { from: ['if', 'true'], to: ['hide', 'exec'] },
  ],
};
