/**
 * A small JSON-over-HTTP layer shared by all clients: timeouts, retries with backoff for transient failures,
 * cancellation and an observability hook. It only uses web-standard APIs (`fetch`, `AbortSignal`, `URL`).
 *
 * @module
 */
import { SourceError } from "./errors.js";
import { createLimiter } from "./limit.js";
/** Reads a body as UTF-8 text, giving up as soon as it grows past `limit` bytes. */
async function readText(response, limit, tooLarge) {
    const reader = response.body?.getReader();
    if (!reader)
        return "";
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > limit) {
                try {
                    await reader.cancel();
                }
                catch {
                    // The body is abandoned either way.
                }
                throw tooLarge();
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted)
        return reject(signal.reason);
    const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
    }, ms);
    const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
});
/** `Retry-After` as milliseconds: either seconds (`"120"`) or an HTTP date. */
export function parseRetryAfter(value, now = Date.now()) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed))
        return Number(trimmed) * 1000;
    const date = Date.parse(trimmed);
    return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
function combine(signals) {
    if (signals.length === 1)
        return signals[0];
    if (typeof AbortSignal.any === "function")
        return AbortSignal.any(signals);
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}
/** Creates the shared HTTP layer. */
export function createHttp(options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const retries = Math.max(0, Math.floor(options.retries ?? 1));
    const retryDelayMs = Math.max(0, options.retryDelayMs ?? 500);
    const maxRetryDelayMs = Math.max(0, options.maxRetryDelayMs ?? 10_000);
    const maxResponseBytes = options.maxResponseBytes ?? 5_000_000;
    if (!(maxResponseBytes > 0))
        throw new RangeError("maxResponseBytes must be positive");
    const limiter = createLimiter(options.limits);
    const baseHeaders = {};
    if (options.userAgent)
        baseHeaders["user-agent"] = options.userAgent;
    async function attempt(source, url, request, n, kind) {
        const doFetch = options.fetch ?? globalThis.fetch;
        const started = Date.now();
        // An own timer rather than AbortSignal.timeout(): that one is unref'd in Node and cannot be cleared.
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
        const signal = combine(request.signal ? [timeout.signal, request.signal] : [timeout.signal]);
        let status = null;
        try {
            const headers = {
                ...baseHeaders,
                accept: kind === "json" ? "application/json" : "text/html, text/plain;q=0.9, */*;q=0.1",
            };
            if (request.body !== undefined)
                headers["content-type"] = "application/json;charset=UTF-8";
            const response = await doFetch(url, {
                headers,
                signal,
                ...(request.method ? { method: request.method } : {}),
                ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
                ...(request.redirect ? { redirect: request.redirect } : {}),
            });
            status = response.status;
            if (response.status === 404 && request.allowNotFound) {
                await response.body?.cancel();
                options.onRequest?.({ source, url, status, ms: Date.now() - started, attempt: n });
                return undefined;
            }
            if (!response.ok) {
                const retryAfterMs = response.status === 429 || response.status === 503
                    ? parseRetryAfter(response.headers?.get("retry-after"))
                    : undefined;
                await response.body?.cancel();
                throw new SourceError(`${source} answered HTTP ${response.status}`, {
                    code: response.status === 429 ? "rate-limited" : "http",
                    source,
                    status: response.status,
                    url,
                    retryAfterMs,
                });
            }
            const text = await readText(response, maxResponseBytes, () => new SourceError(`${source} answered with more than ${maxResponseBytes} bytes`, {
                code: "invalid-response",
                source,
                status: response.status,
                url,
            }));
            let body = text;
            if (kind === "json") {
                try {
                    body = JSON.parse(text);
                }
                catch (cause) {
                    throw new SourceError(`${source} did not answer with JSON`, {
                        code: "invalid-response",
                        source,
                        status,
                        url,
                        cause,
                    });
                }
            }
            options.onRequest?.({ source, url, status, ms: Date.now() - started, attempt: n });
            return body;
        }
        catch (cause) {
            const error = cause instanceof SourceError
                ? cause
                : request.signal?.aborted
                    ? new SourceError(`Request to ${source} was aborted`, { code: "aborted", source, url, cause })
                    : timeout.signal.aborted
                        ? new SourceError(`${source} did not answer within ${timeoutMs} ms`, {
                            code: "timeout",
                            source,
                            url,
                            cause,
                        })
                        : new SourceError(`Could not reach ${source}`, { code: "network", source, url, cause });
            options.onRequest?.({ source, url, status, ms: Date.now() - started, attempt: n, error });
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function run(source, url, request, kind) {
        const href = String(url);
        for (let n = 1;; n++) {
            let release;
            try {
                release = await limiter.acquire(source, request.signal);
            }
            catch (cause) {
                throw new SourceError(`Request to ${source} was aborted`, { code: "aborted", source, url: href, cause });
            }
            let error;
            try {
                return await attempt(source, href, request, n, kind);
            }
            catch (cause) {
                error = cause;
            }
            finally {
                // The slot is free again before any backoff, so a waiting retry never blocks other requests.
                release();
            }
            if (!(error instanceof SourceError) || !error.transient || n > retries)
                throw error;
            const delay = Math.max(retryDelayMs * 2 ** (n - 1), error.retryAfterMs ?? 0);
            if (delay > maxRetryDelayMs)
                throw error;
            try {
                await sleep(delay, request.signal);
            }
            catch (cause) {
                throw new SourceError(`Request to ${source} was aborted`, { code: "aborted", source, url: href, cause });
            }
        }
    }
    return {
        json: (source, url, request = {}) => run(source, url, request, "json"),
        text: (source, url, request = {}) => run(source, url, request, "text"),
    };
}
