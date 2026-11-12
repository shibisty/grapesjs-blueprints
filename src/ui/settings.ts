import type { Editor } from 'grapesjs';
import type { ScriptsManager, ScriptsSettings } from '../core/ScriptsManager';
import type { Translator } from '../i18n';
import type { ScriptsExporter } from '../integration/export';
import { h } from './dom';
import { librariesEditor } from './libraries';
import { copyText, download, openModal, projectPages } from './modals';

/** Settings: output (file/inline, minify, obfuscate…), export, CDN libraries. */
export function openSettingsDialog(editor: Editor, manager: ScriptsManager, t: Translator, exporter: ScriptsExporter, addLibrary: () => void): HTMLElement {
  const s = manager.settings;
  const set = (patch: Partial<ScriptsSettings>) => manager.setSettings(patch);
  const radio = (value: ScriptsSettings['output'], label: string, hint: string) =>
    h(
      'label',
      { class: 'gjscr-kind' },
      h('input', { type: 'radio', name: 'gjscr-output', value, checked: s.output === value, onchange: () => (set({ output: value }), sync()) }),
      h('span', {}, h('b', {}, label), h('small', {}, hint)),
    );
  const fileName = h('input', { class: 'gjscr-input', type: 'text', spellcheck: 'false', onchange: () => set({ fileName: fileName.value.trim() || 'scripts.js' }) });
  fileName.value = s.fileName;
  const fileField = h('div', { class: 'gjscr-field' }, h('label', {}, t('fileName')), fileName);
  const check = (key: 'minify' | 'obfuscate' | 'comments' | 'includeInHtml', label: string, hint?: string) =>
    h(
      'label',
      { class: 'gjscr-check gjscr-check-top' },
      h('input', { type: 'checkbox', checked: !!s[key], onchange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked }) }),
      h('span', {}, label, hint ? h('small', { class: 'gjscr-hint' }, hint) : null),
    );
  const sync = () => (fileField.hidden = manager.settings.output !== 'file');

  const exportBox = h('div', { class: 'gjscr-export' });
  const runExport = async () => {
    exportBox.replaceChildren(h('div', { class: 'gjscr-hint' }, '…'));
    const site = await exporter.exportSite();
    const names = new Map(projectPages(editor).map((p) => [p.id, p.name]));
    const pages = Object.entries(site.pages).filter(([, v]) => v.libraries || v.scripts);
    if (!site.files.length && !pages.length) return void exportBox.replaceChildren(h('div', { class: 'gjscr-hint' }, t('nothingToExport')));
    const kids: (Node | null)[] = [
      ...site.warnings.map((w) => h('div', { class: 'gjscr-err' }, w)),
      site.files.length ? h('div', { class: 'gjscr-hint' }, t('exportNote')) : null,
      ...site.files.map((f) => h('div', { class: 'gjscr-inline' }, h('code', { style: 'flex:1' }, `${f.name} · ${(f.code.length / 1024).toFixed(1)} KB`), h('button', { type: 'button', class: 'gjscr-secondary', onclick: () => download(f.name, f.code) }, t('download')))),
      ...pages.map(([id, v]) => {
        const tags = [v.libraries, v.scripts].filter(Boolean).join('\n');
        const ta = h('textarea', { class: 'gjscr-input gjscr-tags', rows: Math.min(8, tags.split('\n').length + 1), readonly: true, spellcheck: 'false' });
        ta.value = tags;
        return h(
          'div',
          { class: 'gjscr-field' },
          h('label', {}, `${t('tagsLabel')}${pages.length > 1 ? `: ${names.get(id) || id}` : ''}`),
          ta,
          h('button', { type: 'button', class: 'gjscr-secondary', onclick: () => void copyText(tags) }, t('copy')),
        );
      }),
    ];
    exportBox.replaceChildren(...(kids.filter(Boolean) as Node[]));
  };

  const libs = librariesEditor(editor, manager, t, projectPages(editor), addLibrary);
  const root = h(
    'div',
    { class: 'gjscr-modal gjscr-settings' },
    h('h4', { class: 'gjscr-h' }, t('output')),
    h('div', { class: 'gjscr-kinds' }, radio('file', t('outputFile'), t('outputFileHint')), radio('inline', t('outputInline'), t('outputInlineHint'))),
    fileField,
    check('minify', t('minify'), t('minifyHint')),
    check('obfuscate', t('obfuscate'), t('obfuscateHint')),
    check('comments', t('comments')),
    check('includeInHtml', t('includeInHtml')),
    h('h4', { class: 'gjscr-h' }, t('exportTitle')),
    h('button', { type: 'button', class: 'gjscr-primary', onclick: () => void runExport() }, t('exportTitle')),
    exportBox,
    h('h4', { class: 'gjscr-h' }, t('libraries')),
    libs,
  );
  sync();
  openModal(editor, t('settings'), root, () => (libs as any).__off?.());
  return root;
}
