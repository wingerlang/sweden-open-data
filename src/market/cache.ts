/** Durable public reference snapshots, bounded memory and background refresh.
 * @module
 */
import type { PersistentStore } from "../core/cache.ts";

/** Public data shape for MarketRead. */
export interface MarketRead<T> {
  value: T;
  fetchedAt: string;
  stale: boolean;
}
interface Entry<T> {
  value: T;
  at: number;
}
/** Only fixed-source public reference data belongs here. Never pass account/workspace payloads. */
export function createMarketReadCache<T>({
  store,
  now = Date.now,
  maxEntries = 128,
  timeoutMs = 6000,
  retryMs = 30000,
  valid,
}: {
  store?: PersistentStore;
  now?: () => number;
  maxEntries?: number;
  timeoutMs?: number;
  retryMs?: number;
  valid: (value: unknown, key?: string) => value is T;
}): (
  key: string,
  ttlMs: number,
  maxAgeMs: number,
  load: (signal: AbortSignal) => Promise<T>,
) => Promise<MarketRead<T>> {
  const memory = new Map<string, Entry<T>>(),
    pending = new Map<string, Promise<Entry<T>>>(),
    hydrating = new Map<string, Promise<Entry<T> | undefined>>(),
    failures = new Map<string, number>();
  const remember = (key: string, entry: Entry<T>) => {
    memory.delete(key);
    memory.set(key, entry);
    while (memory.size > maxEntries) memory.delete(memory.keys().next().value!);
  };
  const io = async <R>(work: () => R | Promise<R>, fallback: R): Promise<R> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise<R>((r) => {
          timer = setTimeout(() => r(fallback), 250);
        }),
      ]);
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  };
  const restore = (key: string) => {
    const existing = hydrating.get(key);
    if (existing) return existing;
    if (!store || hydrating.size >= 16) return Promise.resolve(undefined);
    const job = (async () => {
      const raw = await io(() => store.get(key), undefined);
      try {
        if (raw) {
          const row = JSON.parse(raw);
          if (row.schema === 1 && Number.isFinite(row.at) && row.at <= now() && valid(row.value, key))
            return { at: row.at, value: row.value as T };
        }
      } catch {
        /* Derived cache is disposable. */
      }
      return undefined;
    })().finally(() => hydrating.delete(key));
    hydrating.set(key, job);
    return job;
  };
  const refresh = (key: string, load: (signal: AbortSignal) => Promise<T>) => {
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 16 || Number(failures.get(key) || 0) > now())
      return Promise.reject(Error("Källan är tillfälligt otillgänglig."));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const job = (async () => {
      try {
        const value = await Promise.race([
          Promise.resolve().then(() => load(controller.signal)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(Error("Källan tog för lång tid."));
            }, timeoutMs);
          }),
        ]);
        if (!valid(value, key)) throw Error("Ogiltiga referensdata.");
        const entry = { value, at: now() };
        remember(key, entry);
        failures.delete(key);
        if (store) await io(() => store.set(key, JSON.stringify({ schema: 1, ...entry })), undefined);
        return entry;
      } catch (error) {
        failures.set(key, now() + retryMs);
        while (failures.size > maxEntries) failures.delete(failures.keys().next().value!);
        throw error;
      } finally {
        clearTimeout(timer);
        pending.delete(key);
      }
    })();
    pending.set(key, job);
    return job;
  };
  return async (
    key: string,
    ttlMs: number,
    maxAgeMs: number,
    load: (signal: AbortSignal) => Promise<T>,
  ): Promise<MarketRead<T>> => {
    if (!/^[A-Za-z0-9:%_.|^=-]{1,1024}$/.test(key)) throw Error("Ogiltig cachenyckel.");
    let saved = memory.get(key);
    if (!saved && store) {
      saved = await restore(key);
      if (saved) remember(key, saved);
    }
    const output = (entry: Entry<T>, stale: boolean) => ({
      value: entry.value,
      fetchedAt: new Date(entry.at).toISOString(),
      stale,
    });
    if (saved && now() - saved.at <= maxAgeMs) {
      const stale = now() - saved.at >= ttlMs;
      if (stale) void refresh(key, load).catch(() => {});
      return output(saved, stale);
    }
    return output(await refresh(key, load), false);
  };
}
