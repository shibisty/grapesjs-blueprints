import type { Editor } from 'grapesjs';
import type { ScriptsManager } from '../core/ScriptsManager';
import { parseRules, targets, type CodeItem, type CodeLang, type PageScope } from '../core/code';
import type { Library } from '../core/libraries';
import type { Translator } from '../i18n';
import { h, icon } from './dom';
import { openModal } from './modals';

/** A record of grapesjs-site-pages (page, layout, template or component), as its sidebar sends it. */
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

/** The rule that names this record: `<id>` for a page/layout/template, `component:<id>` for a component. */
export const recordRule = (rec: RecordRef): string => (rec.kind === 'component' ? `component:${rec.id}` : rec.id);

/** The scope of the record alone, for matching rules. */
const recordScope = (rec: RecordRef): PageScope => (rec.kind === 'component' ? { id: rec.id, kind: 'component' } : { id: rec.id });

/**
 * Turns a unique item on/off for one record by editing its conditions.
 * Returns the new rule list, or null when the item should be switched off
 * (unchecking the only condition would make it run everywhere).
 */
export function toggleRule(rules: string[], rec: RecordRef, on: boolean): string[] | null {
  const key = recordRule(rec);
  const not = `!${key}`;
  if (on) {
    const rest = rules.filter((r) => r !== not);
    const hasEq = parseRules(rest).some((r) => r.op === 'eq');
    // With "is" rules the record must be one of them; with only "is not" rules removing ours is enough.
    return hasEq || !rest.length ? Array.from(new Set([...rest, key])) : rest;
  }
  const rest = rules.filter((r) => r !== key);
  if (!rest.length) return null;
  const hasEq = parseRules(rest).some((r) => r.op === 'eq');
  return hasEq ? rest : Array.from(new Set([...rest, not]));
}

/**
 * "Scripts & styles" of one record: the unique JS/CSS items and libraries with a checkbox
 * each — checked means it is used on this record — and the global ones, which run everywhere.
 * Items without conditions run on every page and stay checked.
 */
export function openRecordCodeDialog(editor: Editor, manager: ScriptsManager, t: Translator, rec: RecordRef, a: RecordCodeActions): HTMLElement {
  const body = h('div', { class: 'gjscr-modal gjscr-record-code', 'data-record': rec.id });
  const scope = recordScope(rec);

  const open = (id: string) => {
    (editor.Modal as any).close();
    a.edit(id);
  };
  const line = (o: {
    id: string;
    tag: string;
    name: string;
    enabled: boolean;
    rules: string[];
    global: boolean;
    set: (rules: string[] | null) => void;
    edit?: () => void;
  }): HTMLElement => {
    const all = o.global || !o.rules.length;
    const box = h('input', {
      type: 'checkbox',
      checked: all || (o.enabled && targets(o.rules, scope)),
      disabled: all,
      'data-id': o.id,
      onchange: (e: Event) => {
        o.set(toggleRule(o.rules, rec, (e.target as HTMLInputElement).checked));
        render();
      },
    });
    if (!all && !o.enabled) box.checked = false;
    return h(
      'li',
      { class: `gjscr-rc-item${o.enabled ? '' : ' is-off'}` },
      h('label', { class: 'gjscr-check' }, box, h('span', { class: 'gjscr-rc-lang' }, o.tag), ' ', o.name),
      all && !o.global ? h('small', { class: 'gjscr-hint' }, ` ${t('allPages')}`) : null,
      o.edit ? h('button', { class: 'gjscr-act', type: 'button', title: t('edit'), 'aria-label': t('edit'), onclick: o.edit }, icon('edit', 14)) : null,
    );
  };
  const codeRow = (c: CodeItem): HTMLElement =>
    line({
      id: c.id,
      tag: c.lang.toUpperCase(),
      name: c.name,
      enabled: c.enabled,
      rules: c.target?.pages || [],
      global: c.kind === 'global',
      set: (rules) => {
        const cur = manager.getCode(c.id)?.target || {};
        if (rules === null) manager.updateCode(c.id, { enabled: false, target: { ...cur, pages: [recordRule(rec)] } });
        else manager.updateCode(c.id, { enabled: true, target: { ...cur, pages: rules } });
      },
      edit: () => open(c.id),
    });
  const libRow = (l: Library): HTMLElement =>
    line({
      id: l.id,
      tag: 'LIB',
      name: l.name,
      enabled: l.enabled,
      rules: l.pages || [],
      global: !l.pages?.length,
      set: (rules) => {
        if (rules === null) manager.updateLibrary(l.id, { enabled: false, pages: [recordRule(rec)] });
        else manager.updateLibrary(l.id, { enabled: true, pages: rules });
      },
    });

  const render = () => {
    const items = [...manager.listCode('js'), ...manager.listCode('css')];
    const libs = manager.libraries();
    const local = items.filter((c) => c.kind === 'template');
    const localLibs = libs.filter((l) => l.pages?.length);
    const global = items.filter((c) => c.kind === 'global' && c.enabled);
    const globalLibs = libs.filter((l) => !l.pages?.length && l.enabled);
    const uniq = [...local.map(codeRow), ...localLibs.map(libRow)];
    const glob = [...global.map(codeRow), ...globalLibs.map(libRow)];
    body.replaceChildren(
      h('p', { class: 'gjscr-hint' }, t('recordCodeHint')),
      uniq.length ? h('ul', { class: 'gjscr-rc-list' }, ...uniq) : h('p', { class: 'gjscr-empty' }, t('noRecordCode')),
      glob.length ? h('div', {}, h('div', { class: 'gjscr-label' }, t('globalCode')), h('ul', { class: 'gjscr-rc-list' }, ...glob)) : '',
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
  const onLibs = (e: { type?: string }) => e?.type === 'libraries' && body.isConnected && render();
  const off = () => (editor.off('scripts:code', render), editor.off('scripts:change', onLibs));
  editor.on('scripts:code', render);
  editor.on('scripts:change', onLibs);
  openModal(editor, t('recordCodeTitle', rec.name), body, off);
  return body;
}
