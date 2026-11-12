import type { Editor } from 'grapesjs';
import type { NodeRegistry } from '../blueprint';
import { GraphEditor, type Text } from '../blueprint/editor';
import { isValidComponentType, type ScriptsManager } from '../core/ScriptsManager';
import { getLocale, isRtlLocale } from '../i18n';
import { graphLocales } from '../i18n/graph';
import { componentOf, pickElement, selectorCandidates, suggestHookClass } from '../integration/picker';
import type { Translator } from '../i18n';
import { h } from './dom';
import { projectPages } from './modals';

/**
 * Pick an element in the canvas (the blueprint editor hides meanwhile), then choose one of its
 * selectors — or give it a `js-` class hook. Resolves to the selector or null.
 */
export async function pickSelectorFlow(editor: Editor, t: Translator, host: HTMLElement): Promise<string | null> {
  const prev = host.style.display;
  host.style.display = 'none';
  let el: Element | null = null;
  try {
    el = await pickElement(editor, { message: t('pickHint') });
  } finally {
    host.style.display = prev;
  }
  if (!el) return null;
  const doc = el.ownerDocument;
  const list = selectorCandidates(el, doc);
  return new Promise((resolve) => {
    const close = (v: string | null) => {
      box.remove();
      resolve(v);
    };
    const comp = componentOf(el);
    const hook = suggestHookClass(el!, (c) => !!doc.querySelector(`.${c}`));
    const items = list.map((c) =>
      h(
        'button',
        { type: 'button', class: `gjscr-pick-item${c.note ? ` is-${c.note}` : ''}`, onclick: () => close(c.selector) },
        h('code', {}, c.selector),
        h('small', {}, [t('matches', c.count), c.note === 'unstable' ? t('unstable') : c.note === 'generic' ? t('generic') : ''].filter(Boolean).join(' · ')),
      ),
    );
    const box = h(
      'div',
      { class: 'gjscr-pick', role: 'dialog' },
      h('div', { class: 'gjscr-pick-panel' }, h('h3', {}, t('pickTitle')), ...items, comp
        ? h('button', { type: 'button', class: 'gjscr-pick-item is-hook', onclick: () => {
            comp.addClass?.(hook);
            close(`.${hook}`);
          } }, h('span', {}, t('addHook', hook)))
        : null, h('div', { class: 'gjscr-actions' }, h('button', { type: 'button', class: 'gjscr-secondary', onclick: () => close(null) }, t('cancel')))),
    );
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
    });
    host.appendChild(box);
    (box.querySelector('.gjscr-pick-item') as HTMLElement | null)?.focus();
  });
}

/** Text lookup for the graph editor in the editor's language (English built in). */
export function graphText(editor: Editor, overrides: Record<string, string> = {}): Text {
  return (key, fallback, ...args) => {
    const lang = (getLocale(editor) || 'en').split('-')[0];
    const msg = overrides[key] ?? graphLocales[lang]?.[key] ?? fallback;
    let i = 0;
    return msg.replace(/%s/g, () => String(args[i++] ?? ''));
  };
}

export interface OpenGraphOptions {
  /** Delay before changes are written to the manager. */
  saveDelay?: number;
  labels?: Record<string, string>;
  /** Plugin texts (the selector picker). */
  t?: Translator;
}

/**
 * Opens the blueprint editor for a script over the whole page. Changes go to the manager
 * (debounced, flushed on close). Resolves when the editor closes.
 */
export function openGraphEditor(editor: Editor, manager: ScriptsManager, registry: NodeRegistry, id: string, o: OpenGraphOptions = {}): GraphEditor | null {
  const bp = manager.get(id);
  if (!bp) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: typeof bp | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (latest && manager.has(id)) manager.update(id, latest);
    latest = null;
  };
  // eslint-disable-next-line prefer-const
  let ge: GraphEditor;
  ge = new GraphEditor({
    blueprint: bp,
    registry,
    t: graphText(editor, o.labels),
    dir: isRtlLocale(getLocale(editor)) ? 'rtl' : 'ltr',
    pages: () => projectPages(editor),
    pickSelector: o.t && editor.Canvas.getDocument?.() ? () => pickSelectorFlow(editor, o.t!, ge.root) : undefined,
    code: (b) => {
      // The JS as the plugin outputs it for this script.
      latest = b;
      flush();
      return manager.codeOf(id).code;
    },
    validateComponentType: (type) => {
      if (!isValidComponentType(type)) return 'a-z, 0-9, "-" (bp-my-block)';
      return manager.componentTypes(id).includes(type) ? 'taken' : null;
    },
    onChange: (b) => {
      latest = b;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, o.saveDelay ?? 300);
    },
    onClose: (b) => {
      latest = b;
      flush();
    },
  });
  ge.mount(document.body);
  return ge;
}
