/** Events the plugin triggers on the editor (`editor.on(EVENTS.change, …)`). */
export const EVENTS = {
  /** The script list or a script changed. Payload: `{ type: 'add'|'update'|'remove'|'load', id? }`. */
  change: 'scripts:change',
  /** A script was created. Payload: the `Blueprint`. */
  add: 'scripts:add',
  /** A script was changed. Payload: the `Blueprint`. */
  update: 'scripts:update',
  /** A script was deleted. Payload: the `Blueprint`. */
  remove: 'scripts:remove',
  /** Output settings changed. Payload: `ScriptsSettings`. */
  settings: 'scripts:settings',
  /** A script should be edited (the graph editor listens). Payload: `{ id }`. */
  edit: 'scripts:edit',
  /** Scripts started/stopped in the canvas preview. Payload: `{ running }`. */
  preview: 'scripts:preview',
} as const;

/** Command ids registered by the plugin. */
export const COMMANDS = {
  /** Show the Scripts sidebar. */
  open: 'scripts:open',
  toggle: 'scripts:toggle',
  /** New-script dialog. Options: `{ kind? }`. */
  create: 'scripts:create',
  /** Edit a script. Options: `{ id }`. */
  edit: 'scripts:edit',
  /** JavaScript of a script (`{ id }`) or of all scripts (no id). */
  code: 'scripts:code',
  /** Settings dialog (output, export, libraries). */
  settings: 'scripts:open-settings',
  /** Add-a-library dialog. */
  libraries: 'scripts:add-library',
  /** Export: `{ pageId }` → `PageExport`, no options → `SiteExport` (Promise). */
  export: 'scripts:export',
  /** Build the page script. Options: `BuildPageOptions`. Returns `BuildResult`. */
  build: 'scripts:build',
} as const;
