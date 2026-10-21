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
  /**
   * Largest response body accepted, in bytes. A larger answer is cut off and reported as a {@link SourceError} with
   * code `"invalid-response"`, so a misbehaving mirror or proxy cannot fill the memory. Default `5000000` (5 MB).
   */
  maxResponseBytes?: number;
}

/** Per-request options. */
export interface RequestOptions {
  /** Read-only POST APIs such as IBIndex. */
  method?: "GET" | "POST";
  body?: unknown;
  /** Cancels the request (and any pending retry). */
  signal?: AbortSignal;
  /** Return `undefined` instead of throwing when the source answers 404. */
  allowNotFound?: boolean;
  /** `"error"` rejects redirects (for sources where a redirect means something is wrong). Default `"follow"`. */
  redirect?: "follow" | "error";
}

/** The interface the clients use to fetch JSON (and, for HTML sources, text). */
export interface Http {
  /** Fetches and parses JSON from `url`, attributing failures to `source`. */
  json(source: string, url: string | URL, options?: RequestOptions): Promise<unknown>;
  /** Fetches `url` as text, with the same timeouts, retries and size limit. */
  text(source: string, url: string | URL, options?: RequestOptions): Promise<string | undefined>;
}

/** Reads a body as UTF-8 text, giving up as soon as it grows past `limit` bytes. */
async function readText(response: Response, limit: number, tooLarge: () => SourceError): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
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
  const maxResponseBytes = options.maxResponseBytes ?? 5_000_000;
  if (!(maxResponseBytes > 0)) throw new RangeError("maxResponseBytes must be positive");
  const baseHeaders: Record<string, string> = {};
  if (options.userAgent) baseHeaders["user-agent"] = options.userAgent;

  type Kind = "json" | "text";
  async function attempt(
    source: string,
    url: string,
    request: RequestOptions,
    n: number,
    kind: Kind,
  ): Promise<unknown> {
    const doFetch = options.fetch ?? globalThis.fetch;
    const started = Date.now();
    // An own timer rather than AbortSignal.timeout(): that one is unref'd in Node and cannot be cleared.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
    const signal = combine(request.signal ? [timeout.signal, request.signal] : [timeout.signal]);
    let status: number | null = null;
    try {
      const headers: Record<string, string> = {
        ...baseHeaders,
        accept: kind === "json" ? "application/json" : "text/html, text/plain;q=0.9, */*;q=0.1",
      };
      if (request.body !== undefined) headers["content-type"] = "application/json;charset=UTF-8";
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
        const retryAfterMs =
          response.status === 429 || response.status === 503
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
      const text = await readText(
        response,
        maxResponseBytes,
        () =>
          new SourceError(`${source} answered with more than ${maxResponseBytes} bytes`, {
            code: "invalid-response",
            source,
            status: response.status,
            url,
          }),
      );
      let body: unknown = text;
      if (kind === "json") {
        try {
          body = JSON.parse(text);
        } catch (cause) {
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
    } catch (cause) {
      const error =
        cause instanceof SourceError
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
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(source: string, url: string | URL, request: RequestOptions, kind: Kind): Promise<unknown> {
    const href = String(url);
    for (let n = 1; ; n++) {
      try {
        return await attempt(source, href, request, n, kind);
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
  }

  return {
    json: (source, url, request = {}) => run(source, url, request, "json"),
    text: (source, url, request = {}) => run(source, url, request, "text") as Promise<string | undefined>,
  };
}
