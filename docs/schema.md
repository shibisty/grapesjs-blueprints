# Blueprint format

Blueprints are plain JSON, versioned by `schema` ([JSON Schema](blueprint.schema.json)). The plugin keeps them in the project data:

```jsonc
{
  "scripts": {
    "schema": 1,
    "blueprints": [ /* Blueprint */ ],
    "settings": { "output": "file", "fileName": "scripts.js", "minify": false, "obfuscate": false, "comments": true, "includeInHtml": true },
    "libraries": [ { "id": "lib_…", "name": "gsap", "version": "3.12.5", "files": [{ "url": "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js", "type": "js" }], "enabled": true } ]
  }
}
```

## The popup blueprint

```json
{
  "schema": 1,
  "id": "bp_popup",
  "name": "Popup",
  "kind": "global",
  "enabled": true,
  "variables": [],
  "nodes": [
    { "id": "open",  "type": "event.element",   "pos": [40, 40],   "props": { "selector": ".js-popup-open", "event": "click" } },
    { "id": "show",  "type": "dom.addClass",    "pos": [360, 40],  "props": { "target": "#popup", "className": "is-open" } },
    { "id": "close", "type": "event.element",   "pos": [40, 240],  "props": { "selector": ".js-popup-close", "event": "click" } },
    { "id": "hide",  "type": "dom.removeClass", "pos": [360, 240], "props": { "target": "#popup", "className": "is-open" } }
  ],
  "links": [
    { "from": ["open", "then"],  "to": ["show", "exec"] },
    { "from": ["close", "then"], "to": ["hide", "exec"] }
  ]
}
```

- `props` holds the block settings and the values typed into unconnected inputs (`target`, `className` above).
- `links` go from an output `[node, pin]` to an input `[node, pin]`.
- Loading normalizes the data: unknown kinds become `global`, wires to missing nodes are dropped, positions become numbers. Migrations from older schemas will live in `normalizeBlueprint`.

## What it compiles to

```js
// open · On element event
__bp_delegate(__d, root, "click", ".js-popup-open", function (event, self) {
  // show · Add class
  __bp_q(root, "#popup").forEach(function (el) { el.classList.add("is-open"); });
});
```

The page script is one IIFE: the blueprints first, then only the runtime helpers they use; it starts on `DOMContentLoaded`. Each blueprint returns a function that removes its listeners and timers (used by the preview).
