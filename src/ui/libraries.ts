import type { Editor } from 'grapesjs';
import { fileTypeOf, type Library } from '../core/libraries';
import type { ScriptsManager } from '../core/ScriptsManager';
import type { Translator } from '../i18n';
import { PRESETS, PROVIDERS, toLibraryFiles, type HttpContext, type LibraryProvider, type PackageFile } from '../libs/providers';
import { h } from './dom';
import { openModal } from './modals';

/**
 * Add-a-library dialog: popular presets, search (jsDelivr/npm or cdnjs) with version and file
 * choice, or plain URLs. Resolves to the added library or null.
 */
export function openLibraryDialog(editor: Editor, manager: ScriptsManager, t: Translator, http: HttpContext): Promise<Library | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (lib: Library | null) => {
      if (done) return;
      done = true;
      resolve(lib);
    };
    const add = (init: Partial<Library>) => {
      const lib = manager.addLibrary(init);
      finish(lib);
      (editor.Modal as any).close();
    };
    const tabs = {
      popular: h('button', { type: 'button', class: 'gjscr-tab' }, t('popular')),
      search: h('button', { type: 'button', class: 'gjscr-tab' }, t('libSearch')),
      url: h('button', { type: 'button', class: 'gjscr-tab' }, t('byUrl')),
    };
    const body = h('div', { class: 'gjscr-libbody' });
    const show = (k: keyof typeof tabs) => {
      (Object.keys(tabs) as (keyof typeof tabs)[]).forEach((x) => tabs[x].classList.toggle('is-active', x === k));
      body.replaceChildren(k === 'popular' ? popular() : k === 'search' ? search() : byUrl());
      body.querySelector<HTMLInputElement>('input')?.focus();
    };
    (Object.keys(tabs) as (keyof typeof tabs)[]).forEach((k) => tabs[k].addEventListener('click', () => show(k)));

    const popular = () =>
      h(
        'ul',
        { class: 'gjscr-liblist' },
        PRESETS.map((p) => {
          const exists = manager.libraries().some((l) => l.name === p.name);
          return h(
            'li',
            {},
            h('div', { class: 'gjscr-main' }, h('b', {}, p.name), ' ', h('small', {}, p.version), h('div', { class: 'gjscr-sub' }, p.description)),
            h('button', { type: 'button', class: 'gjscr-secondary', disabled: exists, onclick: () => add({ ...p, files: p.files.map((f) => ({ ...f })) }) }, exists ? t('added') : t('add')),
          );
        }),
      );

    const search = () => {
      let provider: LibraryProvider = PROVIDERS[0];
      const src = h(
        'select',
        { class: 'gjscr-input', style: 'width:auto', onchange: () => ((provider = PROVIDERS.find((p) => p.id === src.value) || PROVIDERS[0]), run()) },
        PROVIDERS.map((p) => h('option', { value: p.id }, p.label)),
      );
      const q = h('input', { class: 'gjscr-input', type: 'search', placeholder: t('searchPackages'), autocomplete: 'off', spellcheck: 'false' });
      const results = h('ul', { class: 'gjscr-liblist' });
      const detail = h('div', { class: 'gjscr-libdetail' });
      const msg = h('div', { class: 'gjscr-hint' });
      let seq = 0;
      const run = async () => {
        const query = q.value.trim();
        detail.replaceChildren();
        if (query.length < 2) return results.replaceChildren();
        const my = ++seq;
        msg.textContent = t('searching');
        try {
          const hits = await provider.search(http, query);
          if (my !== seq) return;
          msg.textContent = hits.length ? '' : t('noMatch');
          results.replaceChildren(
            ...hits.map((hit) =>
              h(
                'li',
                { tabindex: 0, class: 'is-clickable', onclick: () => void pick(hit.name, hit.version), onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && void pick(hit.name, hit.version) },
                h('div', { class: 'gjscr-main' }, h('b', {}, hit.name), ' ', h('small', {}, hit.version || ''), hit.description ? h('div', { class: 'gjscr-sub' }, hit.description) : null),
              ),
            ),
          );
        } catch (e) {
          if (my !== seq) return;
          msg.textContent = `${t('loadError', (e as Error).message)} ${t('corsHint')}`;
        }
      };
      const pick = async (name: string, preferred?: string) => {
        detail.replaceChildren(h('div', { class: 'gjscr-hint' }, t('searching')));
        try {
          const { versions, latest } = await provider.versions(http, name);
          const ver = h('select', { class: 'gjscr-input', style: 'width:auto' }, versions.slice(0, 80).map((v) => h('option', { value: v, selected: v === (latest || preferred) }, v)));
          const filesBox = h('div', { class: 'gjscr-files' });
          const global = h('input', { class: 'gjscr-input', type: 'text', spellcheck: 'false', placeholder: 'Swiper' });
          let files: PackageFile[] = [];
          const loadFiles = async () => {
            filesBox.replaceChildren(h('div', { class: 'gjscr-hint' }, t('searching')));
            const res = await provider.files(http, name, ver.value);
            files = res.files;
            const sorted = files.slice().sort((a, b) => Number(res.defaults.includes(b.path)) - Number(res.defaults.includes(a.path)) || Number(/\.min\./.test(b.path)) - Number(/\.min\./.test(a.path)));
            filesBox.replaceChildren(
              ...sorted.slice(0, 150).map((f) =>
                h('label', { class: 'gjscr-check' }, h('input', { type: 'checkbox', value: f.path, checked: res.defaults.includes(f.path) }), h('code', {}, f.path), f.integrity ? h('small', {}, ` · ${t('sriNote')}`) : null),
              ),
            );
          };
          ver.addEventListener('change', () => void loadFiles().catch((e) => (filesBox.textContent = t('loadError', e.message))));
          detail.replaceChildren(
            h('h4', {}, name),
            h('div', { class: 'gjscr-field' }, h('span', { class: 'gjscr-label' }, t('version')), ver),
            h('div', { class: 'gjscr-field' }, h('span', { class: 'gjscr-label' }, t('files')), filesBox),
            h('div', { class: 'gjscr-field' }, h('span', { class: 'gjscr-label' }, t('global')), global),
            h(
              'div',
              { class: 'gjscr-actions' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'gjscr-primary',
                  onclick: () => {
                    const chosen = Array.from(filesBox.querySelectorAll<HTMLInputElement>('input:checked')).map((i) => files.find((f) => f.path === i.value)!).filter(Boolean);
                    if (!chosen.length) return;
                    // CSS before JS keeps the page from flashing unstyled.
                    chosen.sort((a, b) => (a.type === b.type ? 0 : a.type === 'css' ? -1 : 1));
                    add({ name, version: ver.value, source: provider.id, files: toLibraryFiles(chosen), ...(global.value.trim() ? { global: global.value.trim() } : {}) });
                  },
                },
                t('add'),
              ),
            ),
          );
          await loadFiles();
        } catch (e) {
          detail.replaceChildren(h('div', { class: 'gjscr-err' }, `${t('loadError', (e as Error).message)} ${t('corsHint')}`));
        }
      };
      let timer: ReturnType<typeof setTimeout> | null = null;
      q.addEventListener('input', () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void run(), 350);
      });
      return h('div', {}, h('div', { class: 'gjscr-inline' }, src, q), msg, h('div', { class: 'gjscr-libsplit' }, results, detail));
    };

    const byUrl = () => {
      const name = h('input', { class: 'gjscr-input', type: 'text', placeholder: 'my-lib' });
      const urls = h('textarea', { class: 'gjscr-input', rows: 4, spellcheck: 'false', placeholder: 'https://cdn.jsdelivr.net/npm/…/x.min.js' });
      const err = h('div', { class: 'gjscr-msg' });
      return h(
        'div',
        {},
        h('div', { class: 'gjscr-field' }, h('label', {}, t('libName')), name),
        h('div', { class: 'gjscr-field' }, h('label', {}, t('urls')), urls),
        err,
        h(
          'div',
          { class: 'gjscr-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'gjscr-primary',
              onclick: () => {
                const list = urls.value.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
                if (!list.length) return void (err.textContent = t('urls'));
                add({ name: name.value.trim() || undefined, source: 'url', files: list.map((url) => ({ url, type: fileTypeOf(url) })) });
              },
            },
            t('add'),
          ),
        ),
      );
    };

    const root = h('div', { class: 'gjscr-modal gjscr-libdialog' }, h('div', { class: 'gjscr-tabs' }, tabs.popular, tabs.search, tabs.url), body);
    openModal(editor, t('addLibrary'), root, () => finish(null));
    show('popular');
  });
}

/** Library rows for the settings dialog (enable, pages, loading, order, delete). */
export function librariesEditor(editor: Editor, manager: ScriptsManager, t: Translator, pages: { id: string; name: string }[], onAdd: () => void): HTMLElement {
  const box = h('div', { class: 'gjscr-libs' });
  const render = () => {
    const libs = manager.libraries();
    box.replaceChildren(
      ...(libs.length
        ? libs.map((lib, i) => {
            const set = (patch: Partial<Library>) => (manager.updateLibrary(lib.id, patch), render());
            const load = h(
              'select',
              { class: 'gjscr-input', style: 'width:auto', title: t('loadMode'), onchange: () => set({ load: load.value as Library['load'] }) },
              ['defer', 'async', 'module', 'blocking'].map((v) => h('option', { value: v, selected: (lib.load || 'defer') === v }, v)),
            );
            const pagesBox =
              pages.length > 1
                ? h(
                    'details',
                    {},
                    h('summary', {}, lib.pages?.length ? t('pagesCount', lib.pages.length) : t('allPages')),
                    pages.map((p) =>
                      h(
                        'label',
                        { class: 'gjscr-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: !!lib.pages?.includes(p.id),
                          onchange: (e: Event) => {
                            const next = new Set(lib.pages || []);
                            if ((e.target as HTMLInputElement).checked) next.add(p.id);
                            else next.delete(p.id);
                            set({ pages: Array.from(next) });
                          },
                        }),
                        p.name,
                      ),
                    ),
                  )
                : null;
            return h(
              'div',
              { class: `gjscr-lib${lib.enabled ? '' : ' is-off'}` },
              h(
                'div',
                { class: 'gjscr-libhead' },
                h('label', { class: 'gjscr-check' }, h('input', { type: 'checkbox', checked: lib.enabled, onchange: (e: Event) => set({ enabled: (e.target as HTMLInputElement).checked }) }), h('b', {}, lib.name), lib.version ? h('small', {}, ` ${lib.version}`) : null),
                h('span', { class: 'gjscr-spacer' }),
                h('button', { type: 'button', class: 'gjscr-act', title: t('moveUp'), disabled: i === 0, onclick: () => (manager.moveLibrary(lib.id, i - 1), render()) }, '↑'),
                h('button', { type: 'button', class: 'gjscr-act', title: t('moveDown'), disabled: i === libs.length - 1, onclick: () => (manager.moveLibrary(lib.id, i + 1), render()) }, '↓'),
                h('button', { type: 'button', class: 'gjscr-act', title: t('remove'), onclick: () => (manager.removeLibrary(lib.id), render()) }, '×'),
              ),
              h('ul', { class: 'gjscr-libfiles' }, lib.files.map((f) => h('li', {}, h('code', {}, f.url), f.integrity ? h('small', {}, ` · ${t('sriNote')}`) : null))),
              lib.files.some((f) => f.type === 'js')
                ? h('div', { class: 'gjscr-inline' }, load, h('label', { class: 'gjscr-check' }, h('input', { type: 'checkbox', checked: !!lib.inCanvas, onchange: (e: Event) => set({ inCanvas: (e.target as HTMLInputElement).checked }) }), t('inCanvas')))
                : null,
              pagesBox,
            );
          })
        : [h('div', { class: 'gjscr-hint' }, t('noLibraries'))]),
      h('button', { type: 'button', class: 'gjscr-secondary', style: 'margin-top:8px', onclick: onAdd }, `+ ${t('addLibrary')}`),
    );
  };
  render();
  const off = () => editor.off('scripts:change', onChange);
  const onChange = (e: { type?: string }) => e?.type === 'libraries' && box.isConnected && render();
  editor.on('scripts:change', onChange);
  (box as any).__off = off;
  return box;
}
