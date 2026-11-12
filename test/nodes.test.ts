import { parse } from 'acorn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_NODES, buildScript, buildStandalone, defaultProps } from '../src/blueprint';
import { click, graph, key, registry, start } from './helpers/run';

let stops: (() => void)[] = [];
const run = (...args: Parameters<typeof start>) => {
  const r = start(...args);
  stops.push(r.stop);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r;
};
const $ = (s: string) => document.querySelector(s) as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});
afterEach(() => {
  stops.splice(0).forEach((s) => s());
  vi.useRealTimers();
});

describe('every built-in node', () => {
  it.each(BUILTIN_NODES.map((d) => [d.type]))('%s compiles to valid ES5 with defaults', (type) => {
    const def = registry.get(type)!;
    const ports = registry.ports(type, defaultProps(def));
    const isEvent = !!def.event;
    const execIn = ports.inputs.find((p) => p.type === 'exec');
    const nodes: [string, string, Record<string, unknown>?][] = [['n', type]];
    const links: string[] = [];
    if (!isEvent && execIn) {
      nodes.unshift(['ev', 'event.start']);
      links.push(`ev.then > n.${execIn.id}`);
    }
    // every data output feeds a log so the output code is generated too
    if (!isEvent && !execIn) {
      nodes.unshift(['ev', 'event.start']);
      nodes.push(['log', 'debug.log']);
      links.push('ev.then > log.exec');
      const out = ports.outputs.find((p) => p.type !== 'exec');
      if (out) links.push(`n.${out.id} > log.value`);
    }
    for (const out of ports.outputs.filter((p) => p.type === 'exec')) {
      nodes.push([`after_${out.id}`, 'debug.log']);
      links.push(`n.${out.id} > after_${out.id}.exec`);
    }
    const res = buildScript([graph(nodes, links, { variables: [{ id: 'variable', name: 'v', type: 'any' }] })], registry);
    expect(() => parse(res.code, { ecmaVersion: 5 })).not.toThrow();
    expect(res.diagnostics.filter((d) => d.code === 'compile-error')).toEqual([]);
  });

  it('have titles, categories and descriptions', () => {
    for (const d of BUILTIN_NODES) {
      expect(d.title, d.type).toBeTruthy();
      expect(d.category, d.type).toBeTruthy();
      expect(d.description, d.type).toBeTruthy();
    }
  });
});

describe('events', () => {
  it('element event: preventDefault, once, self and event outputs', () => {
    document.body.innerHTML = '<a href="#x" class="link" data-v="42">go</a><div id="out"></div>';
    run([
      graph(
        [
          ['ev', 'event.element', { selector: '.link', event: 'click', preventDefault: true, once: true }],
          ['attr', 'dom.getAttribute', { name: 'data-v' }],
          ['set', 'dom.setText', { target: '#out' }],
        ],
        ['ev.then > set.exec', 'ev.self > attr.target', 'attr.value > set.text'],
      ),
    ]);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    $('.link').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect($('#out').textContent).toBe('42');
    $('#out').textContent = '';
    click($('.link'));
    expect($('#out').textContent).toBe('');
  });

  it('mouseenter is delegated through mouseover and fires once per entry', () => {
    document.body.innerHTML = '<div class="card"><span>in</span></div><b id="n">0</b>';
    let n = 0;
    (window as any).__inc = () => $('#n').textContent = String(++n);
    run([graph([['ev', 'event.element', { selector: '.card', event: 'mouseenter' }], ['js', 'code.js', { code: 'window.__inc();', inputs: [], outputs: [] }]], ['ev.then > js.exec'])]);
    const over = (t: Element, rel: Element | null) => t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: rel }));
    over($('.card'), document.body);
    over($('.card span'), $('.card')); // moving inside: no new entry
    expect(n).toBe(1);
  });

  it('start runs after the listeners are set up; timer; key with modifiers', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<i id="a"></i>';
    run([
      graph(
        [
          ['s', 'event.start'],
          ['mark', 'dom.addClass', { target: '#a', className: 'started' }],
          ['t', 'event.timer', { ms: 500, repeat: true }],
          ['tick', 'dom.toggleClass', { target: '#a', className: 'tick' }],
          ['k', 'event.key', { key: 's', ctrl: true }],
          ['save', 'dom.addClass', { target: '#a', className: 'saved' }],
        ],
        ['s.then > mark.exec', 't.then > tick.exec', 'k.then > save.exec'],
      ),
    ]);
    expect($('#a').className).toBe('started');
    vi.advanceTimersByTime(500);
    expect($('#a').classList.contains('tick')).toBe(true);
    vi.advanceTimersByTime(500);
    expect($('#a').classList.contains('tick')).toBe(false);
    key('s');
    expect($('#a').classList.contains('saved')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect($('#a').classList.contains('saved')).toBe(true);
  });

  it('custom events connect two blueprints', () => {
    document.body.innerHTML = '<button class="b">b</button><p id="p"></p>';
    run([
      graph([['ev', 'event.element', { selector: '.b' }], ['send', 'dom.dispatch', { name: 'cart:add' }], ['data', 'data.string', { value: 'apple' }]], ['ev.then > send.exec', 'data.value > send.detail'], { id: 'a' }),
      graph([['on', 'event.custom', { name: 'cart:add' }], ['txt', 'dom.setText', { target: '#p' }]], ['on.then > txt.exec', 'on.detail > txt.text'], { id: 'b' }),
    ]);
    click($('.b'));
    expect($('#p').textContent).toBe('apple');
  });

  it('page events with throttle', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<b id="n"></b>';
    (window as any).__hits = 0;
    run([graph([['ev', 'event.page', { event: 'resize', throttle: 100 }], ['js', 'code.js', { code: 'window.__hits++;', inputs: [], outputs: [] }]], ['ev.then > js.exec'])]);
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect((window as any).__hits).toBe(1);
    vi.advanceTimersByTime(150);
    window.dispatchEvent(new Event('resize'));
    expect((window as any).__hits).toBe(2);
  });
});

describe('flow', () => {
  it('branch, compare, variables, math: a counter with a limit', () => {
    document.body.innerHTML = '<button id="b">+</button><span id="n">0</span>';
    run([
      graph(
        [
          ['ev', 'event.element', { selector: '#b' }],
          ['get', 'var.get', { variable: 'count' }],
          ['lt', 'logic.compare', { op: '<', b: 3 }],
          ['if', 'flow.branch'],
          ['plus', 'math.op', { op: '+', b: 1 }],
          ['set', 'var.set', { variable: 'count' }],
          ['show', 'dom.setText', { target: '#n' }],
          ['max', 'dom.addClass', { target: '#n', className: 'max' }],
        ],
        ['ev.then > if.exec', 'get.value > lt.a', 'lt.result > if.condition', 'if.true > set.exec', 'get.value > plus.a', 'plus.result > set.value', 'set.then > show.exec', 'set.value > show.text', 'if.false > max.exec'],
        { variables: [{ id: 'count', name: 'count', type: 'number', default: 0 }] },
      ),
    ]);
    for (let i = 0; i < 5; i++) click($('#b'));
    expect($('#n').textContent).toBe('3');
    expect($('#n').classList.contains('max')).toBe(true);
  });

  it('sequence, delay, debounce', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input id="i"><p id="log"></p>';
    (window as any).__log = (s: string) => ($('#log').textContent += s);
    const js = (s: string): [string, string, Record<string, unknown>] => [s, 'code.js', { code: `window.__log(${JSON.stringify(s)});`, inputs: [], outputs: [] }];
    run([
      graph(
        [['s', 'event.start'], ['seq', 'flow.sequence', { count: 3 }], js('a'), js('b'), ['wait', 'flow.delay', { ms: 100 }], js('c'), ['ev', 'event.element', { selector: '#i', event: 'input' }], ['deb', 'flow.debounce', { ms: 200 }], js('d')],
        ['s.then > seq.exec', 'seq.then0 > a.exec', 'seq.then1 > wait.exec', 'wait.then > c.exec', 'seq.then2 > b.exec', 'ev.then > deb.exec', 'deb.then > d.exec'],
      ),
    ]);
    expect($('#log').textContent).toBe('ab');
    vi.advanceTimersByTime(100);
    expect($('#log').textContent).toBe('abc');
    for (let i = 0; i < 3; i++) {
      $('#i').dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(100);
    }
    expect($('#log').textContent).toBe('abc');
    vi.advanceTimersByTime(200);
    expect($('#log').textContent).toBe('abcd');
  });

  it('dispose cancels pending timers', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<i id="a"></i>';
    const r = start([graph([['s', 'event.start'], ['w', 'flow.delay', { ms: 50 }], ['c', 'dom.addClass', { target: '#a', className: 'x' }]], ['s.then > w.exec', 'w.then > c.exec'])]);
    r.stop();
    vi.advanceTimersByTime(100);
    expect($('#a').className).toBe('');
  });

  it('do once with reset; for each over found elements; switch', () => {
    document.body.innerHTML = '<li>a</li><li>b</li><li>c</li><button id="go"></button><button id="reset"></button><p id="sw"></p>';
    run([
      graph(
        [
          ['go', 'event.element', { selector: '#go' }],
          ['reset', 'event.element', { selector: '#reset' }],
          ['once', 'flow.doOnce'],
          ['each', 'flow.forEach'],
          ['q', 'dom.query', { selector: 'li' }],
          ['mark', 'dom.toggleClass', { className: 'on' }],
          ['sw', 'flow.switch', { cases: 'a, b' }],
          ['txt', 'dom.getText'],
          ['A', 'dom.setText', { target: '#sw', text: 'A' }],
          ['D', 'dom.setText', { target: '#sw', text: 'D' }],
        ],
        ['go.then > once.exec', 'reset.then > once.reset', 'once.then > each.exec', 'q.result > each.items', 'each.body > mark.exec', 'each.item > mark.target', 'each.completed > sw.exec', 'q.first > txt.target', 'txt.text > sw.value', 'sw.case0 > A.exec', 'sw.default > D.exec'],
      ),
    ]);
    click($('#go'));
    click($('#go'));
    expect(document.querySelectorAll('li.on').length).toBe(3);
    expect($('#sw').textContent).toBe('A');
    click($('#reset'));
    click($('#go'));
    expect(document.querySelectorAll('li.on').length).toBe(0);
  });
});

describe('dom & data', () => {
  it('show / hide / toggle keep the original display', () => {
    document.body.innerHTML = '<div id="a" style="display:grid"></div><div id="b" hidden></div><button id="t"></button>';
    run([graph([['ev', 'event.element', { selector: '#t' }], ['tg', 'dom.toggleVisible', { target: '#a' }], ['sh', 'dom.show', { target: '#b' }]], ['ev.then > tg.exec', 'tg.then > sh.exec'])]);
    click($('#t'));
    expect($('#a').style.display).toBe('none');
    expect($('#b').hasAttribute('hidden')).toBe(false);
    click($('#t'));
    expect($('#a').style.display).toBe('grid');
  });

  it('attributes, styles, values, storage', () => {
    document.body.innerHTML = '<input id="name" value="Ann"><button id="save"></button><p id="p"></p>';
    run([
      graph(
        [
          ['ev', 'event.element', { selector: '#save' }],
          ['val', 'dom.getValue', { target: '#name' }],
          ['txt', 'convert.string'],
          ['store', 'storage.set', { key: 'name' }],
          ['attr', 'dom.setAttribute', { target: '#p', name: 'aria-label', value: 'saved' }],
          ['css', 'dom.setStyle', { target: '#p', property: 'color', value: 'red' }],
          ['read', 'storage.get', { key: 'name' }],
          ['hello', 'string.concat', { a: 'Hi', separator: ', ' }],
          ['out', 'dom.setText', { target: '#p' }],
        ],
        ['ev.then > store.exec', 'val.value > txt.value', 'txt.result > store.value', 'store.then > attr.exec', 'attr.then > css.exec', 'css.then > out.exec', 'read.value > hello.b', 'hello.result > out.text'],
      ),
    ]);
    click($('#save'));
    expect(localStorage.getItem('name')).toBe('Ann');
    expect($('#p').getAttribute('aria-label')).toBe('saved');
    expect($('#p').style.color).toBe('red');
    expect($('#p').textContent).toBe('Hi, Ann');
  });

  it('set text never parses HTML', () => {
    document.body.innerHTML = '<p id="p"></p>';
    run([graph([['s', 'event.start'], ['t', 'dom.setText', { target: '#p', text: '<img src=x onerror=alert(1)>' }]], ['s.then > t.exec'])]);
    expect($('#p').children.length).toBe(0);
  });

  it('query modes: within and closest', () => {
    document.body.innerHTML = '<ul class="menu"><li class="item"><a class="lnk">x</a></li></ul><li class="item">outside</li>';
    run([
      graph(
        [
          ['ev', 'event.element', { selector: '.lnk' }],
          ['up', 'dom.query', { selector: '.menu', mode: 'closest' }],
          ['inner', 'dom.query', { selector: '.item', mode: 'within' }],
          ['mark', 'dom.addClass', { className: 'hit' }],
        ],
        ['ev.then > mark.exec', 'ev.self > up.from', 'up.result > inner.from', 'inner.result > mark.target'],
      ),
    ]);
    click($('.lnk'));
    expect(document.querySelectorAll('.hit').length).toBe(1);
    expect($('.menu .item').classList.contains('hit')).toBe(true);
  });

  it('JS code node: inputs, outputs, ctx, async', async () => {
    document.body.innerHTML = '<p id="p"></p><p id="q"></p>';
    run([
      graph(
        [
          ['s', 'event.start'],
          ['js', 'code.js', { code: 'return { twice: inputs.n * 2, tag: ctx.document.title };', inputs: [{ id: 'n', type: 'number' }], outputs: [{ id: 'twice', type: 'number' }, { id: 'tag', type: 'string' }], n: 21 }],
          ['t', 'dom.setText', { target: '#p' }],
          ['as', 'code.js', { code: 'return new Promise(function (r) { setTimeout(function () { r({ v: "late" }); }, 1); });', inputs: [], outputs: [{ id: 'v', type: 'string' }], async: true }],
          ['t2', 'dom.setText', { target: '#q' }],
        ],
        ['s.then > js.exec', 'js.then > t.exec', 'js.twice > t.text', 't.then > as.exec', 'as.then > t2.exec', 'as.v > t2.text'],
      ),
    ]);
    expect($('#p').textContent).toBe('42');
    await new Promise((r) => setTimeout(r, 10));
    expect($('#q').textContent).toBe('late');
  });

  it('expression node', () => {
    document.body.innerHTML = '<p id="p"></p>';
    run([graph([['s', 'event.start'], ['e', 'code.expression', { expression: 'a.toUpperCase() + b', a: 'hi', b: '!' }], ['t', 'dom.setText', { target: '#p' }]], ['s.then > t.exec', 'e.result > t.text'])]);
    expect($('#p').textContent).toBe('HI!');
  });
});

describe('component and template scope', () => {
  it('a component blueprint is scoped to its root element and gets params', () => {
    document.body.innerHTML = '<div class="acc" id="one"><button class="h">h</button><div class="b"></div></div><div class="acc" id="two"><button class="h">h</button><div class="b"></div></div>';
    const bp = graph(
      [
        ['ev', 'event.element', { selector: '.h' }],
        ['tg', 'dom.toggleClass', { target: '.b' }],
        ['cls', 'component.param', { param: 'openClass' }],
      ],
      ['ev.then > tg.exec', 'cls.value > tg.className'],
      { kind: 'component' },
    );
    const compiled = buildStandalone(bp, registry);
    const fn = new Function(`return (${compiled.code});`)();
    const stopOne = fn($('#one'), { params: { openClass: 'open' } });
    stops.push(stopOne);
    click($('#one .h'));
    expect($('#one .b').className).toBe('b open');
    expect($('#two .b').className).toBe('b');
    click($('#two .h')); // not inside the root
    expect($('#two .b').className).toBe('b');
  });

  it('component blueprints are left out of the page script', () => {
    const res = buildScript([graph([['s', 'event.start']], [], { kind: 'component' })], registry);
    expect(res.blueprints).toHaveLength(0);
  });

  it('template blueprint runs only when the condition matches', () => {
    const bp = graph([['s', 'event.start'], ['m', 'dom.addClass', { target: 'body', className: 'tpl-ran' }]], ['s.then > m.exec'], {
      kind: 'template',
      target: { when: 'body.product' },
    });
    document.body.className = '';
    run([bp]);
    expect(document.body.classList.contains('tpl-ran')).toBe(false);
    document.body.className = 'product';
    run([bp]);
    expect(document.body.classList.contains('tpl-ran')).toBe(true);
    document.body.className = '';
  });

  it('disabled blueprints are skipped unless asked', () => {
    const bp = { ...graph([['s', 'event.start']]), enabled: false };
    expect(buildScript([bp], registry).blueprints).toHaveLength(0);
    expect(buildScript([bp], registry, { includeDisabled: true }).blueprints).toHaveLength(1);
  });
});
