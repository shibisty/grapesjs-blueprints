import type { Editor } from 'grapesjs';
import type { ScriptsManager } from '../core/ScriptsManager';
import type { CodeItem, CodeLang } from '../core/code';
import type { Translator } from '../i18n';
import { h, icon } from './dom';
import { openModal } from './modals';

/** A record of grapesjs-site-pages (page, layout or template), as its sidebar sends it. */
export interface RecordRef {
  id: string;
  name: string;
  kind?: string;
}

export interface RecordCodeActions {
  /** Creates a page item targeting the record and opens it. */
  createHere(lang: CodeLang): void;
  /** Opens an item in the code editor. */
  edit(id: string): void;
}

/**
 * "Scripts & styles" of one record: the page (template) JS and CSS items with a checkbox each —
 * checked means the item runs on this record — and the global ones, which run everywhere.
 * Items with no pages listed run on every page and stay checked.
 */
export function openRecordCodeDialog(editor: Editor, manager: ScriptsManager, t: Translator, rec: RecordRef, a: RecordCodeActions): HTMLElement {
  const body = h('div', { class: 'gjscr-modal gjscr-record-code', 'data-record': rec.id });

  const open = (id: string) => {
    (editor.Modal as any).close();
    a.edit(id);
  };
  const row = (c: CodeItem): HTMLElement => {
    const pages = c.target?.pages || [];
    const all = c.kind === 'global' || !pages.length;
    const box = h('input', {
      type: 'checkbox',
      checked: all || pages.includes(rec.id),
      disabled: all,
      'data-id': c.id,
      onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        const cur = manager.getCode(c.id)?.target?.pages || [];
        const next = on ? Array.from(new Set([...cur, rec.id])) : cur.filter((x) => x !== rec.id);
        // Unchecking the only page would make the item run everywhere: turn it off instead.
        if (!next.length) manager.updateCode(c.id, { enabled: false, target: { ...(c.target || {}), pages: [rec.id] } });
        else manager.updateCode(c.id, { enabled: true, target: { ...(manager.getCode(c.id)?.target || {}), pages: next } });
        render();
      },
    });
    if (!all && !c.enabled) box.checked = false;
    return h(
      'li',
      { class: `gjscr-rc-item${c.enabled ? '' : ' is-off'}` },
      h('label', { class: 'gjscr-check' }, box, h('span', { class: 'gjscr-rc-lang' }, c.lang.toUpperCase()), ' ', c.name),
      all && c.kind !== 'global' ? h('small', { class: 'gjscr-hint' }, ` ${t('allPages')}`) : null,
      h(
        'button',
        { class: 'gjscr-act', type: 'button', title: t('edit'), 'aria-label': t('edit'), onclick: () => open(c.id) },
        icon('edit', 14),
      ),
    );
  };

  const render = () => {
    const items = [...manager.listCode('js'), ...manager.listCode('css')];
    const local = items.filter((c) => c.kind === 'template');
    const global = items.filter((c) => c.kind === 'global' && c.enabled);
    body.replaceChildren(
      h('p', { class: 'gjscr-hint' }, t('recordCodeHint')),
      local.length ? h('ul', { class: 'gjscr-rc-list' }, ...local.map(row)) : h('p', { class: 'gjscr-empty' }, t('noRecordCode')),
      global.length
        ? h('div', {}, h('div', { class: 'gjscr-label' }, t('globalCode')), h('ul', { class: 'gjscr-rc-list' }, ...global.map(row)))
        : '',
      h(
        'div',
        { class: 'gjscr-actions' },
        h('button', { type: 'button', class: 'gjscr-secondary', 'data-new': 'js', onclick: () => ((editor.Modal as any).close(), a.createHere('js')) }, t('newJsHere')),
        h('button', { type: 'button', class: 'gjscr-secondary', 'data-new': 'css', onclick: () => ((editor.Modal as any).close(), a.createHere('css')) }, t('newCssHere')),
        h('button', { type: 'button', class: 'gjscr-primary', onclick: () => (editor.Modal as any).close() }, t('done')),
      ),
    );
  };
  render();
  const off = () => editor.off('scripts:code', render);
  editor.on('scripts:code', render);
  openModal(editor, t('recordCodeTitle', rec.name), body, off);
  return body;
}
