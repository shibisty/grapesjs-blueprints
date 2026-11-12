import { describe, expect, it } from 'vitest';
import { locales } from '../src/i18n';
import { graphLocales } from '../src/i18n/graph';
import { BUILTIN_NODES } from '../src/blueprint';

const placeholders = (s: string) => (s.match(/%s/g) || []).length;

describe('i18n', () => {
  it('23 plugin locales with every key, non-empty, same placeholders as English', () => {
    expect(Object.keys(locales).sort()).toEqual(['ar', 'bs', 'ca', 'de', 'el', 'en', 'es', 'fa', 'fr', 'he', 'id', 'it', 'ko', 'nb', 'nl', 'pl', 'pt', 'ru', 'se', 'tr', 'uk', 'vi', 'zh']);
    const en = locales.en as unknown as Record<string, string>;
    for (const [lang, msgs] of Object.entries(locales) as unknown as [string, Record<string, string>][]) {
      expect(Object.keys(msgs).sort(), lang).toEqual(Object.keys(en).sort());
      for (const k of Object.keys(en)) {
        expect(msgs[k], `${lang}.${k}`).toBeTruthy();
        expect(placeholders(msgs[k]), `${lang}.${k}`).toBe(placeholders(en[k]));
      }
    }
  });

  it('graph editor ru/uk: every built-in node has a title and a description; same keys in both', () => {
    for (const [lang, d] of Object.entries(graphLocales)) {
      for (const n of BUILTIN_NODES) {
        expect(d[`node.${n.type}`], `${lang} node.${n.type}`).toBeTruthy();
        expect(d[`desc.${n.type}`], `${lang} desc.${n.type}`).toBeTruthy();
      }
    }
    expect(Object.keys(graphLocales.ru).sort()).toEqual(Object.keys(graphLocales.uk).sort());
    for (const k of Object.keys(graphLocales.ru)) expect(placeholders(graphLocales.uk[k]), k).toBe(placeholders(graphLocales.ru[k]));
  });
});
