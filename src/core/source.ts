/**
 * Patterns shared by the clients: a cache backed by the {@link PersistentStore} that falls back to the last good copy,
 * and redaction of requests that carry personal data (registration numbers) before they reach hooks or errors.
 *
 * @module
 */
import type { CacheEvent } from "./cache.ts";
import { type Context, storeGet, storeSet } from "./context.ts";
import { SourceError } from "./errors.ts";
import type { RequestEvent } from "./http.ts";

/**
 * How long a copy is kept in the store as the fallback for when the source fails: 30 days. Older copies are no longer
 * useful as "the last known value", and the store must not grow for ever.
 */
export const STORE_RETENTION_MS: number = 30 * 86_400_000;

/** A result that says when it was fetched and whether it is an older copy. */
export interface Dated {
  readonly fetchedAt: string;
  readonly stale?: boolean;
}

/** Options for {@link cachedWithStore}. */
export interface CachedWithStoreOptions {
  /** Cancels this caller's wait; the shared load stops when every caller has cancelled. */
  signal?: AbortSignal;
  /** Name of the source, for errors and statistics. */
  source: string;
}

/**
 * Returns `key` from memory, else from the store while it is younger than `ttlMs`, else runs `load` and stores the
 * result, kept for {@link STORE_RETENTION_MS}. When `load` fails, the stored copy is returned with `stale: true`
 * instead of an error.
 * A fresh result never carries `stale`.
 */
export function cachedWithStore<T extends Dated>(
  ctx: Context,
  key: string,
  ttlMs: number,
  isValid: (value: unknown) => value is T,
  load: (signal: AbortSignal) => Promise<T>,
  options: CachedWithStoreOptions,
): Promise<T> {
  return ctx.cache.get(
    key,
    ttlMs,
    async (signal) => {
      const stored = await storeGet(ctx.store, key);
      const kept = isValid(stored) ? stored : undefined;
      if (kept && ctx.now() - Date.parse(kept.fetchedAt) < ttlMs) {
        const { stale: _stale, ...fresh } = kept;
        return fresh as T;
      }
      try {
        const value = await load(signal);
        await storeSet(ctx.store, key, value, STORE_RETENTION_MS);
        return value;
      } catch (error) {
        if (kept && !signal.aborted) return { ...kept, stale: true };
        throw error;
      }
    },
    options,
  );
}

/** How to describe a source whose requests carry personal data. */
export interface Redaction {
  /** Source name. */
  source: string;
  /** The URL to report instead of the real one, for example `https://…/regno/[redacted]`. */
  url: string;
  /** Message prefix for errors, for example `"Vehicle lookup failed"`. */
  message: string;
  /** The cache key to report instead of the real one. */
  cacheKey: string;
}

/** A copy of `error` without the URL, message or cause that could contain the personal data. */
export function redactError(error: SourceError, redaction: Redaction): SourceError {
  return new SourceError(`${redaction.message} (${error.code})`, {
    source: redaction.source,
    code: error.code,
    status: error.status,
    retryAfterMs: error.retryAfterMs,
    url: redaction.url,
  });
}

/** Hooks that pass redacted events on to the caller's own hooks. */
export function redactedHooks(
  hooks: { onRequest?: (event: RequestEvent) => void; onCacheEvent?: (event: CacheEvent) => void },
  redaction: Redaction,
): { onRequest: (event: RequestEvent) => void; onCacheEvent: (event: CacheEvent) => void } {
  return {
    onRequest: (event) =>
      hooks.onRequest?.({
        ...event,
        url: redaction.url,
        error: event.error ? redactError(event.error, redaction) : undefined,
      }),
    onCacheEvent: (event) => hooks.onCacheEvent?.({ ...event, key: redaction.cacheKey }),
  };
}
