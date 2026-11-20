import scriptsPlugin from './plugin';

export default scriptsPlugin;
export { getScripts, PANEL_BUTTON_ID } from './plugin';
export type { ScriptsApi } from './plugin';
export { COMMANDS, EVENTS } from './events';
export type { ScriptsPluginOptions } from './options';
export { ScriptsManager, DEFAULT_SETTINGS, componentTypeFrom, isValidComponentType } from './core/ScriptsManager';
export type { ScriptsData, ScriptsSettings, CreateScriptInit, BuildPageOptions, OutputMode, CodeAction } from './core/ScriptsManager';
export { normalizeCode, starterCode, targets, scopeIds, jsSyntaxError } from './core/code';
export type { CodeItem, CodeLang, CodeRun, CodeTarget, CreateCodeInit, PageScope } from './core/code';
export { pagesOf, canShare, shareWithPages } from './integration/pages';
export type { PagesLike } from './integration/pages';
export { locales, SUPPORTED_LOCALES } from './i18n';
export type { ScriptsLabels } from './i18n';
// The blueprint library (re-exported for compatibility; prefer importing `blueprintsjs`).
export * from 'blueprintsjs';
export * from 'blueprintsjs/editor';
export { locales as graphLocales } from 'blueprintsjs/locales';
export { BANNER } from './core/ScriptsManager';
export { libraryTags, normalizeLibrary, fileTypeOf } from './core/libraries';
export type { Library, LibraryFile } from './core/libraries';
export { cdnTools, processCode, DEFAULT_TOOL_URLS } from './core/output';
export type { OutputTools } from './core/output';
export { PRESETS, PROVIDERS, jsdelivr, cdnjs } from './libs/providers';
export type { LibraryProvider, PackageHit, PackageFile, HttpContext } from './libs/providers';
export type { PageExport, SiteExport } from './integration/export';
export { selectorCandidates } from './integration/picker';
