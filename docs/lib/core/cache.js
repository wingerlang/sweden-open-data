/**
 * Caching: an in-memory, bounded, single-flight cache for everything, and an optional {@link PersistentStore}
 * for data that never changes once published (complete days of historical spot prices).
 *
 * @module
 */
import { SourceError } from "./errors.js";
/** A {@link PersistentStore} that lives in memory – useful for tests and short-lived processes. */
export function memoryStore(options = {}) {
    const now = options.now ?? Date.now;
    const map = new Map();
    return {
        get: (key) => {
            const entry = map.get(key);
            if (entry && entry.expires <= now())
                map.delete(key);
            return map.get(key)?.value;
        },
        set: (key, value, setOptions) => {
            const ttl = setOptions?.ttlMs;
            map.set(key, { value, expires: ttl !== undefined && ttl >= 0 ? now() + ttl : Infinity });
        },
        get size() {
            return map.size;
        },
    };
}
const aborted = (source, cause) => new SourceError(`Request to ${source} was aborted`, { code: "aborted", source, cause });
/**
 * Lets one caller wait for a shared load with its own signal. A caller without a signal waits until the end and so
 * keeps the load alive; a caller with one leaves when it is aborted, and the last caller to leave aborts the load.
 */
function wait(entry, options) {
    const value = entry.value;
    const flight = entry.flight;
    const signal = options.signal;
    if (!flight)
        return value;
    flight.waiting++;
    if (!signal)
        return value;
    return new Promise((resolve, reject) => {
        const leave = () => {
            reject(aborted(options.source ?? "cache", signal.reason));
            if (--flight.waiting === 0)
                flight.controller.abort(signal.reason);
        };
        signal.addEventListener("abort", leave, { once: true });
        value.then(resolve, reject).finally(() => signal.removeEventListener("abort", leave));
    });
}
/** Creates a {@link MemoryCache}. Failed loads are never cached. */
export function createMemoryCache(options = {}) {
    const max = options.maxEntries ?? 500;
    if (!Number.isInteger(max) || max < 1)
        throw new RangeError("maxEntries must be a positive integer");
    const staleIfError = Math.max(0, options.staleIfErrorMs ?? 0);
    const now = options.now ?? Date.now;
    const enabled = options.enabled ?? true;
    const emit = options.onEvent ?? (() => { });
    const entries = new Map();
    const remember = (key, entry) => {
        entries.delete(key);
        entries.set(key, entry);
        while (entries.size > max)
            entries.delete(entries.keys().next().value);
    };
    return {
        get(key, ttl, load, getOptions = {}) {
            if (getOptions.signal?.aborted)
                return Promise.reject(aborted(getOptions.source ?? "cache", getOptions.signal.reason));
            const hit = entries.get(key);
            // A load every caller has abandoned is not joined: it is about to fail with "aborted".
            if (hit && hit.expires > now() && !hit.flight?.controller.signal.aborted) {
                remember(key, hit);
                emit({ type: "hit", key });
                return wait(hit, getOptions);
            }
            const previous = hit?.data && hit.staleUntil > now() ? hit : undefined;
            emit({ type: "miss", key });
            const controller = new AbortController();
            const entry = {
                expires: Infinity,
                staleUntil: Infinity,
                value: Promise.resolve(),
                flight: { controller, waiting: 0 },
            };
            const value = Promise.resolve(controller.signal)
                .then(load)
                .then((v) => {
                entry.flight = undefined;
                const ms = typeof ttl === "function" ? ttl(v) : ttl;
                if (!enabled || !(ms > 0)) {
                    if (entries.get(key) === entry)
                        entries.delete(key);
                }
                else {
                    entry.expires = now() + ms;
                    entry.staleUntil = entry.expires + staleIfError;
                    entry.data = { value: v };
                }
                return v;
            }, (error) => {
                entry.flight = undefined;
                if (entries.get(key) === entry)
                    entries.delete(key);
                if (!previous || controller.signal.aborted)
                    throw error;
                // Serve the last good value, and wait a minute before asking the failing source again.
                previous.expires = Math.min(previous.staleUntil, now() + 60_000);
                previous.value = Promise.resolve(previous.data?.value);
                if (!entries.has(key))
                    remember(key, previous);
                emit({ type: "stale", key });
                return previous.data?.value;
            });
            // Nobody may be listening when every caller has left; the rejection is then expected and not an error.
            value.catch(() => { });
            entry.value = value;
            remember(key, entry);
            return wait(entry, getOptions);
        },
        clear() {
            entries.clear();
        },
        get size() {
            return entries.size;
        },
    };
}
