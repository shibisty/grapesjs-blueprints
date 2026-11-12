import { parse } from 'acorn';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildScript, compileBlueprint, validateBlueprint } from '../src/blueprint';
import { POPUP_BLUEPRINT, POPUP_BONUS_BLUEPRINT, POPUP_CSS, POPUP_HTML } from './fixtures/popup';
import { click, key, registry, start } from './helpers/run';

const popup = () => document.getElementById('popup')!;
const isOpen = () => popup().classList.contains('is-open');

describe('popup blueprint (first end-to-end case)', () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    document.head.innerHTML = `<style>${POPUP_CSS}</style>`;
    document.body.innerHTML = POPUP_HTML;
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it('is valid', () => {
    expect(validateBlueprint(POPUP_BLUEPRINT, registry)).toEqual([]);
    expect(validateBlueprint(POPUP_BONUS_BLUEPRINT, registry)).toEqual([]);
  });

  it('opens on click and closes on the close button', () => {
    const r = start([POPUP_BLUEPRINT]);
    stop = r.stop;
    expect(r.diagnostics).toEqual([]);
    expect(isOpen()).toBe(false);
    click(document.querySelector('.js-popup-open'));
    expect(isOpen()).toBe(true);
    expect(getComputedStyle(popup()).display).toBe('flex');
    click(document.querySelector('.popup__dialog p')); // a click inside the dialog does nothing
    expect(isOpen()).toBe(true);
    click(document.querySelector('.js-popup-close'));
    expect(isOpen()).toBe(false);
  });

  it('works for buttons added after start (delegation) and stops after dispose', () => {
    const r = start([POPUP_BLUEPRINT]);
    const late = document.createElement('a');
    late.className = 'js-popup-open';
    late.innerHTML = '<span>icon</span>';
    document.body.appendChild(late);
    click(late.querySelector('span')); // click on a child of the trigger
    expect(isOpen()).toBe(true);
    popup().classList.remove('is-open');
    r.stop();
    click(late);
    expect(isOpen()).toBe(false);
  });

  it('bonus: Escape and backdrop close it, clicks inside the dialog do not', () => {
    const r = start([POPUP_BONUS_BLUEPRINT]);
    stop = r.stop;
    expect(r.diagnostics).toEqual([]);
    click(document.querySelector('.js-popup-open'));
    key('Enter');
    expect(isOpen()).toBe(true);
    key('Escape');
    expect(isOpen()).toBe(false);
    click(document.querySelector('.js-popup-open'));
    click(document.querySelector('.popup__dialog'));
    expect(isOpen()).toBe(true);
    click(popup());
    expect(isOpen()).toBe(false);
  });

  it('page build starts by itself and is valid ES5-ish JavaScript', () => {
    const res = buildScript([POPUP_BLUEPRINT], registry);
    expect(() => parse(res.code, { ecmaVersion: 5 })).not.toThrow();
    new Function(res.code)();
    click(document.querySelector('.js-popup-open'));
    expect(isOpen()).toBe(true);
  });

  it('readable JS (snapshot)', () => {
    expect(compileBlueprint(POPUP_BLUEPRINT, registry).code).toMatchSnapshot();
    expect(buildScript([POPUP_BLUEPRINT], registry).code).toMatchSnapshot();
  });
});
