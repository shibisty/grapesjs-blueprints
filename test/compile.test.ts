import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import {
  NodeRegistry,
  buildScript,
  canConnect,
  compileBlueprint,
  createBlueprint,
  createRegistry,
  defineNode,
  jsLiteral,
  normalizeBlueprint,
  validateBlueprint,
} from '../src/blueprint';
import { click, graph, registry, start } from './helpers/run';

describe('compiler', () => {
  it('an exec node reached from two events becomes a shared function', () => {
    document.body.innerHTML = '<a class="x"></a><a class="y"></a><i id="n">0</i>';
    const bp = graph(
      [['x', 'event.element', { selector: '.x' }], ['y', 'event.element', { selector: '.y' }], ['inc', 'code.js', { code: 'var e = ctx.document.getElementById("n"); e.textContent = +e.textContent + 1;', inputs: [], outputs: [] }]],
      ['x.then > inc.exec', 'y.then > inc.exec'],
    );
    const code = compileBlueprint(bp, registry).code;
    expect(code).toContain('function _inc_exec()');
    expect(code.match(/e\.textContent = \+e\.textContent \+ 1/g)).toHaveLength(1);
    const r = start([bp]);
    click(document.querySelector('.x'));
    click(document.querySelector('.y'));
    expect(document.getElementById('n')!.textContent).toBe('2');
    r.stop();
  });

  it('an exec cycle compiles (function recursion) instead of hanging', () => {
    const bp = graph(
      [['s', 'event.start'], ['a', 'flow.delay', { ms: 10 }], ['b', 'debug.log']],
      ['s.then > a.exec', 'a.then > b.exec', 'b.then > a.exec'],
    );
    const res = buildScript([bp], registry);
    expect(() => parse(res.code, { ecmaVersion: 5 })).not.toThrow();
    expect(res.code).toContain('function _a_exec()');
  });

  it('a pure-node cycle is reported, not looped', () => {
    const bp = graph(
      [['s', 'event.start'], ['m', 'math.op'], ['n', 'math.op'], ['log', 'debug.log']],
      ['s.then > log.exec', 'm.result > n.a', 'n.result > m.a', 'm.result > log.value'],
    );
    const res = compileBlueprint(bp, registry);
    expect(res.diagnostics.some((d) => d.code === 'cycle')).toBe(true);
  });

  it('disabled nodes pass execution through', () => {
    document.body.innerHTML = '<i id="a"></i>';
    const bp = graph([['s', 'event.start'], ['skip', 'dom.addClass', { target: '#a', className: 'skipped' }], ['ok', 'dom.addClass', { target: '#a', className: 'ok' }]], ['s.then > skip.exec', 'skip.then > ok.exec']);
    bp.nodes[1].disabled = true;
    const r = start([bp]);
    expect(document.getElementById('a')!.className).toBe('ok');
    r.stop();
  });

  it('reports unknown nodes, unreachable nodes and broken node definitions without throwing', () => {
    const reg = createRegistry([
      defineNode({ type: 'bad', category: 'x', title: 'Bad', ports: { inputs: [{ id: 'exec', type: 'exec' }], outputs: [] }, compile: () => { throw new Error('boom'); } }),
    ]);
    const bp = graph([['s', 'event.start'], ['b', 'bad'], ['u', 'nope'], ['lonely', 'dom.addClass']], ['s.then > b.exec']);
    const res = compileBlueprint(bp, reg);
    const codes = res.diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual(['compile-error', 'unknown-node', 'unreachable']);
    expect(() => parse(`(${res.code})`, { ecmaVersion: 5 })).not.toThrow();
  });

  it('literals cannot break out of strings or <script>', () => {
    const evil = '"); alert(1); //</script><script>alert(2)</script> ';
    expect(jsLiteral(evil)).not.toContain('</script');
    const bp = graph([['s', 'event.start'], ['t', 'dom.setText', { target: '#x', text: evil }]], ['s.then > t.exec'], { name: '*/ alert(3) /*' });
    const code = buildScript([bp], registry).code;
    expect(code).not.toContain('</script');
    expect(() => parse(code, { ecmaVersion: 5 })).not.toThrow();
    expect(code).not.toMatch(/\*\/ alert\(3\)/);
  });

  it('weird node ids still give valid identifiers', () => {
    const bp = graph([['1 two-3', 'event.element', { selector: 'a' }], ['ü.x', 'dom.getText'], ['l', 'debug.log']], ['1 two-3.then > l.exec', '1 two-3.self > ü.x.target'.replace('ü.x', 'ü_x')]);
    bp.nodes[1].id = 'ü_x';
    bp.links.push({ from: ['ü_x', 'text'], to: ['l', 'value'] });
    expect(() => parse(buildScript([bp], registry).code, { ecmaVersion: 5 })).not.toThrow();
  });

  it('comments can be turned off and titles translated', () => {
    const bp = graph([['s', 'event.start'], ['l', 'debug.log']], ['s.then > l.exec']);
    expect(compileBlueprint(bp, registry, { comments: false }).code).not.toContain('//');
    expect(compileBlueprint(bp, registry, { title: (d) => `T:${d.type}` }).code).toContain('// l · T:debug.log');
  });
});

describe('validation', () => {
  it('finds type mismatches, missing inputs, bad selectors, unknown variables, no events', () => {
    const bp = graph(
      [
        ['ev', 'event.element', { selector: 'a[' }],
        ['n', 'data.number'],
        ['cls', 'dom.addClass', { target: '' }],
        ['g', 'var.get', { variable: 'missing' }],
      ],
      ['ev.then > cls.exec', 'n.value > cls.target'],
    );
    const codes = validateBlueprint(bp, registry).map((d) => d.code).sort();
    expect(codes).toEqual(['bad-selector', 'required-input', 'type-mismatch', 'unknown-variable']);
    expect(validateBlueprint(graph([['l', 'debug.log']]), registry).map((d) => d.code)).toEqual(['no-events']);
  });

  it('pin compatibility', () => {
    expect(canConnect('exec', 'exec')).toBe(true);
    expect(canConnect('exec', 'any')).toBe(false);
    expect(canConnect('element', 'elements')).toBe(true);
    expect(canConnect('elements', 'element')).toBe(false);
    expect(canConnect('number', 'string')).toBe(true);
    expect(canConnect('string', 'number')).toBe(false);
    expect(canConnect('any', 'number')).toBe(true);
  });
});

describe('schema', () => {
  it('normalizes junk into a valid blueprint', () => {
    const bp = normalizeBlueprint({
      kind: 'weird',
      nodes: [{ id: 'a', type: 'event.start', pos: ['10', null] }, { type: 'x' }, null],
      links: [{ from: ['a', 'then'], to: ['ghost', 'exec'] }, { from: 'a' }],
      variables: [{ id: 'v' }],
      target: { pages: ['p1', 3], when: '  .x ' },
    });
    expect(bp.kind).toBe('global');
    expect(bp.nodes).toEqual([{ id: 'a', type: 'event.start', pos: [10, 0] }]);
    expect(bp.links).toEqual([]);
    expect(bp.variables).toEqual([{ id: 'v', name: 'v', type: 'any' }]);
    expect(bp.target).toEqual({ pages: ['p1'], when: '.x' });
    expect(bp.schema).toBe(1);
    expect(JSON.parse(JSON.stringify(bp))).toEqual(bp);
  });

  it('createBlueprint gives unique ids', () => {
    const a = createBlueprint({ name: 'A' });
    const b = createBlueprint({ name: 'B', kind: 'template' });
    expect(a.id).not.toBe(b.id);
    expect(b.kind).toBe('template');
  });

  it('registry rejects invalid definitions and supports replacing built-ins', () => {
    expect(() => new NodeRegistry().add({ type: '' } as any)).toThrow();
    const reg = createRegistry([defineNode({ type: 'debug.log', category: 'debug', title: 'Mine', ports: { inputs: [], outputs: [] }, compile: () => '' })]);
    expect(reg.get('debug.log')!.title).toBe('Mine');
  });
});

describe('library boundary', () => {
  it('src/blueprint never imports grapesjs or the plugin', () => {
    const files: string[] = [];
    const walk = (dir: string) =>
      readdirSync(dir).forEach((f) => {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      });
    walk(join(__dirname, '../src/blueprint'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const imports = Array.from(src.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
      for (const i of imports) {
        expect(i, `${f} imports ${i}`).toMatch(/^\.\.?\//);
        expect(i, `${f} imports ${i}`).not.toMatch(/(^|\/)(plugin|ui|integration)(\/|$)/);
      }
    }
  });
});
