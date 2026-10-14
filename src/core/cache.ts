/**
 * Caching: an in-memory, bounded, single-flight cache for everything, and an optional {@link PersistentStore}
 * for data that never changes once published (complete days of historical spot prices).
 *
 * @module
 */

/**
 * Durable key–value storage for immutable data. Implement it on top of whatever you have – a directory
 * (see `fileStore` in the `/node` entry point), Redis, IndexedDB, a database table. Values are JSON strings.
 * Errors thrown by a store are swallowed: a broken store only makes the client slower, never wrong.
 */
export interface PersistentStore {
  /** Returns the stored value, or `undefined` when the key is unknown. */
  get(key: string): Promise<string | undefined> | string | undefined;
  /** Stores a value. */
  set(key: string, value: string): Promise<void> | void;
}

/** A {@link PersistentStore} that lives in memory – useful for tests and short-lived processes. */
export function memoryStore(): PersistentStore & { readonly size: number } {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    get size(): number {
      return map.size;
    },
  };
}

/** Time to live: a fixed number of milliseconds, or decided per value (for example shorter for "not found"). */
export type Ttl<V> = number | ((value: V) => number);

/** A bounded, expiring cache where concurrent requests for the same key share one load. */
export interface MemoryCache {
  /** Returns the cached value for `key`, or runs `load` (once, however many callers ask at the same time). */
  get<V>(key: string, ttl: Ttl<V>, load: () => Promise<V>): Promise<V>;
  /** Forgets everything. */
  clear(): void;
  /** Number of entries, including loads in flight. */
  readonly size: number;
}

/** Options for {@link createMemoryCache}. */
export interface MemoryCacheOptions {
  /** Maximum number of entries; the least recently used are evicted first. Default `500`. */
  maxEntries?: number;
  /** Clock, in milliseconds since the epoch. Default `Date.now`. */
  now?: () => number;
  /** When `false`, values are never kept, but concurrent loads are still shared. Default `true`. */
  enabled?: boolean;
}

/** Creates a {@link MemoryCache}. Failed loads are never cached. */
export function createMemoryCache(options: MemoryCacheOptions = {}): MemoryCache {
  const max = options.maxEntries ?? 500;
  if (!Number.isInteger(max) || max < 1) throw new RangeError("maxEntries must be a positive integer");
  const now = options.now ?? Date.now;
  const enabled = options.enabled ?? true;
  const entries = new Map<string, { expires: number; value: Promise<unknown> }>();

  return {
    get<V>(key: string, ttl: Ttl<V>, load: () => Promise<V>): Promise<V> {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) {
        entries.delete(key);
        entries.set(key, hit);
        return hit.value as Promise<V>;
      }
      entries.delete(key);
      const value = Promise.resolve().then(load);
      const entry = { expires: Infinity, value: value as Promise<unknown> };
      entries.set(key, entry);
      while (entries.size > max) entries.delete(entries.keys().next().value as string);
      value.then(
        (v) => {
          const ms = typeof ttl === "function" ? ttl(v) : ttl;
          if (!enabled || !(ms > 0)) {
            if (entries.get(key) === entry) entries.delete(key);
          } else entry.expires = now() + ms;
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
      return value;
    },
    clear() {
      entries.clear();
    },
    get size(): number {
      return entries.size;
    },
  };
}
