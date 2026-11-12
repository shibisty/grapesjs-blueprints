import type { Editor } from 'grapesjs';
import ar from './locales/ar';
import bs from './locales/bs';
import ca from './locales/ca';
import de from './locales/de';
import el from './locales/el';
import en from './locales/en';
import es from './locales/es';
import fa from './locales/fa';
import fr from './locales/fr';
import he from './locales/he';
import id from './locales/id';
import it from './locales/it';
import ko from './locales/ko';
import nb from './locales/nb';
import nl from './locales/nl';
import pl from './locales/pl';
import pt from './locales/pt';
import ru from './locales/ru';
import se from './locales/se';
import tr from './locales/tr';
import uk from './locales/uk';
import vi from './locales/vi';
import zh from './locales/zh';
import type { ScriptsLabels } from './types';

export type { ScriptsLabels };

/**
 * Built-in locales of the plugin UI: the GrapesJS core locales (`se` is Swedish there) plus
 * Ukrainian. The blueprint editor itself (block names and descriptions) is in en/ru/uk.
 */
export const locales: Record<string, ScriptsLabels> = { ar, bs, ca, de, el, en, es, fa, fr, he, id, it, ko, nb, nl, pl, pt, ru, se, tr, uk, vi, zh };
export const SUPPORTED_LOCALES: readonly string[] = Object.keys(locales);
export const I18N_NS = 'scripts';

const RTL = new Set(['ar', 'he', 'fa']);
export const isRtlLocale = (locale: string | undefined): boolean => !!locale && RTL.has(locale.split('-')[0]);

/** Registers the built-in messages under `scripts.*` (messages already present win). */
export function registerMessages(editor: Editor): void {
  const i18n = editor.I18n as any;
  if (!i18n || typeof i18n.addMessages !== 'function') return;
  const existing = (i18n.getMessages?.() || {}) as Record<string, any>;
  const messages: Record<string, Record<string, ScriptsLabels>> = {};
  for (const lang of SUPPORTED_LOCALES) {
    messages[lang] = { [I18N_NS]: { ...locales[lang], ...(existing[lang]?.[I18N_NS] || {}) } };
  }
  i18n.addMessages(messages);
}

export type Translator = (key: keyof ScriptsLabels, ...args: (string | number)[]) => string;

/** `labels` option → `editor.I18n` (current locale) → English. `%s` filled from `args`. */
export function createTranslator(editor: Editor, overrides: Partial<ScriptsLabels> = {}): Translator {
  return (key, ...args) => {
    let msg: unknown = overrides[key];
    if (typeof msg !== 'string' || !msg) {
      try {
        msg = editor.I18n?.t(`${I18N_NS}.${key}`);
      } catch {
        msg = undefined;
      }
    }
    const str = typeof msg === 'string' && msg ? msg : en[key];
    let i = 0;
    return str.replace(/%s/g, () => String(args[i++] ?? ''));
  };
}

export function getLocale(editor: Editor): string | undefined {
  try {
    return editor.I18n?.getLocale();
  } catch {
    return undefined;
  }
}
