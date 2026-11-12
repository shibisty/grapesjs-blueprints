import { highlight as hl } from '../blueprint/editor/highlight';

export { tokenize } from '../blueprint/editor/highlight';
export type { TokenKind } from '../blueprint/editor/highlight';

/** Code view of the plugin dialogs (`gjscr-` classes). */
export const highlight = (code: string): HTMLElement => hl(code, 'gjscr');
