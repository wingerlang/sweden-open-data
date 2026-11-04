import { storeGet, storeSet } from "./context.js";
import { SourceError } from "./errors.js";
/**
 * How long a copy is kept in the store as the fallback for when the source fails: 30 days. Older copies are no longer
 * useful as "the last known value", and the store must not grow for ever.
 */
export const STORE_RETENTION_MS = 30 * 86_400_000;
/**
 * Returns `key` from memory, else from the store while it is younger than `ttlMs`, else runs `load` and stores the
 * result, kept for {@link STORE_RETENTION_MS}. When `load` fails, the stored copy is returned with `stale: true`
 * instead of an error.
 * A fresh result never carries `stale`.
 */
export function cachedWithStore(ctx, key, ttlMs, isValid, load, options) {
  return ctx.cache.get(
    key,
    ttlMs,
    async (signal) => {
      const stored = await storeGet(ctx.store, key);
      const kept = isValid(stored) ? stored : undefined;
      if (kept && ctx.now() - Date.parse(kept.fetchedAt) < ttlMs) {
        const { stale: _stale, ...fresh } = kept;
        return fresh;
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
/** A copy of `error` without the URL, message or cause that could contain the personal data. */
export function redactError(error, redaction) {
  return new SourceError(`${redaction.message} (${error.code})`, {
    source: redaction.source,
    code: error.code,
    status: error.status,
    retryAfterMs: error.retryAfterMs,
    url: redaction.url,
  });
}
/** Hooks that pass redacted events on to the caller's own hooks. */
export function redactedHooks(hooks, redaction) {
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
