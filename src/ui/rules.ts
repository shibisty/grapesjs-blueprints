import { parseRules, ruleString, type ScopeRule } from '../core/code';
import type { TargetChoice } from '../integration/pages';
import type { Translator } from '../i18n';
import { h, icon } from './dom';

export interface RulesEditorOptions {
  t: Translator;
  /** Pages, layouts, templates and components of grapesjs-site-pages. */
  choices: () => TargetChoice[];
  /** The rules as stored (`target.pages` / `pages`). */
  value: string[];
  onChange(value: string[]): void;
}

const PAGE_GROUPS: TargetChoice['group'][] = ['page', 'layout', 'template'];

/** "page = Home, Blog · ≠ Cart · component = Footer" — for list sublines. */
export function rulesText(t: Translator, value: string[] | undefined, names: Map<string, string>): string {
  const rules = parseRules(value);
  if (!rules.length) return '';
  const part = (on: ScopeRule['on'], op: ScopeRule['op']) => {
    const ids = rules.filter((r) => r.on === on && r.op === op).map((r) => names.get(r.id) || r.id);
    return ids.length ? `${on === 'page' ? t('condPage') : t('condComponent')} ${op === 'eq' ? '=' : '≠'} ${ids.join(', ')}` : '';
  };
  return [part('page', 'eq'), part('page', 'ne'), part('component', 'eq'), part('component', 'ne')].filter(Boolean).join(' · ');
}

/**
 * Conditions of a "unique" item: rows of [page | component] [is | is not]
 * [record], an "add" button. "Is" rows are joined with OR, "is not" ones
 * with AND. Re-renders itself on every change.
 */
export function rulesEditor(o: RulesEditorOptions): HTMLElement {
  const { t } = o;
  const root = h('div', { class: 'gjscr-rules' });
  let rules: ScopeRule[] = parseRules(o.value);

  const emit = () => o.onChange(rules.filter((r) => r.id).map(ruleString));

  const render = () => {
    const choices = o.choices();
    const of = (on: ScopeRule['on']) => choices.filter((c) => (on === 'component' ? c.group === 'component' : PAGE_GROUPS.includes(c.group)));
    const hasComponents = of('component').length > 0 || rules.some((r) => r.on === 'component');
    const groupName: Record<TargetChoice['group'], string> = {
      page: t('targetPages'),
      layout: t('targetLayouts'),
      template: t('targetTemplates'),
      component: t('condComponents'),
    };
    const rows = rules.map((r, i) => {
      const list = of(r.on);
      const known = list.some((c) => c.id === r.id);
      const onSel = h(
        'select',
        {
          class: 'gjscr-input',
          'data-role': 'on',
          'aria-label': t('conditions'),
          onchange: () => {
            const on = onSel.value as ScopeRule['on'];
            rules[i] = { on, op: rules[i].op, id: of(on)[0]?.id || '' };
            emit();
            render();
          },
        },
        h('option', { value: 'page', selected: r.on === 'page' }, t('condPage')),
        hasComponents ? h('option', { value: 'component', selected: r.on === 'component' }, t('condComponent')) : null,
      );
      const opSel = h(
        'select',
        {
          class: 'gjscr-input gjscr-rule-op',
          'data-role': 'op',
          'aria-label': t('conditions'),
          onchange: () => {
            rules[i] = { ...rules[i], op: opSel.value as ScopeRule['op'] };
            emit();
          },
        },
        h('option', { value: 'eq', selected: r.op === 'eq' }, t('condIs')),
        h('option', { value: 'ne', selected: r.op === 'ne' }, t('condIsNot')),
      );
      const groups = r.on === 'component' ? (['component'] as TargetChoice['group'][]) : PAGE_GROUPS;
      const idSel = h(
        'select',
        {
          class: 'gjscr-input',
          'data-role': 'id',
          'aria-label': t('conditions'),
          onchange: () => {
            rules[i] = { ...rules[i], id: idSel.value };
            emit();
          },
        },
        ...groups
          .map((g) => {
            const items = list.filter((c) => c.group === g);
            if (!items.length) return null;
            const opts = items.map((c) => h('option', { value: c.id, selected: c.id === r.id }, c.name));
            return groups.length > 1 ? h('optgroup', { label: groupName[g] }, ...opts) : opts;
          })
          .flat(),
        // A record that is gone stays visible, so it can be changed or removed.
        !known && r.id ? h('option', { value: r.id, selected: true }, `${r.id} (${t('condGone')})`) : null,
      );
      const del = h(
        'button',
        {
          class: 'gjscr-act',
          type: 'button',
          'data-role': 'remove',
          title: t('remove'),
          'aria-label': t('remove'),
          onclick: () => {
            rules.splice(i, 1);
            emit();
            render();
          },
        },
        icon('trash', 14),
      );
      return h('div', { class: 'gjscr-rule', 'data-on': r.on, 'data-op': r.op }, onSel, opSel, idSel, del);
    });
    const add = h(
      'button',
      {
        class: 'gjscr-btn',
        type: 'button',
        'data-role': 'add-rule',
        onclick: () => {
          const first = of('page')[0] || of('component')[0];
          rules.push({ on: first?.group === 'component' ? 'component' : 'page', op: 'eq', id: first?.id || '' });
          emit();
          render();
        },
      },
      `+ ${t('addCondition')}`,
    );
    root.replaceChildren(
      ...rows,
      add,
      h('small', { class: 'gjscr-hint' }, rules.length ? t('conditionsHint') : t('noConditions')),
    );
  };
  render();
  return root;
}
