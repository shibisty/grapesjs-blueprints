import type { Editor } from 'grapesjs';
import type { Translator } from '../i18n';
import type { PageCss } from '../integration/pageCss';
import { codeArea, type CodeArea } from './codeEditor';
import { h } from './dom';

/**
 * The editor of the page's own CSS: the text follows the Style Manager
 * (when you are not typing in it), typing changes the rules after a pause.
 */
export class PageCssEditorView {
  readonly root: HTMLElement;
  private readonly area: CodeArea;
  private readonly status: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private typedAt = 0;
  private closed = false;
  private readonly off: () => void;

  constructor(
    editor: Editor,
    private readonly css: PageCss,
    private readonly o: { t: Translator; parent?: HTMLElement; title?: () => string; onClosed?: () => void; saveDelay?: number },
  ) {
    const t = o.t;
    this.area = codeArea(editor, 'css', css.text(), (v) => this.typed(v), 'gjscr-ce-code');
    this.status = h('div', { class: 'gjscr-ce-status', role: 'status' });
    const done = h('button', { class: 'gjscr-btn gjscr-primary', type: 'button', onclick: () => this.close() }, t('done'));
    this.root = h(
      'div',
      { class: `gjscr-ce gjscr-pagecss gjs-one-bg gjs-two-color${o.parent ? ' gjscr-ce--embedded' : ''}`, role: 'dialog', 'aria-label': t('pageCss'), 'data-lang': 'css' },
      h('div', { class: 'gjscr-ce-head' }, h('span', { class: 'gjscr-ce-lang' }, 'CSS'), h('span', { class: 'gjscr-ce-title' }, o.title?.() || t('pageCss')), done),
      h('div', { class: 'gjscr-ce-body' }, h('div', { class: 'gjscr-ce-main' }, h('div', { class: 'gjscr-ce-hint' }, t('pageCssHint')), this.area.el, this.status)),
    );
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.gjscr-cm, textarea')) {
        e.stopPropagation();
        this.close();
      }
    });
    this.off = css.onChange(() => this.pull());
    this.renderStatus();
    (o.parent || document.body).appendChild(this.root);
    setTimeout(() => this.area.refresh());
  }

  /** The text: what is typed now. */
  get value(): string {
    return this.area.get();
  }

  private typed(v: string): void {
    if (v === this.css.text()) return; // the text set from the rules
    this.typedAt = Date.now();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(v), this.o.saveDelay ?? 500);
  }

  /** Typed text → the rules. */
  push(v = this.area.get()): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.css.setText(v);
    this.renderStatus();
  }

  /** The rules changed elsewhere → the text (not while typing). */
  private pull(): void {
    if (this.closed || this.timer || Date.now() - this.typedAt < 800) return;
    const next = this.css.text();
    if (next !== this.area.get()) this.area.set(next);
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.textContent = this.o.t('cssRules', this.css.count());
  }

  refresh(): void {
    this.area.refresh();
    this.pull();
  }

  close(): void {
    if (this.closed) return;
    if (this.timer) this.push();
    this.closed = true;
    this.off();
    this.root.remove();
    this.o.onClosed?.();
  }
}
