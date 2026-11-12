import { defaultProps } from '../core/registry';
import type { ComponentSpec, NodeDef, NodeInstance, PinType, PropDef, Variable } from '../core/types';
import { DATA_PIN_TYPES } from '../core/types';
import { diagnosticText, h, type Child } from './dom';
import type { GraphEditor } from './GraphEditor';

/** Right panel: the selected node's settings, or the blueprint's settings and variables; problems below. */
export class Details {
  readonly root: HTMLDivElement;
  private problemsEl: HTMLElement | null = null;

  constructor(private readonly ed: GraphEditor) {
    this.root = h('div', { class: 'bpe-details' });
  }

  private get t() {
    return this.ed.t;
  }

  private get state() {
    return this.ed.state;
  }

  focusProblems(): void {
    this.state.clearSelection();
    this.render();
    this.problemsEl?.scrollIntoView?.({ block: 'start' });
  }

  render(): void {
    // Keep focus in the field being edited across re-renders.
    const active = document.activeElement as HTMLElement | null;
    const key = active && this.root.contains(active) ? active.dataset.key : undefined;
    const sel = Array.from(this.state.selection).filter((id) => this.state.node(id));
    const kids: Child[] = [];
    if (sel.length === 1) kids.push(this.nodePanel(this.state.node(sel[0])!));
    else if (sel.length > 1) kids.push(this.multiPanel(sel.length));
    else if (this.state.selectedLink) kids.push(this.linkPanel());
    else kids.push(this.blueprintPanel());
    kids.push(this.problems());
    this.root.replaceChildren(...(kids.flat() as Node[]));
    if (key) this.root.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
  }

  /* ------------------------------------------------------------ node */

  private nodePanel(n: NodeInstance): Node[] {
    const t = this.t;
    const def = this.ed.registry.get(n.type);
    if (!def) {
      return [
        h('h3', {}, t('ui.unknownNode', 'Unknown block')),
        h('div', { class: 'bpe-type' }, n.type),
        h('p', {}, t('ui.unknownNodeHint', 'This block type is not available. Delete it or add its definition.')),
        h('button', { type: 'button', class: 'bpe-btn is-danger', onclick: () => this.state.deleteSelection() }, t('ui.delete', 'Delete')),
      ];
    }
    const props = { ...defaultProps(def), ...(n.props || {}) };
    const out: Node[] = [h('h3', {}, this.ed.nodeTitle(def, n.type)), h('div', { class: 'bpe-type' }, `${n.id} · ${n.type}`)];
    const desc = this.ed.nodeDesc(def);
    if (desc) out.push(h('p', {}, desc));
    const fields = (def.props || []).map((p) => this.propField(n, p, props[p.id]));
    if (fields.length) out.push(h('h4', {}, t('ui.settings', 'Settings')), ...fields);
    // Literal values of unconnected inputs (also editable on the node itself).
    const ports = this.ed.registry.ports(n);
    const lits = ports.inputs.filter((p) => p.type !== 'exec' && !p.noLiteral && !this.state.isLinked([n.id, p.id], 'in') && p.type !== 'event' && p.type !== 'object');
    if (lits.length) {
      out.push(h('h4', {}, t('ui.inputs', 'Inputs')));
      for (const p of lits) {
        const kind = p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : p.type === 'element' || p.type === 'elements' ? 'selector' : 'string';
        out.push(this.propField(n, { id: p.id, type: kind as PropDef['type'], label: p.label }, n.props && p.id in n.props ? n.props[p.id] : p.default));
      }
    }
    out.push(
      h('h4', {}, ''),
      h(
        'label',
        { class: 'bpe-check' },
        h('input', { type: 'checkbox', 'data-key': 'disabled', checked: !!n.disabled, onchange: (e: Event) => this.state.setNodeFlags(n.id, { disabled: (e.target as HTMLInputElement).checked }) }),
        t('ui.disabled', 'Disabled (skipped, execution passes through)'),
      ),
      h('div', { class: 'bpe-inline', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'bpe-btn is-danger', onclick: () => this.state.deleteSelection() }, t('ui.delete', 'Delete'))),
    );
    return out;
  }

  private propField(n: NodeInstance, p: PropDef, value: unknown): HTMLElement {
    const t = this.t;
    const label = this.ed.label(p.label, p.id);
    const key = `p:${n.id}:${p.id}`;
    const set = (v: unknown) => this.state.setProps(n.id, { [p.id]: v });
    let control: HTMLElement;
    switch (p.type) {
      case 'boolean':
        return h('label', { class: 'bpe-check' }, h('input', { type: 'checkbox', 'data-key': key, checked: value === true, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), label);
      case 'number': {
        const input = h('input', { type: 'number', 'data-key': key, onchange: () => set(input.value === '' ? 0 : Number(input.value)) });
        input.value = value == null ? '' : String(value);
        control = input;
        break;
      }
      case 'select': {
        const sel = h(
          'select',
          { 'data-key': key, onchange: () => set(sel.value) },
          (p.options || []).map((o) => h('option', { value: o.value, selected: o.value === value }, this.ed.label(o.label, o.value))),
        );
        control = sel;
        break;
      }
      case 'variable': {
        const vars = this.state.bp.variables;
        const sel = h(
          'select',
          {
            'data-key': key,
            onchange: () => {
              if (sel.value === '__new') {
                const v = this.state.addVariable();
                set(v.id);
              } else set(sel.value);
            },
          },
          h('option', { value: '' }, '—'),
          vars.map((v) => h('option', { value: v.id, selected: v.id === value }, v.name)),
          h('option', { value: '__new' }, t('ui.newVariable', '+ New variable')),
        );
        control = sel;
        break;
      }
      case 'code': {
        const ta = h('textarea', { 'data-key': key, spellcheck: 'false', rows: 10, onchange: () => set(ta.value) });
        ta.value = value == null ? '' : String(value);
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const s = ta.selectionStart;
            ta.setRangeText('  ', s, ta.selectionEnd, 'end');
          }
        });
        control = ta;
        break;
      }
      case 'pins':
        return this.pinsField(n, p, value, label);
      case 'selector': {
        const input = h('input', { type: 'text', 'data-key': key, spellcheck: 'false', placeholder: '.class, #id, [data-x]', onchange: () => set(input.value.trim()) });
        input.value = value == null ? '' : String(value);
        const pick = this.ed.options.pickSelector;
        control = pick
          ? h(
              'div',
              { class: 'bpe-inline' },
              input,
              h(
                'button',
                {
                  type: 'button',
                  class: 'bpe-btn',
                  title: t('ui.pick', 'Pick an element on the page'),
                  onclick: async () => {
                    const sel = await pick();
                    if (sel) set(sel);
                  },
                },
                '⌖',
              ),
            )
          : input;
        break;
      }
      default: {
        const listId = p.options?.length ? `bpe-dl-${n.id}-${p.id}` : null;
        const input = h('input', { type: 'text', 'data-key': key, spellcheck: 'false', list: listId, onchange: () => set(input.value) });
        input.value = value == null ? '' : String(value);
        control = listId ? h('div', {}, input, h('datalist', { id: listId }, (p.options || []).map((o) => h('option', { value: o.value }, this.ed.label(o.label, ''))))) : input;
      }
    }
    return h('div', { class: 'bpe-field' }, h('label', {}, label), control);
  }

  /** Editor of dynamic pins (JS code node): name + type rows. */
  private pinsField(n: NodeInstance, p: PropDef, value: unknown, label: string): HTMLElement {
    const t = this.t;
    const list = (Array.isArray(value) ? value : []) as { id: string; type: PinType }[];
    const save = (next: { id: string; type: PinType }[]) => this.state.setProps(n.id, { [p.id]: next });
    const rows = list.map((pin, i) => {
      const name = h('input', {
        type: 'text',
        'data-key': `pins:${n.id}:${p.id}:${i}`,
        spellcheck: 'false',
        onchange: () => {
          const v = name.value.trim().replace(/[^\w$]/g, '_');
          if (!/^[A-Za-z_$][\w$]*$/.test(v)) return void (name.value = pin.id);
          save(list.map((x, k) => (k === i ? { ...x, id: v } : x)));
        },
      });
      name.value = pin.id;
      const type = h(
        'select',
        { onchange: () => save(list.map((x, k) => (k === i ? { ...x, type: type.value as PinType } : x))) },
        DATA_PIN_TYPES.map((ty) => h('option', { value: ty, selected: ty === pin.type }, ty)),
      );
      return h('div', { class: 'bpe-row' }, name, type, h('button', { type: 'button', class: 'bpe-x', title: t('ui.remove', 'Remove'), onclick: () => save(list.filter((_, k) => k !== i)) }, '×'));
    });
    const add = h(
      'button',
      {
        type: 'button',
        class: 'bpe-add',
        onclick: () => {
          const used = new Set(list.map((x) => x.id));
          let k = list.length + 1;
          while (used.has(`${p.id === 'outputs' ? 'out' : 'in'}${k}`)) k++;
          save([...list, { id: `${p.id === 'outputs' ? 'out' : 'in'}${k}`, type: 'any' }]);
        },
      },
      t('ui.add', '+ Add'),
    );
    return h('div', { class: 'bpe-field' }, h('label', {}, label), ...rows, add);
  }

  private multiPanel(count: number): Node[] {
    const t = this.t;
    return [
      h('h3', {}, t('ui.selected', '%s blocks selected', count)),
      h(
        'div',
        { class: 'bpe-inline', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'bpe-btn', onclick: () => this.ed.commentSelection() }, t('ui.commentBtn', 'Comment')),
        h('button', { type: 'button', class: 'bpe-btn is-danger', onclick: () => this.state.deleteSelection() }, t('ui.delete', 'Delete')),
      ),
    ];
  }

  private linkPanel(): Node[] {
    const t = this.t;
    const l = this.state.selectedLink!;
    return [
      h('h3', {}, t('ui.wire', 'Wire')),
      h('p', {}, this.ed.describeLink(l)),
      h('button', { type: 'button', class: 'bpe-btn is-danger', onclick: () => this.state.deleteSelection() }, t('ui.delete', 'Delete')),
    ];
  }

  /* ------------------------------------------------------- blueprint */

  private blueprintPanel(): Node[] {
    const t = this.t;
    const bp = this.state.bp;
    const out: Node[] = [h('h3', {}, t('ui.blueprint', 'Script'))];
    const desc = h('textarea', { 'data-key': 'bp:desc', rows: 2, style: 'min-height:48px;font:inherit', onchange: () => this.state.setMeta({ description: desc.value.trim() || undefined }) });
    desc.value = bp.description || '';
    out.push(
      h('div', { class: 'bpe-field' }, h('label', {}, t('ui.description', 'Description')), desc),
      h('label', { class: 'bpe-check' }, h('input', { type: 'checkbox', 'data-key': 'bp:enabled', checked: bp.enabled, onchange: (e: Event) => this.state.setMeta({ enabled: (e.target as HTMLInputElement).checked }) }), t('ui.enabled', 'Enabled')),
    );
    if (bp.kind === 'template') out.push(...this.templateFields());
    if (bp.kind === 'component') out.push(...this.componentFields());
    out.push(...this.variables());
    out.push(
      h('h4', {}, t('ui.shortcuts', 'Shortcuts')),
      h(
        'div',
        { class: 'bpe-help' },
        ...helpLines(t).map(([k, v]) => h('div', {}, h('kbd', {}, k), ' ', v)),
      ),
    );
    return out;
  }

  private templateFields(): Node[] {
    const t = this.t;
    const bp = this.state.bp;
    const target = bp.target || {};
    const pages = this.ed.options.pages?.() || [];
    const out: Node[] = [h('h4', {}, t('ui.where', 'Where it runs'))];
    if (pages.length > 1) {
      const chosen = new Set(target.pages || []);
      const all = chosen.size === 0;
      out.push(
        h('label', { class: 'bpe-check' }, h('input', { type: 'checkbox', checked: all, onchange: (e: Event) => this.state.setMeta({ target: { ...target, pages: (e.target as HTMLInputElement).checked ? [] : pages.map((p) => p.id) } }) }), t('ui.allPages', 'All pages')),
        ...pages.map((p) =>
          h(
            'label',
            { class: 'bpe-check', style: 'padding-inline-start:18px' },
            h('input', {
              type: 'checkbox',
              disabled: all,
              checked: all || chosen.has(p.id),
              onchange: (e: Event) => {
                const next = new Set(chosen);
                if ((e.target as HTMLInputElement).checked) next.add(p.id);
                else next.delete(p.id);
                this.state.setMeta({ target: { ...target, pages: Array.from(next) } });
              },
            }),
            p.name,
          ),
        ),
      );
    }
    const when = h('input', { type: 'text', 'data-key': 'bp:when', spellcheck: 'false', placeholder: 'body.tpl-product' });
    when.value = target.when || '';
    const err = h('div', { class: 'bpe-err-msg' });
    const field = h('div', { class: 'bpe-field' }, h('label', {}, t('ui.condition', 'Condition (CSS selector)')), when, err);
    when.addEventListener('change', () => {
      const v = when.value.trim();
      if (v && !validSelector(v)) {
        field.classList.add('is-invalid');
        err.textContent = t('ui.badSelector', 'Invalid CSS selector');
        return;
      }
      const next = { ...target };
      if (v) next.when = v;
      else delete next.when;
      this.state.setMeta({ target: next });
    });
    out.push(field);
    return out;
  }

  private componentFields(): Node[] {
    const t = this.t;
    const c = (this.state.bp.component || { type: '' }) as ComponentSpec;
    const set = (patch: Partial<ComponentSpec>) => this.state.setMeta({ component: { ...c, ...patch } });
    const type = h('input', { type: 'text', 'data-key': 'c:type', spellcheck: 'false' });
    type.value = c.type;
    const err = h('div', { class: 'bpe-err-msg' });
    const typeField = h('div', { class: 'bpe-field' }, h('label', {}, t('ui.componentType', 'Component type')), type, err);
    type.addEventListener('change', () => {
      const v = type.value.trim();
      const msg = this.ed.options.validateComponentType?.(v) ?? (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(v) ? null : 'a-z, 0-9, "-" (bp-my-block)');
      if (msg) {
        typeField.classList.add('is-invalid');
        err.textContent = msg;
        return;
      }
      set({ type: v });
    });
    const label = h('input', { type: 'text', 'data-key': 'c:label', onchange: () => set({ label: label.value.trim() || undefined }) });
    label.value = c.label || '';
    const html = h('textarea', { 'data-key': 'c:html', spellcheck: 'false', rows: 5, style: 'min-height:80px', onchange: () => set({ html: html.value }) });
    html.value = c.html || '';
    const css = h('textarea', { 'data-key': 'c:css', spellcheck: 'false', rows: 5, style: 'min-height:80px', onchange: () => set({ css: css.value || undefined }) });
    css.value = c.css || '';
    const params = c.params || [];
    const saveParams = (next: NonNullable<ComponentSpec['params']>) => set({ params: next });
    const rows = params.map((p, i) => {
      const id = h('input', { type: 'text', spellcheck: 'false', title: 'id', onchange: () => /^[A-Za-z_$][\w$]*$/.test(id.value) && saveParams(params.map((x, k) => (k === i ? { ...x, id: id.value } : x))) });
      id.value = p.id;
      const lab = h('input', { type: 'text', placeholder: t('ui.label', 'Label'), onchange: () => saveParams(params.map((x, k) => (k === i ? { ...x, label: lab.value } : x))) });
      lab.value = p.label || '';
      const ty = h(
        'select',
        { onchange: () => saveParams(params.map((x, k) => (k === i ? { ...x, type: ty.value as any } : x))) },
        ['string', 'number', 'boolean', 'select'].map((v) => h('option', { value: v, selected: v === p.type }, v)),
      );
      const def = h('input', { type: 'text', placeholder: t('ui.default', 'Default'), onchange: () => saveParams(params.map((x, k) => (k === i ? { ...x, default: def.value } : x))) });
      def.value = p.default == null ? '' : String(p.default);
      return h('div', {}, h('div', { class: 'bpe-row' }, id, ty, h('button', { type: 'button', class: 'bpe-x', onclick: () => saveParams(params.filter((_, k) => k !== i)) }, '×')), h('div', { class: 'bpe-row' }, lab, def));
    });
    return [
      h('h4', {}, t('ui.component', 'Component')),
      typeField,
      h('div', { class: 'bpe-field' }, h('label', {}, t('ui.componentLabel', 'Block label')), label),
      h('div', { class: 'bpe-field' }, h('label', {}, 'HTML'), html),
      h('div', { class: 'bpe-field' }, h('label', {}, 'CSS'), css),
      h(
        'div',
        { class: 'bpe-field' },
        h('label', {}, t('ui.params', 'Parameters (traits)')),
        ...rows,
        h('button', { type: 'button', class: 'bpe-add', onclick: () => saveParams([...params, { id: `param${params.length + 1}`, type: 'string' }]) }, t('ui.add', '+ Add')),
      ),
    ];
  }

  private variables(): Node[] {
    const t = this.t;
    const vars = this.state.bp.variables;
    const row = (v: Variable) => {
      const name = h('input', { type: 'text', 'data-key': `v:${v.id}:name`, spellcheck: 'false', onchange: () => name.value.trim() && this.state.updateVariable(v.id, { name: name.value.trim() }) });
      name.value = v.name;
      const type = h(
        'select',
        { 'data-key': `v:${v.id}:type`, onchange: () => this.state.updateVariable(v.id, { type: type.value as Variable['type'], default: undefined }) },
        DATA_PIN_TYPES.filter((x) => x !== 'event' && x !== 'element' && x !== 'elements').map((ty) => h('option', { value: ty, selected: ty === v.type }, ty)),
      );
      const def = h('input', {
        type: v.type === 'number' ? 'number' : 'text',
        'data-key': `v:${v.id}:def`,
        placeholder: t('ui.default', 'Default'),
        onchange: () => {
          const raw = def.value;
          const val = v.type === 'number' ? Number(raw) || 0 : v.type === 'boolean' ? raw === 'true' : raw;
          this.state.updateVariable(v.id, { default: raw === '' ? undefined : val });
        },
      });
      def.value = v.default == null ? '' : String(v.default);
      return h('div', {}, h('div', { class: 'bpe-row' }, name, type, h('button', { type: 'button', class: 'bpe-x', title: t('ui.remove', 'Remove'), onclick: () => this.state.removeVariable(v.id) }, '×')), h('div', { class: 'bpe-row', style: 'margin-bottom:8px' }, def));
    };
    return [
      h('h4', {}, t('ui.variables', 'Variables'), h('button', { type: 'button', class: 'bpe-add', onclick: () => this.state.addVariable() }, t('ui.add', '+ Add'))),
      ...(vars.length ? vars.map(row) : [h('p', {}, t('ui.noVariables', 'Variables keep values between events (for example "is the menu open").'))]),
    ];
  }

  /* -------------------------------------------------------- problems */

  private problems(): Node {
    const t = this.t;
    const diags = this.state.diagnostics();
    const names = (id?: string) => {
      const n = id ? this.state.node(id) : undefined;
      return n ? this.ed.nodeTitle(this.ed.registry.get(n.type) as NodeDef, n.type) : '';
    };
    const list = h(
      'ul',
      { class: 'bpe-problems' },
      diags.length
        ? diags.map((d) =>
            h(
              'li',
              { class: d.severity === 'warning' ? 'is-warning' : 'is-error', onclick: () => d.nodeId && this.ed.focusNode(d.nodeId) },
              names(d.nodeId) ? `${names(d.nodeId)}: ${diagnosticText(t, d)}` : diagnosticText(t, d),
            ),
          )
        : h('li', { class: 'is-ok' }, t('ui.noProblems', 'No problems')),
    );
    const wrap = h('div', {}, h('h4', {}, `${t('ui.problems', 'Problems')} (${diags.length})`), list);
    this.problemsEl = wrap;
    return wrap;
  }
}

function validSelector(sel: string): boolean {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

function helpLines(t: GraphEditor['t']): [string, string][] {
  return [
    [t('ui.kRightClick', 'Right-click'), t('ui.hRightClick', 'add a block (also double-click, Tab)')],
    [t('ui.kDragPin', 'Drag a pin'), t('ui.hDragPin', 'connect; drop on empty space to add a connected block')],
    ['Alt + ' + t('ui.kClick', 'click'), t('ui.hAlt', 'break the wires of a pin / delete a wire')],
    [t('ui.kRightDrag', 'Right-drag'), t('ui.hPan', 'move the view (also Space + drag, mouse wheel to zoom)')],
    [t('ui.kDrag', 'Drag on empty'), t('ui.hMarquee', 'select with a frame (Shift adds)')],
    ['Ctrl+C / V / X / D', t('ui.hClipboard', 'copy, paste, cut, duplicate')],
    ['Ctrl+Z / Y', t('ui.hUndo', 'undo, redo')],
    ['Del', t('ui.hDelete', 'delete the selection')],
    ['C / F', t('ui.hCommentFit', 'comment around the selection / fit to screen')],
  ];
}
