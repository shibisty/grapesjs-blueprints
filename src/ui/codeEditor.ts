import type { Editor } from 'grapesjs';
import type { BlueprintKind, ComponentSpec } from 'blueprintsjs';
import { isValidComponentType, type ScriptsManager } from '../core/ScriptsManager';
import { jsSyntaxError, type CodeItem, type CodeRun } from '../core/code';
import type { TargetChoice } from '../integration/pages';
import { pagesComponentOf } from '../integration/components';
import type { Translator } from '../i18n';
import { contentSelect } from './content';
import { h, icon } from './dom';
import { isValidSelector } from './modals';

type Param = NonNullable<ComponentSpec['params']>[number];

export interface CodeEditorOptions {
  t: Translator;
  /** Where a template item can apply (pages; with grapesjs-site-pages also layouts, templates). */
  choices: () => TargetChoice[];
  /** Picks a selector on the canvas (the eyedropper next to the condition). */
  pickSelector?: () => Promise<string | null>;
  /** Mount into this element (a workspace tab); without it the editor covers the page. */
  parent?: HTMLElement;
  /** How many GrapesJS rules a CSS text makes (shown under CSS). */
  cssRules?: (code: string) => number;
  /** Linked components of grapesjs-site-pages a component can take as its content. */
  pagesComponents?: () => Array<{ id: string; name: string }>;
  /** Debounce of saving while typing, ms. */
  saveDelay?: number;
  onClosed?: () => void;
}

/** A code area: GrapesJS' CodeMirror when there is one, a textarea otherwise. */
interface CodeArea {
  el: HTMLElement;
  get(): string;
  set(v: string): void;
  refresh(): void;
}

function codeArea(editor: Editor, mode: 'javascript' | 'css' | 'htmlmixed', value: string, onChange: (v: string) => void, cls: string): CodeArea {
  try {
    const cm = (editor as any).CodeManager;
    const viewer = cm?.createViewer?.({
      codeName: mode,
      readOnly: false,
      autoFormat: false,
      lineNumbers: true,
      lineWrapping: false,
      theme: 'hopscotch',
      tabSize: 2,
      indentUnit: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
    });
    const ed = viewer?.getEditor?.();
    if (!viewer || !ed) throw new Error('no CodeMirror');
    ed.setValue(value);
    ed.clearHistory?.();
    ed.on('change', () => onChange(ed.getValue()));
    // Keys typed here are not GrapesJS shortcuts (Delete, Ctrl+Z…).
    const el = h('div', { class: `gjscr-cm ${cls}` }, viewer.getElement());
    el.addEventListener('keydown', (e) => e.stopPropagation());
    return {
      el,
      get: () => ed.getValue(),
      set: (v) => v !== ed.getValue() && ed.setValue(v),
      refresh: () => ed.refresh(),
    };
  } catch {
    const ta = h('textarea', { class: `gjscr-code-input ${cls}`, spellcheck: 'false', wrap: 'off' }) as HTMLTextAreaElement;
    ta.value = value;
    ta.addEventListener('input', () => onChange(ta.value));
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b } = ta;
        ta.setRangeText('  ', a, b, 'end');
        onChange(ta.value);
      }
    });
    return { el: ta, get: () => ta.value, set: (v) => (ta.value = v), refresh: () => undefined };
  }
}

/**
 * The editor of one JS / CSS item: name, kind, where it applies, run time,
 * component settings, and the code (CodeMirror of GrapesJS). Changes are
 * saved while typing (debounced) and on close.
 */
export class CodeEditorView {
  readonly root: HTMLDivElement;
  private item: CodeItem;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private closed = false;
  private readonly code: CodeArea;
  private readonly status: HTMLDivElement;
  private readonly side: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly offs: Array<() => void> = [];
  private htmlArea: CodeArea | null = null;
  private cssArea: CodeArea | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly manager: ScriptsManager,
    readonly id: string,
    private readonly o: CodeEditorOptions,
  ) {
    const t = o.t;
    const item = manager.getCode(id);
    if (!item) throw new Error(`[grapesjs-scripts] no code item "${id}"`);
    this.item = item;
    this.nameInput = h('input', {
      class: 'gjscr-input gjscr-ce-name',
      type: 'text',
      value: item.name,
      'aria-label': t('name'),
      oninput: () => this.patch({ name: this.nameInput.value }),
      onblur: () => {
        if (!this.nameInput.value.trim()) this.nameInput.value = this.item.name;
      },
    });
    const enabled = h('input', { type: 'checkbox', checked: item.enabled, onchange: () => this.patch({ enabled: enabled.checked }, true) });
    const done = h('button', { class: 'gjscr-btn gjscr-primary', type: 'button', onclick: () => this.close() }, t('done'));
    this.code = codeArea(editor, item.lang === 'css' ? 'css' : 'javascript', item.code, (v) => this.patch({ code: v }), 'gjscr-ce-code');
    this.status = h('div', { class: 'gjscr-ce-status', role: 'status' });
    this.hint = h('div', { class: 'gjscr-ce-hint' });
    this.side = h('div', { class: 'gjscr-ce-side' });
    this.root = h(
      'div',
      { class: `gjscr-ce gjs-one-bg gjs-two-color${o.parent ? ' gjscr-ce--embedded' : ''}`, role: 'dialog', 'aria-label': `${t('codeTitle')}: ${item.name}`, 'data-lang': item.lang },
      h(
        'div',
        { class: 'gjscr-ce-head' },
        h('span', { class: 'gjscr-ce-lang' }, item.lang.toUpperCase()),
        this.nameInput,
        h('label', { class: 'gjscr-check gjscr-ce-on' }, enabled, t('enabled')),
        done,
      ),
      h('div', { class: 'gjscr-ce-body' }, h('div', { class: 'gjscr-ce-main' }, this.hint, this.code.el, this.status), this.side),
    );
    // Esc closes (outside the code areas, where it belongs to CodeMirror).
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.gjscr-cm, textarea')) {
        e.stopPropagation();
        this.close();
      }
    });
    const onCode = (p: { action: string; item: CodeItem }) => {
      if (p?.item?.id !== this.id) return;
      if (p.action === 'remove') this.close(false);
      else if (!this.dirty) this.sync(p.item);
    };
    editor.on('scripts:code', onCode);
    this.offs.push(() => editor.off('scripts:code', onCode));
    const onTargets = () => this.renderSide();
    editor.on('scripts:targets', onTargets);
    this.offs.push(() => editor.off('scripts:targets', onTargets));
    this.renderSide();
    this.renderStatus();
    (o.parent || document.body).appendChild(this.root);
    setTimeout(() => {
      this.code.refresh();
      this.htmlArea?.refresh();
      this.cssArea?.refresh();
    });
  }

  /** The item as edited now (a copy). */
  get value(): CodeItem {
    return JSON.parse(JSON.stringify(this.item));
  }

  /** Re-measures the code areas (a hidden tab shown again). */
  refresh(): void {
    this.code.refresh();
    this.htmlArea?.refresh();
    this.cssArea?.refresh();
  }

  /** Saves pending changes now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || !this.manager.getCode(this.id)) return;
    this.dirty = false;
    const saved = this.manager.updateCode(this.id, this.item);
    // The manager may fix things (a taken component type): show what is stored.
    if (JSON.stringify(saved) !== JSON.stringify(this.item)) this.sync(saved);
  }

  /** Saves and removes the editor. `save` false: the item is gone, nothing to save. */
  close(save = true): void {
    if (this.closed) return;
    if (save) this.flush();
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.offs.splice(0).forEach((f) => f());
    this.root.remove();
    this.root.dispatchEvent(new CustomEvent('gjscr:closed'));
    this.o.onClosed?.();
  }

  private patch(p: Partial<CodeItem>, now = false): void {
    this.item = { ...this.item, ...p };
    this.dirty = true;
    if ('code' in p) this.renderStatus();
    if (this.timer) clearTimeout(this.timer);
    if (now) this.flush();
    else this.timer = setTimeout(() => this.flush(), this.o.saveDelay ?? 300);
  }

  /** Takes a stored version (an outside change, a fix by the manager). */
  private sync(item: CodeItem): void {
    const kindChanged = item.kind !== this.item.kind;
    this.item = item;
    if (document.activeElement !== this.nameInput) this.nameInput.value = item.name;
    this.code.set(item.code);
    if (kindChanged) this.renderSide();
    this.renderStatus();
  }

  private renderStatus(): void {
    const t = this.o.t;
    const c = this.item;
    const lines = c.code ? c.code.split('\n').length : 0;
    const err = c.lang === 'js' ? jsSyntaxError(c.code) : null;
    this.status.classList.toggle('is-error', !!err);
    const size = c.lang === 'css' && this.o.cssRules ? t('cssRules', this.o.cssRules(c.code)) : t('codeLines', lines);
    this.status.textContent = [err ? t('syntaxError', err) : c.lang === 'js' ? t('syntaxOk') : '', size].filter(Boolean).join(' · ');
    this.hint.textContent = c.lang === 'css' ? t('cssHint') : c.kind === 'component' ? t('componentCodeHint') : t('pageCodeHint');
  }

  /* -------------------------------------------------------------- side */

  private field(label: string, ...content: (Node | string | null)[]): HTMLElement {
    return h('div', { class: 'gjscr-field' }, h('span', { class: 'gjscr-label' }, label), ...content);
  }

  private renderSide(): void {
    const t = this.o.t;
    const c = this.item;
    const kinds: BlueprintKind[] = ['global', 'template', 'component'];
    const kindName: Record<BlueprintKind, string> = { global: t('kindGlobal'), template: t('kindTemplate'), component: t('kindComponent') };
    const kind = h(
      'select',
      {
        class: 'gjscr-input',
        'aria-label': t('kind'),
        onchange: () => {
          this.patch({ kind: kind.value as BlueprintKind }, true);
          this.renderSide();
          this.renderStatus();
        },
      },
      kinds.map((k) => h('option', { value: k, selected: c.kind === k }, kindName[k])),
    );
    const parts: (HTMLElement | null)[] = [this.field(t('kind'), kind)];
    if (c.lang === 'js' && c.kind !== 'component') parts.push(this.runField());
    if (c.kind === 'template') parts.push(...this.targetFields());
    if (c.kind === 'component' && c.lang === 'js') parts.push(...this.componentFields());
    if (c.kind === 'component' && c.lang === 'css') parts.push(this.componentTypeField());
    this.htmlArea = this.htmlArea && this.side.contains(this.htmlArea.el) ? this.htmlArea : null;
    this.side.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  }

  private runField(): HTMLElement {
    const t = this.o.t;
    const runs: [CodeRun, string][] = [
      ['ready', t('runReady')],
      ['load', t('runLoad')],
      ['now', t('runNow')],
    ];
    const sel = h(
      'select',
      { class: 'gjscr-input', 'aria-label': t('run'), onchange: () => this.patch({ run: sel.value as CodeRun }, true) },
      runs.map(([v, l]) => h('option', { value: v, selected: (this.item.run || 'ready') === v }, l)),
    );
    return this.field(t('run'), sel);
  }

  private targetFields(): HTMLElement[] {
    const t = this.o.t;
    const target = this.item.target || { pages: [] };
    const chosen = new Set(target.pages || []);
    const choices = this.o.choices();
    const set = (pages: string[]) => this.patch({ target: { ...this.item.target, pages } }, true);
    const all = h('input', {
      type: 'checkbox',
      checked: !chosen.size,
      onchange: () => {
        if (all.checked) set([]);
        this.renderSide();
      },
    });
    const groups: [TargetChoice['group'], string][] = [
      ['page', t('targetPages')],
      ['layout', t('targetLayouts')],
      ['template', t('targetTemplates')],
    ];
    const lists = groups
      .map(([g, label]) => {
        const items = choices.filter((c) => c.group === g);
        if (!items.length) return null as HTMLElement | null;
        return h(
          'div',
          { class: 'gjscr-tgroup', 'data-group': g },
          h('div', { class: 'gjscr-tgroup-title' }, label),
          items.map((c) =>
            h(
              'label',
              { class: 'gjscr-check' },
              h('input', {
                type: 'checkbox',
                value: c.id,
                checked: chosen.has(c.id),
                onchange: (e: Event) => {
                  const box = e.target as HTMLInputElement;
                  const next = new Set(this.item.target?.pages || []);
                  if (box.checked) next.add(c.id);
                  else next.delete(c.id);
                  set(Array.from(next));
                  all.checked = !next.size;
                },
              }),
              c.name,
            ),
          ),
        ) as HTMLElement;
      })
      .filter((x): x is HTMLElement => !!x);
    // Ids that are no longer there (a deleted page) stay visible, so they can be unticked.
    const known = new Set(choices.map((c) => c.id));
    const gone = Array.from(chosen).filter((id) => !known.has(id));
    const when = h('input', {
      class: 'gjscr-input',
      type: 'text',
      value: target.when || '',
      placeholder: 'body.tpl-product',
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': t('condition'),
      oninput: () => {
        const v = when.value.trim();
        when.classList.toggle('is-invalid', !!v && !isValidSelector(v));
        if (!v || isValidSelector(v)) this.patch({ target: { ...this.item.target, when: v || undefined } });
      },
    });
    const pick = this.o.pickSelector
      ? h(
          'button',
          {
            class: 'gjscr-act',
            type: 'button',
            title: t('pickTitle'),
            onclick: async () => {
              const sel = await this.o.pickSelector!();
              if (!sel) return;
              when.value = sel;
              this.patch({ target: { ...this.item.target, when: sel } }, true);
            },
          },
          icon('pick', 14),
        )
      : null;
    return [
      this.field(
        t('targets'),
        h('label', { class: 'gjscr-check' }, all, t('allPages')),
        ...lists,
        ...gone.map((id) =>
          h('label', { class: 'gjscr-check is-gone' }, h('input', { type: 'checkbox', checked: true, onchange: () => set((this.item.target?.pages || []).filter((x) => x !== id)) }), id),
        ),
      ),
      this.field(t('condition'), h('div', { class: 'gjscr-row' }, when, pick), h('small', { class: 'gjscr-hint' }, t('conditionHint'))),
    ];
  }

  private componentFields(): HTMLElement[] {
    const t = this.o.t;
    const spec = (this.item.component || { type: '' }) as ComponentSpec;
    const setSpec = (p: Partial<ComponentSpec>, now = false) => this.patch({ component: { ...(this.item.component as ComponentSpec), ...p } }, now);
    const type = h('input', {
      class: 'gjscr-input',
      type: 'text',
      value: spec.type,
      spellcheck: 'false',
      'aria-label': t('componentType'),
      oninput: () => {
        const ok = isValidComponentType(type.value) && !this.manager.componentTypes(this.id).includes(type.value);
        type.classList.toggle('is-invalid', !ok);
        if (ok) setSpec({ type: type.value });
      },
    });
    const label = h('input', { class: 'gjscr-input', type: 'text', value: spec.label || '', 'aria-label': t('componentLabel'), oninput: () => setSpec({ label: label.value }) });
    this.htmlArea = codeArea(this.editor, 'htmlmixed', spec.html || '', (v) => setSpec({ html: v }), 'gjscr-ce-small');
    this.cssArea = codeArea(this.editor, 'css', spec.css || '', (v) => setSpec({ css: v || undefined }), 'gjscr-ce-small');
    setTimeout(() => (this.htmlArea?.refresh(), this.cssArea?.refresh()));
    const htmlField = this.field(t('componentHtml'), this.htmlArea.el);
    const linked = pagesComponentOf(spec);
    const available = this.o.pagesComponents?.() || [];
    let contentField: HTMLElement | null = null;
    if (available.length || linked) {
      const sel = contentSelect(t, available, linked, (id) => {
        setSpec({ pagesComponent: id || undefined } as Partial<ComponentSpec>, true);
        htmlField.hidden = !!id;
        if (!id) setTimeout(() => this.htmlArea?.refresh());
      });
      contentField = this.field(t('componentContent'), sel, h('small', { class: 'gjscr-hint' }, t('pagesComponentHint')));
      htmlField.hidden = !!linked;
    }
    return [
      this.field(t('componentType'), type),
      this.field(t('componentLabel'), label),
      ...(contentField ? [contentField] : []),
      htmlField,
      this.field(t('componentCss'), this.cssArea.el),
      this.paramsField(spec.params || [], (params) => setSpec({ params }, true)),
    ];
  }

  private paramsField(params: Param[], save: (p: Param[]) => void): HTMLElement {
    const t = this.o.t;
    const list = params.map((p) => ({ ...p }));
    const box = h('div', { class: 'gjscr-params' });
    const commit = () => save(list.filter((p) => p.id).map((p) => ({ ...p })));
    const render = () => {
      box.replaceChildren(
        ...list.map((p, i) => {
          const input = (key: 'id' | 'label', ph: string) =>
            h('input', {
              class: 'gjscr-input',
              type: 'text',
              value: (p[key] as string) || '',
              placeholder: ph,
              'aria-label': ph,
              oninput: (e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                (p as any)[key] = key === 'id' ? v.replace(/[^\w$]/g, '') : v;
                commit();
              },
            });
          const typeSel = h(
            'select',
            {
              class: 'gjscr-input',
              'aria-label': t('paramType'),
              onchange: (e: Event) => {
                p.type = (e.target as HTMLSelectElement).value as Param['type'];
                commit();
                render();
              },
            },
            (['string', 'number', 'boolean', 'select'] as const).map((v) => h('option', { value: v, selected: p.type === v }, v)),
          );
          const def = h('input', {
            class: 'gjscr-input',
            type: 'text',
            value: p.default == null ? '' : String(p.default),
            placeholder: t('paramDefault'),
            'aria-label': t('paramDefault'),
            oninput: (e: Event) => {
              p.default = (e.target as HTMLInputElement).value;
              commit();
            },
          });
          const opts =
            p.type === 'select'
              ? h('input', {
                  class: 'gjscr-input',
                  type: 'text',
                  value: (p.options || []).join(', '),
                  placeholder: t('paramOptions'),
                  'aria-label': t('paramOptions'),
                  oninput: (e: Event) => {
                    p.options = (e.target as HTMLInputElement).value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    commit();
                  },
                })
              : null;
          const del = h(
            'button',
            {
              class: 'gjscr-act',
              type: 'button',
              title: t('remove'),
              onclick: () => {
                list.splice(i, 1);
                commit();
                render();
              },
            },
            icon('trash', 14),
          );
          return h('div', { class: 'gjscr-param' }, input('id', t('paramId')), input('label', t('paramLabel')), typeSel, def, opts, del);
        }),
        h(
          'button',
          {
            class: 'gjscr-btn',
            type: 'button',
            onclick: () => {
              list.push({ id: `param${list.length + 1}`, label: '', type: 'string' });
              commit();
              render();
            },
          },
          icon('plus', 14),
          ' ',
          t('addParam'),
        ),
      );
    };
    render();
    return this.field(t('params'), box);
  }

  private componentTypeField(): HTMLElement {
    const t = this.o.t;
    const types = [
      ...this.manager.list('component').map((b) => ({ type: b.component?.type || '', name: b.component?.label || b.name })),
      ...this.manager.listCode('js', 'component').map((c) => ({ type: c.component?.type || '', name: c.component?.label || c.name })),
    ].filter((x) => x.type);
    const current = this.item.target?.componentType || '';
    if (!types.length) return this.field(t('styledComponent'), h('div', { class: 'gjscr-empty' }, t('noComponentTypes')));
    const sel = h(
      'select',
      {
        class: 'gjscr-input',
        'aria-label': t('styledComponent'),
        onchange: () => this.patch({ target: { componentType: sel.value } }, true),
      },
      h('option', { value: '', selected: !current, disabled: true }, t('chooseComponent')),
      types.map((x) => h('option', { value: x.type, selected: current === x.type }, `${x.name} <${x.type}>`)),
    );
    return this.field(t('styledComponent'), sel);
  }
}
