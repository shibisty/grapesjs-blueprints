# Writing your own blocks

A block (node) is **data** — pins, settings, title — plus a **`compile` handler** that turns it into JavaScript. Built-in blocks use the same API, so anything they do, yours can do.

```js
import { defineNode } from 'grapesjs-scripts/blueprint';

export const vibrate = defineNode({
  type: 'device.vibrate',          // unique id, kept in saved blueprints
  category: 'device',              // palette group (new categories are fine)
  title: 'Vibrate',
  description: 'Vibrates the phone where supported.',
  keywords: ['haptic', 'buzz'],    // palette search
  ports: {
    inputs: [
      { id: 'exec', type: 'exec' },
      { id: 'ms', type: 'number', label: 'Milliseconds', default: 200 },
    ],
    outputs: [{ id: 'then', type: 'exec' }],
  },
  compile: (c) => `if (navigator.vibrate) navigator.vibrate(${c.in('ms')});\n${c.next('then')}`,
});
```

Register it:

```js
grapesjs.init({ plugins: [scripts], pluginsOpts: { [scripts]: { nodes: [vibrate] } } });
// or later: editor.Scripts.addNode(vibrate)
```

## Kinds of blocks

| Kind | Pins | `compile` returns |
|---|---|---|
| **Action** | exec in/out (+ data) | statements: `{ code }` or a string; continue with `c.next('then')` |
| **Pure** | data only | expressions: `{ outputs: { result: 'a + b' } }` — evaluated where used |
| **Event** (`event: true`) | exec out only | code that sets up a listener and calls `c.next(...)` inside it |

## The compile context `c`

| | |
|---|---|
| `c.in(pin)` | JS expression of an input: the wire's source, or the literal typed on the block (a text on an element pin becomes a selector query) |
| `c.linked(pin)` | whether an input has a wire |
| `c.next(pin)` | code of what is connected to an exec output (empty string if nothing) |
| `c.set(pin, expr)` | `output = expr;` — or nothing when no wire reads that output |
| `c.used(pin)` / `c.out(pin)` | whether an output is wired / its variable name |
| `c.prop(id)` | a setting (with its default) |
| `c.lit(value)` | a JS literal, safe inside `<script>` |
| `c.h(name)` | name of a runtime helper (`list`, `on`, `delegate`, `q`, `els`, `timeout`, `interval`, `show`, `hide`, `visible`, `dispatch`, `store`, `lib`); its code is added once |
| `c.state(name, init)` | a variable that keeps its value between runs of the block (timers, flags) |
| `c.local(hint)` | a fresh local name |
| `c.variable(id)` | a blueprint variable |
| `c.root`, `c.doc`, `c.win` | the blueprint root (document or component element), its document and window |
| `c.entry` | the exec input the block was entered through (blocks with several exec inputs) |
| `c.warn(message)` | report a problem (shown in the editor) |

Listeners and timers must be removable: use `c.h('on')(__d, target, type, fn)` / `c.h('timeout')(__d, fn, ms)` — `__d` is the blueprint's list of disposers, run when the preview stops.

## Settings and dynamic pins

```js
props: [
  { id: 'event', type: 'string', label: 'Event', default: 'click', options: [{ value: 'click' }] },
  { id: 'count', type: 'number', label: 'Outputs', default: 2 },
],
ports: (props) => ({ inputs: [...], outputs: Array.from({ length: props.count }, (_, i) => ({ id: `out${i}`, type: 'exec' })) }),
```

Setting types: `string` (with `options` → suggestions), `number`, `boolean`, `select`, `selector` (gets the element picker), `code` (textarea), `variable`, `pins`. When dynamic pins disappear, their wires are removed.

## Pin types and wires

`exec`, `any`, `string`, `number`, `boolean`, `element`, `elements`, `event`, `object`. Allowed: same type; anything ↔ `any`; `element` → `elements`; `number`/`boolean` → `string`; anything → `boolean`.

## Translations

Titles and labels are English in the definition. The editor looks up `node.<type>`, `desc.<type>`, `cat.<category>`, `label.<English label>` — pass them through the `graphLabels` option:

```js
graphLabels: { 'node.device.vibrate': 'Вибрация', 'label.Milliseconds': 'Миллисекунды' }
```

## Testing

Build a blueprint, compile it, run it in jsdom:

```js
import { buildScript, createRegistry } from 'grapesjs-scripts/blueprint';
const registry = createRegistry([vibrate]);
const { code, diagnostics } = buildScript([bp], registry, { target: 'preview' });
const start = new Function(`return (${code});`)();
const stop = start(document);
```
