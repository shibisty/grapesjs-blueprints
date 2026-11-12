import type { Editor } from 'grapesjs';
import type { BlueprintKind, Diagnostic } from '../blueprint';
import { componentTypeFrom, isValidComponentType, type CreateScriptInit, type ScriptsManager } from '../core/ScriptsManager';
import type { Translator } from '../i18n';
import { h } from './dom';
import { highlight } from './highlight';

/** Pages of the project (`editor.Pages`): id and a readable name. */
export function projectPages(editor: Editor): { id: string; name: string }[] {
  try {
    const all = ((editor as any).Pages?.getAll?.() || []) as any[];
    return all.map((p, i) => ({ id: String(p.getId?.() ?? p.id), name: String(p.getName?.() || p.get?.('name') || p.id || `#${i + 1}`) }));
  } catch {
    return [];
  }
}

export function isValidSelector(sel: string): boolean {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

export function openModal(editor: Editor, title: string, content: HTMLElement, onClose?: () => void) {
  const modal = editor.Modal as any;
  // Wrapped: GrapesJS appends the content with its own `$`, which treats a <form> (it has
  // `length`, the number of its fields) as a list of elements.
  const body = h('div', { class: 'gjscr-modal-body' }, content);
  modal.open({ title, content: body, attributes: { class: 'gjscr-modal-wrap' } });
  // GrapesJS parks replaced content in a hidden collector: drop ours when the modal closes.
  modal.onceClose?.(() => {
    body.remove();
    onClose?.();
  });
  return modal;
}

/**
 * New-script dialog. Resolves to the init for `ScriptsManager.create`, or `null` if cancelled.
 */
export function openCreateDialog(
  editor: Editor,
  manager: ScriptsManager,
  t: Translator,
  preset: { kind?: BlueprintKind } = {},
): Promise<CreateScriptInit | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: CreateScriptInit | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const pages = projectPages(editor);
    const name = h('input', { class: 'gjscr-input', type: 'text', id: 'gjscr-name', autocomplete: 'off', placeholder: t('defaultName') });
    const kinds: BlueprintKind[] = ['global', 'template', 'component'];
    const labels: Record<BlueprintKind, [string, string]> = {
      global: [t('kindGlobal'), t('kindGlobalHint')],
      template: [t('kindTemplate'), t('kindTemplateHint')],
      component: [t('kindComponent'), t('kindComponentHint')],
    };
    const radios = kinds.map((k) =>
      h('input', { type: 'radio', name: 'gjscr-kind', value: k, checked: (preset.kind || 'global') === k, onchange: () => sync() }),
    );
    const kindBox = h(
      'div',
      { class: 'gjscr-kinds', role: 'radiogroup' },
      kinds.map((k, i) => h('label', { class: 'gjscr-kind' }, radios[i], h('span', {}, h('b', {}, labels[k][0]), h('small', {}, labels[k][1])))),
    );

    // template
    const allPages = h('input', { type: 'checkbox', checked: true, onchange: () => sync() });
    const pageBoxes = pages.map((p) => ({ id: p.id, el: h('input', { type: 'checkbox', value: p.id }) }));
    const when = h('input', { class: 'gjscr-input', type: 'text', placeholder: 'body.tpl-product', autocomplete: 'off', spellcheck: 'false' });
    const templateBox = h(
      'div',
      {},
      pages.length > 1
        ? h(
            'div',
            { class: 'gjscr-field' },
            h('span', { class: 'gjscr-label' }, t('pages')),
            h(
              'div',
              { class: 'gjscr-pages' },
              h('label', { class: 'gjscr-check' }, allPages, t('allPages')),
              pageBoxes.map((b, i) => h('label', { class: 'gjscr-check' }, b.el, pages[i].name)),
            ),
          )
        : null,
      h('div', { class: 'gjscr-field' }, h('label', { for: 'gjscr-when' }, t('condition')), when, h('small', { class: 'gjscr-hint' }, t('conditionHint'))),
    );
    when.id = 'gjscr-when';

    // component
    let typeEdited = false;
    const ctype = h('input', {
      class: 'gjscr-input',
      type: 'text',
      id: 'gjscr-ctype',
      autocomplete: 'off',
      spellcheck: 'false',
      oninput: () => (typeEdited = true),
    });
    const clabel = h('input', { class: 'gjscr-input', type: 'text', id: 'gjscr-clabel', autocomplete: 'off' });
    const componentBox = h(
      'div',
      {},
      h('div', { class: 'gjscr-field' }, h('label', { for: 'gjscr-ctype' }, t('componentType')), ctype),
      h('div', { class: 'gjscr-field' }, h('label', { for: 'gjscr-clabel' }, t('componentLabel')), clabel),
    );
    const suggestType = () => {
      if (typeEdited) return;
      const base = componentTypeFrom(name.value || t('defaultName'), 'component');
      const used = new Set(manager.componentTypes());
      let type = base;
      let n = 2;
      while (used.has(type)) type = `${base}-${n++}`;
      ctype.value = type;
    };
    name.addEventListener('input', suggestType);

    const msg = h('div', { class: 'gjscr-msg', role: 'alert' });
    const kind = (): BlueprintKind => (radios.find((r) => r.checked)?.value as BlueprintKind) || 'global';
    const sync = () => {
      templateBox.hidden = kind() !== 'template';
      componentBox.hidden = kind() !== 'component';
      pageBoxes.forEach((b) => (b.el.disabled = allPages.checked));
      msg.textContent = '';
      suggestType();
    };

    const submit = (e?: Event) => {
      e?.preventDefault();
      const k = kind();
      const init: CreateScriptInit = { kind: k, name: name.value.trim() || undefined };
      [when, ctype].forEach((i) => i.classList.remove('is-invalid'));
      if (k === 'template') {
        const sel = when.value.trim();
        if (sel && !isValidSelector(sel)) {
          when.classList.add('is-invalid');
          msg.textContent = t('badSelector');
          when.focus();
          return;
        }
        init.target = { pages: allPages.checked ? [] : pageBoxes.filter((b) => b.el.checked).map((b) => b.id), ...(sel ? { when: sel } : {}) };
      }
      if (k === 'component') {
        const type = ctype.value.trim();
        if (!isValidComponentType(type) || manager.componentTypes().includes(type)) {
          ctype.classList.add('is-invalid');
          msg.textContent = manager.componentTypes().includes(type) ? t('typeTaken') : `${t('componentType')}: a-z, 0-9, “-” (bp-my-block)`;
          ctype.focus();
          return;
        }
        init.component = { type, label: clabel.value.trim() || undefined };
      }
      finish(init);
      (editor.Modal as any).close();
    };

    const form = h(
      'form',
      { class: 'gjscr-modal', onsubmit: submit as EventListener, novalidate: true },
      h('div', { class: 'gjscr-field' }, h('label', { for: 'gjscr-name' }, t('name')), name),
      h('div', { class: 'gjscr-field' }, h('span', { class: 'gjscr-label' }, t('kind')), kindBox),
      templateBox,
      componentBox,
      msg,
      h(
        'div',
        { class: 'gjscr-actions' },
        h('button', { type: 'button', class: 'gjscr-secondary', onclick: () => (editor.Modal as any).close() }, t('cancel')),
        h('button', { type: 'submit', class: 'gjscr-primary' }, t('create')),
      ),
    );
    sync();
    openModal(editor, t('newScript'), form, () => finish(null));
    setTimeout(() => name.focus(), 0);
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read-only code view with problems, Copy and Download. */
export function openCodeDialog(
  editor: Editor,
  t: Translator,
  o: { title: string; code: string; diagnostics: Diagnostic[]; fileName: string; names?: Map<string, string> },
): HTMLElement {
  const copyBtn = h('button', { type: 'button', class: 'gjscr-secondary' }, t('copy'));
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(o.code);
    copyBtn.textContent = ok ? t('copied') : t('copy');
    setTimeout(() => (copyBtn.textContent = t('copy')), 1500);
  });
  const diags = h(
    'ul',
    { class: 'gjscr-diags' },
    o.diagnostics.length
      ? o.diagnostics.map((d) =>
          h('li', { class: d.severity === 'warning' ? 'is-warning' : 'is-error' }, d.nodeId ? `${o.names?.get(d.nodeId) || d.nodeId}: ${d.message}` : d.message),
        )
      : h('li', { class: 'is-ok' }, t('noProblems')),
  );
  const root = h(
    'div',
    { class: 'gjscr-modal gjscr-codeview' },
    h(
      'div',
      { class: 'gjscr-codebar' },
      h('span', { class: 'gjscr-spacer' }),
      copyBtn,
      h('button', { type: 'button', class: 'gjscr-secondary', onclick: () => download(o.fileName, o.code) }, t('download')),
    ),
    diags,
    h('pre', { class: 'gjscr-code', tabindex: 0 }, highlight(o.code)),
  );
  openModal(editor, o.title, root);
  return root;
}
