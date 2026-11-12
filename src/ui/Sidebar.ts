import type { Editor } from 'grapesjs';
import type { Blueprint, BlueprintKind } from '../blueprint';
import type { ScriptsManager } from '../core/ScriptsManager';
import { EVENTS } from '../events';
import { getLocale, isRtlLocale, type Translator } from '../i18n';
import { h, icon, type ICONS } from './dom';
import { projectPages } from './modals';

export interface SidebarActions {
  create(kind?: BlueprintKind): void;
  settings(): void;
  preview(): void;
  addLibrary(): void;
  editLibrary(id: string): void;
  removeLibrary(id: string): void;
  toggleLibrary(id: string): void;
  edit(id: string): void;
  code(id: string): void;
  rename(id: string): void;
  duplicate(id: string): void;
  remove(id: string): void;
  toggle(id: string): void;
  close(): void;
}

const KINDS: BlueprintKind[] = ['global', 'template', 'component'];

/** The "Scripts" panel: search and the scripts grouped by kind. Pure view of the manager. */
export class Sidebar {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly search: HTMLInputElement;
  private readonly tools: Record<'create' | 'preview' | 'settings' | 'close', HTMLButtonElement>;
  private query = '';
  private queued = false;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly editor: Editor,
    private readonly manager: ScriptsManager,
    private readonly t: Translator,
    private readonly actions: SidebarActions,
  ) {
    const tool = (name: keyof typeof ICONS, onclick: () => void) => h('button', { class: 'gjscr-btn', type: 'button', onclick }, icon(name, 16));
    this.tools = {
      create: tool('plus', () => actions.create()),
      preview: tool('play', () => actions.preview()),
      settings: tool('settings', () => actions.settings()),
      close: tool('close', () => actions.close()),
    };
    this.title = h('span', { class: 'gjscr-title' });
    this.search = h('input', {
      class: 'gjscr-search',
      type: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      oninput: () => {
        this.query = this.search.value;
        this.renderSoon();
      },
      onkeydown: (e: Event) => {
        const ev = e as KeyboardEvent;
        if (ev.key === 'Escape' && this.search.value) {
          ev.stopPropagation();
          this.search.value = this.query = '';
          this.renderSoon();
        } else if (ev.key === 'ArrowDown' || ev.key === 'Enter') {
          const first = this.body.querySelector<HTMLElement>('.gjscr-item');
          if (!first) return;
          ev.preventDefault();
          if (ev.key === 'Enter' && first.dataset.id) actions.edit(first.dataset.id);
          else first.focus();
        }
      },
    });
    this.body = h('div', { class: 'gjscr-body' });
    this.root = h(
      'div',
      { class: 'gjscr gjs-one-bg gjs-two-color', hidden: true },
      h('div', { class: 'gjscr-head' }, this.title, h('div', { class: 'gjscr-tools' }, this.tools.create, this.tools.preview, this.tools.settings, this.tools.close)),
      h('div', { class: 'gjscr-searchbox' }, this.search),
      this.body,
    );
    const rerender = () => this.renderSoon();
    for (const ev of [EVENTS.change, 'i18n:locale', 'i18n:update', 'page', 'page:add', 'page:remove', 'page:update']) {
      editor.on(ev, rerender);
      this.offs.push(() => editor.off(ev, rerender));
    }
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  destroy(): void {
    this.offs.splice(0).forEach((f) => f());
    this.root.remove();
  }

  renderSoon(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.render();
    });
  }

  render(): void {
    const t = this.t;
    const locale = getLocale(this.editor);
    this.root.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
    this.title.textContent = t('scripts');
    this.tools.create.title = t('newScript');
    this.tools.create.setAttribute('aria-label', t('newScript'));
    this.tools.close.title = t('close');
    this.tools.close.setAttribute('aria-label', t('close'));
    for (const [k, label] of [['preview', t('preview')], ['settings', t('settings')]] as const) {
      this.tools[k].title = label;
      this.tools[k].setAttribute('aria-label', label);
    }
    this.search.placeholder = t('search');
    this.search.setAttribute('aria-label', t('search'));

    const q = this.query.trim().toLowerCase();
    const all = this.manager.list();
    const shown = q ? all.filter((b) => this.matches(b, q)) : all;
    const frag = document.createDocumentFragment();
    const sectionTitle: Record<BlueprintKind, string> = { global: t('sectionGlobal'), template: t('sectionTemplate'), component: t('sectionComponent') };
    const kindName: Record<BlueprintKind, string> = { global: t('kindGlobal'), template: t('kindTemplate'), component: t('kindComponent') };
    for (const kind of KINDS) {
      const items = shown.filter((b) => b.kind === kind);
      if (q && !items.length) continue;
      const add = h('button', { class: 'gjscr-act', type: 'button', title: `${t('newScript')}: ${kindName[kind]}`, onclick: () => this.actions.create(kind) }, icon('plus', 14));
      frag.append(
        h('div', { class: 'gjscr-section', 'data-kind': kind }, h('span', {}, sectionTitle[kind], h('span', { class: 'gjscr-count' }, String(items.length))), add),
        items.length
          ? h('ul', { class: 'gjscr-list', role: 'list' }, items.map((b) => this.item(b)))
          : h('div', { class: 'gjscr-empty' }, !all.length && kind === 'global' ? t('empty') : '—'),
      );
    }
    const libs = this.manager.libraries().filter((l) => !q || `${l.name} ${l.version || ''}`.toLowerCase().includes(q));
    if (!q || libs.length) {
      frag.append(
        h(
          'div',
          { class: 'gjscr-section', 'data-kind': 'libraries' },
          h('span', {}, t('sectionLibraries'), h('span', { class: 'gjscr-count' }, String(libs.length))),
          h('button', { class: 'gjscr-act', type: 'button', title: t('addLibrary'), onclick: () => this.actions.addLibrary() }, icon('plus', 14)),
        ),
        libs.length
          ? h(
              'ul',
              { class: 'gjscr-list', role: 'list' },
              libs.map((l) =>
                h(
                  'li',
                  { class: `gjscr-item gjscr-libitem${l.enabled ? '' : ' is-off'}`, tabindex: 0, 'data-lib': l.id, title: l.files.map((f) => f.url).join('\n'), onclick: () => this.actions.editLibrary(l.id) },
                  h('span', { class: 'gjscr-dot' }),
                  h('div', { class: 'gjscr-main' }, h('div', { class: 'gjscr-name' }, l.name), h('div', { class: 'gjscr-sub' }, [l.version, l.files.map((f) => f.type).join(' + '), l.pages?.length ? t('pagesCount', l.pages.length) : ''].filter(Boolean).join(' · '))),
                  h(
                    'div',
                    { class: 'gjscr-acts' },
                    h('button', { class: 'gjscr-act', type: 'button', title: l.enabled ? t('disable') : t('enable'), onclick: (e: Event) => (e.stopPropagation(), this.actions.toggleLibrary(l.id)) }, icon('power', 14)),
                    h('button', { class: 'gjscr-act', type: 'button', title: t('remove'), onclick: (e: Event) => (e.stopPropagation(), this.actions.removeLibrary(l.id)) }, icon('trash', 14)),
                  ),
                ),
              ),
            )
          : h('div', { class: 'gjscr-empty' }, t('noLibraries')),
      );
    }
    if (q && !shown.length && !libs.length) frag.append(h('div', { class: 'gjscr-empty' }, t('noMatch')));
    const focusedId = (document.activeElement as HTMLElement | null)?.closest?.('.gjscr-item')?.getAttribute('data-id');
    this.body.replaceChildren(frag);
    if (focusedId) this.body.querySelector<HTMLElement>(`.gjscr-item[data-id="${CSS.escape(focusedId)}"]`)?.focus();
  }

  private matches(b: Blueprint, q: string): boolean {
    const hay = [b.name, b.description, b.component?.type, b.target?.when, ...b.nodes.map((n) => String(n.props?.selector ?? ''))].join(' ').toLowerCase();
    return hay.includes(q);
  }

  private subline(b: Blueprint): (string | HTMLElement)[] {
    const t = this.t;
    const parts: (string | HTMLElement)[] = [];
    if (b.kind === 'template') {
      const pages = b.target?.pages || [];
      if (pages.length) {
        const names = new Map(projectPages(this.editor).map((p) => [p.id, p.name]));
        parts.push(pages.map((id) => names.get(id) || id).join(', '));
      }
      if (b.target?.when) parts.push(b.target.when);
      if (!pages.length && !b.target?.when) parts.push(t('allPages'));
    }
    if (b.kind === 'component' && b.component?.type) parts.push(`<${b.component.type}>`);
    parts.push(t('nodes', b.nodes.length));
    if (!b.enabled) parts.push(t('disabled'));
    const diags = this.manager.diagnostics(b.id);
    const errors = diags.filter((d) => d.severity === 'error').length;
    const out: (string | HTMLElement)[] = [parts.join(' · ')];
    if (errors) out.push(' · ', h('span', { class: 'gjscr-err' }, t('errors', errors)));
    return out;
  }

  private item(b: Blueprint): HTMLLIElement {
    const t = this.t;
    const act = (name: keyof typeof ICONS, label: string, fn: () => void) =>
      h(
        'button',
        {
          class: 'gjscr-act',
          type: 'button',
          title: label,
          'aria-label': label,
          onclick: (e: Event) => {
            e.stopPropagation();
            fn();
          },
        },
        icon(name, 14),
      );
    const errors = this.manager.diagnostics(b.id).some((d) => d.severity === 'error');
    const li = h(
      'li',
      {
        class: `gjscr-item${b.enabled ? '' : ' is-off'}${errors ? ' has-errors' : ''}`,
        tabindex: 0,
        'data-id': b.id,
        title: b.description || b.name,
        onclick: () => this.actions.edit(b.id),
        onkeydown: (e: Event) => this.onKey(e as KeyboardEvent, b.id),
      },
      h('span', { class: 'gjscr-dot' }),
      h('div', { class: 'gjscr-main' }, h('div', { class: 'gjscr-name' }, b.name), h('div', { class: 'gjscr-sub' }, this.subline(b))),
      h(
        'div',
        { class: 'gjscr-acts' },
        act('code', t('viewCode'), () => this.actions.code(b.id)),
        act('power', b.enabled ? t('disable') : t('enable'), () => this.actions.toggle(b.id)),
        act('rename', t('rename'), () => this.actions.rename(b.id)),
        act('copy', t('duplicate'), () => this.actions.duplicate(b.id)),
        act('trash', t('remove'), () => this.actions.remove(b.id)),
      ),
    );
    return li;
  }

  private onKey(e: KeyboardEvent, id: string) {
    if (e.target !== e.currentTarget) return;
    const items = Array.from(this.body.querySelectorAll<HTMLElement>('.gjscr-item'));
    const i = items.indexOf(e.currentTarget as HTMLElement);
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.actions.edit(id);
        break;
      case 'ArrowDown':
        e.preventDefault();
        items[i + 1]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (i > 0) items[i - 1].focus();
        else this.search.focus();
        break;
      case 'F2':
        e.preventDefault();
        this.actions.rename(id);
        break;
      case 'Delete':
        e.preventDefault();
        this.actions.remove(id);
        break;
      default:
        return;
    }
    e.stopPropagation();
  }
}
