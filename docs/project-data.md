# Project data

The plugin keeps its data in the GrapesJS project data (`editor.getProjectData().scripts`), so any storage that saves the project saves the scripts too:

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

Each item of `blueprints` is a blueprint in the [blueprintsjs format](https://unpkg.com/blueprintsjs/docs/schema.md) ([JSON Schema](https://unpkg.com/blueprintsjs/schema/blueprint.schema.json)). Template blueprints keep the GrapesJS page ids in `target.pages`; component blueprints keep the component type, block label, HTML, CSS and parameters in `component`.

Loading goes through `normalizeBlueprint`, so hand-edited or older data is repaired, not rejected.
