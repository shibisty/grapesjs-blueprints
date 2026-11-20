import { highlight as hl } from 'blueprintsjs/editor';

export { tokenize } from 'blueprintsjs/editor';
export type { TokenKind } from 'blueprintsjs/editor';

/** Code view of the plugin dialogs (`gjscr-` classes). */
export const highlight = (code: string): HTMLElement => hl(code, 'gjscr');
