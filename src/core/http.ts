/**
 * A small JSON-over-HTTP layer shared by all clients: timeouts, retries with backoff for transient failures,
 * cancellation and an observability hook. It only uses web-standard APIs (`fetch`, `AbortSignal`, `URL`).
 *
 * @module
 */
import { SourceError } from "./errors.ts";

/** Reported to {@link HttpOptions.onRequest} after every attempt. */
export interface RequestEvent {
  /** Name of the source, for example `"open-meteo"`. */
  source: string;
  /** The requested URL. */
  url: string;
  /** HTTP status, or `null` when no response arrived. */
  status: number | null;
  /** Duration of the attempt in milliseconds. */
  ms: number;
  /** 1 for the first attempt, 2 for the first retry and so on. */
  attempt: number;
  /** Set when the attempt failed. */
  error?: SourceError;
}

/** Network behaviour. Every field has a sensible default. */
export interface HttpOptions {
  /** `fetch` implementation. Defaults to the global `fetch`. Handy for tests, proxies and instrumentation. */
  fetch?: typeof fetch;
  /** Abort a single attempt after this many milliseconds. Default `10000`. */
  timeoutMs?: number;
  /** Extra attempts after a transient failure (timeout, network error, 429 or 5xx). Default `1`. */
  retries?: number;
  /** Delay before the first retry; doubled for each further retry. Default `500`. */
  retryDelayMs?: number;
  /**
   * Longest wait before a retry. A source that answers 429 or 503 with a longer `Retry-After` is not retried –
   * the error is returned at once, with {@link SourceError.retryAfterMs} set. Default `10000`.
   */
  maxRetryDelayMs?: number;
  /**
   * Sent as `User-Agent` where the runtime allows it (not in browsers). Several sources ask that automated
   * clients identify themselves, so setting this to your application name and a contact URL is good manners.
   */
  userAgent?: string;
  /** Called after every attempt – for logging, metrics or tracing. Must not throw. */
  onRequest?: (event: RequestEvent) => void;
}

/** Per-request options. */
export interface RequestOptions {
  /** Cancels the request (and any pending retry). */
  signal?: AbortSignal;
  /** Return `undefined` instead of throwing when the source answers 404. */
  allowNotFound?: boolean;
}

/** The interface the clients use to fetch JSON. */
export interface Http {
  /** Fetches and parses JSON from `url`, attributing failures to `source`. */
  json(source: string, url: string | URL, options?: RequestOptions): Promise<unknown>;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** `Retry-After` as milliseconds: either seconds (`"120"`) or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function combine(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
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
export function createHttp(options: HttpOptions = {}): Http {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = Math.max(0, Math.floor(options.retries ?? 1));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 500);
  const maxRetryDelayMs = Math.max(0, options.maxRetryDelayMs ?? 10_000);
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.userAgent) headers["user-agent"] = options.userAgent;

  async function attempt(source: string, url: string, request: RequestOptions, n: number): Promise<unknown> {
    const doFetch = options.fetch ?? globalThis.fetch;
    const started = Date.now();
    // An own timer rather than AbortSignal.timeout(): that one is unref'd in Node and cannot be cleared.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
    const signal = combine(request.signal ? [timeout.signal, request.signal] : [timeout.signal]);
    let status: number | null = null;
    try {
      const response = await doFetch(url, { headers, signal });
      status = response.status;
      if (response.status === 404 && request.allowNotFound) {
        await response.body?.cancel();
        options.onRequest?.({ source, url, status, ms: Date.now() - started, attempt: n });
        return undefined;
      }
      if (!response.ok) {
        const retryAfterMs = response.status === 429 || response.status === 503 ? parseRetryAfter(response.headers?.get("retry-after")) : undefined;
        await response.body?.cancel();
        throw new SourceError(`${source} answered HTTP ${response.status}`, {
          code: response.status === 429 ? "rate-limited" : "http",
          source,
          status: response.status,
          url,
          retryAfterMs,
        });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        if (signal.aborted) throw cause;
        throw new SourceError(`${source} did not answer with JSON`, { code: "invalid-response", source, status, url, cause });
      }
      options.onRequest?.({ source, url, status, ms: Date.now() - started, attempt: n });
      return body;
    } catch (cause) {
      const error = cause instanceof SourceError ? cause : request.signal?.aborted
        ? new SourceError(`Request to ${source} was aborted`, { code: "aborted", source, url, cause })
        : timeout.signal.aborted
        ? new SourceError(`${source} did not answer within ${timeoutMs} ms`, { code: "timeout", source, url, cause })
        : new SourceError(`Could not reach ${source}`, { code: "network", source, url, cause });
      options.onRequest?.({ source, url, status, ms: Date.now() - started, attempt: n, error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async json(source, url, request = {}) {
      const href = String(url);
      for (let n = 1;; n++) {
        try {
          return await attempt(source, href, request, n);
        } catch (error) {
          if (!(error instanceof SourceError) || !error.transient || n > retries) throw error;
          const delay = Math.max(retryDelayMs * 2 ** (n - 1), error.retryAfterMs ?? 0);
          if (delay > maxRetryDelayMs) throw error;
          try {
            await sleep(delay, request.signal);
          } catch (cause) {
            throw new SourceError(`Request to ${source} was aborted`, { code: "aborted", source, url: href, cause });
          }
        }
      }
    },
  };
}
