/**
 * Loading is asynchronous (a GLB is parsed, IndexedDB is read), so two loads can overlap. Each
 * starts with `beginLoad()`; only the newest ticket is still `current()` when its work ends, so
 * a slow load that finishes after a later quick one is dropped instead of overwriting it.
 */
export interface LoadTicket {
  /** True while no later load has started. */
  current: () => boolean;
}

let latest = 0;

export function beginLoad(): LoadTicket {
  const id = ++latest;
  return { current: () => id === latest };
}
