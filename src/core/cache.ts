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

/** What the cache did for a request – see {@link MemoryCacheOptions.onEvent}. */
export interface CacheEvent {
  /** `hit`: a fresh value was reused. `miss`: the value was loaded. `stale`: loading failed and an expired value was served. */
  type: "hit" | "miss" | "stale";
  key: string;
}

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
  /**
   * Serve an expired value for up to this long after it expired when loading a fresh one fails – a dashboard keeps
   * showing the last known forecast instead of an error while a source is down. While stale data is served, the
   * source is asked again at most once a minute. Results carry `fetchedAt`, so you can show their age. Default `0`
   * (never serve stale data).
   */
  staleIfErrorMs?: number;
  /** Called for every hit, miss and stale answer – for statistics and debugging. Must not throw. */
  onEvent?: (event: CacheEvent) => void;
}

interface Entry {
  expires: number;
  staleUntil: number;
  value: Promise<unknown>;
  data?: { value: unknown };
}

/** Creates a {@link MemoryCache}. Failed loads are never cached. */
export function createMemoryCache(options: MemoryCacheOptions = {}): MemoryCache {
  const max = options.maxEntries ?? 500;
  if (!Number.isInteger(max) || max < 1) throw new RangeError("maxEntries must be a positive integer");
  const staleIfError = Math.max(0, options.staleIfErrorMs ?? 0);
  const now = options.now ?? Date.now;
  const enabled = options.enabled ?? true;
  const emit = options.onEvent ?? ((): void => {});
  const entries = new Map<string, Entry>();
  const remember = (key: string, entry: Entry): void => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > max) entries.delete(entries.keys().next().value as string);
  };

  return {
    get<V>(key: string, ttl: Ttl<V>, load: () => Promise<V>): Promise<V> {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) {
        remember(key, hit);
        emit({ type: "hit", key });
        return hit.value as Promise<V>;
      }
      const previous = hit?.data && hit.staleUntil > now() ? hit : undefined;
      emit({ type: "miss", key });
      const entry: Entry = { expires: Infinity, staleUntil: Infinity, value: Promise.resolve() };
      const value = Promise.resolve().then(load).then(
        (v) => {
          const ms = typeof ttl === "function" ? ttl(v) : ttl;
          if (!enabled || !(ms > 0)) {
            if (entries.get(key) === entry) entries.delete(key);
          } else {
            entry.expires = now() + ms;
            entry.staleUntil = entry.expires + staleIfError;
            entry.data = { value: v };
          }
          return v;
        },
        (error: unknown) => {
          if (entries.get(key) === entry) entries.delete(key);
          if (!previous) throw error;
          // Serve the last good value, and wait a minute before asking the failing source again.
          previous.expires = Math.min(previous.staleUntil, now() + 60_000);
          previous.value = Promise.resolve(previous.data?.value);
          if (!entries.has(key)) remember(key, previous);
          emit({ type: "stale", key });
          return previous.data?.value as V;
        },
      );
      entry.value = value;
      remember(key, entry);
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
