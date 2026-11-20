import type { Translator } from '../i18n';
import { h } from './dom';

/**
 * What a new component instance holds: its own HTML, or a linked component of
 * grapesjs-site-pages (one that is gone stays listed by its id).
 */
export function contentSelect(
  t: Translator,
  available: Array<{ id: string; name: string }>,
  current: string,
  onChange: (id: string) => void,
): HTMLSelectElement {
  const items = available.some((m) => m.id === current) || !current ? available : [...available, { id: current, name: current }];
  return h(
    'select',
    { class: 'gjscr-input', name: 'content', 'aria-label': t('componentContent'), onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    h('option', { value: '', selected: !current }, t('ownHtml')),
    h('optgroup', { label: t('pagesComponents') }, ...items.map((m) => h('option', { value: m.id, selected: m.id === current }, m.name))),
  ) as HTMLSelectElement;
}
