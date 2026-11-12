import { NodeRegistry } from '../core/registry';
import type { NodeDef } from '../core/types';
import { DATA_NODES } from './data';
import { DOM_NODES } from './dom';
import { EVENT_NODES } from './events';
import { FLOW_NODES } from './flow';
import { LIB_NODES } from './lib';

export * from './data';
export * from './dom';
export * from './events';
export * from './flow';
export * from './lib';

/** Every built-in node definition. */
export const BUILTIN_NODES: NodeDef[] = [...EVENT_NODES, ...FLOW_NODES, ...DOM_NODES, ...DATA_NODES, ...LIB_NODES];

/** A registry with the built-in nodes plus `extra` (same type replaces a built-in). */
export function createRegistry(extra: NodeDef[] = []): NodeRegistry {
  return new NodeRegistry([...BUILTIN_NODES, ...extra]);
}
