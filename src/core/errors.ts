/**
 * Errors raised when an upstream data source cannot deliver.
 *
 * Invalid arguments (an unknown price area, coordinates outside the globe, a malformed date) throw a
 * standard {@link RangeError} before any request is made. Everything that goes wrong *after* that – timeouts,
 * network failures, HTTP errors, unexpected payloads – is reported as a {@link SourceError}.
 *
 * @module
 */

/** What went wrong when talking to a source. */
export type SourceErrorCode =
  /** The request did not complete within `timeoutMs`. */
  | "timeout"
  /** DNS, connection or TLS failure – the source could not be reached. */
  | "network"
  /** The source answered with a non-success HTTP status. */
  | "http"
  /** The source answered 429 Too Many Requests. */
  | "rate-limited"
  /** The source answered, but not with data in the documented format. */
  | "invalid-response"
  /** The request was cancelled through the caller's `AbortSignal`. */
  | "aborted";

/** Options for constructing a {@link SourceError}. */
export interface SourceErrorOptions {
  /** Machine-readable reason. */
  code: SourceErrorCode;
  /** Name of the source, for example `"open-meteo"`. */
  source: string;
  /** HTTP status, when the source answered. */
  status?: number;
  /** The URL that was requested. */
  url?: string;
  /** The underlying error, if any. */
  cause?: unknown;
  /** How long the source asked us to wait (`Retry-After`), in milliseconds. */
  retryAfterMs?: number;
}

/**
 * A data source failed. Inspect {@link SourceError.code} to decide what to do and
 * {@link SourceError.transient} to decide whether trying again later is worthwhile.
 *
 * @example
 * ```ts
 * try {
 *   await client.weather.forecast({ latitude: 59.33, longitude: 18.07 });
 * } catch (error) {
 *   if (error instanceof SourceError && error.transient) showRetryLater();
 *   else throw error;
 * }
 * ```
 */
export class SourceError extends Error {
  /** Machine-readable reason. */
  readonly code: SourceErrorCode;
  /** Name of the source that failed, for example `"elprisetjustnu"`. */
  readonly source: string;
  /** HTTP status, when the source answered. */
  readonly status: number | undefined;
  /** The URL that was requested. */
  readonly url: string | undefined;
  /** How long the source asked us to wait before trying again (`Retry-After`), in milliseconds. */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: SourceErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SourceError";
    this.code = options.code;
    this.source = options.source;
    this.status = options.status;
    this.url = options.url;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** `true` when the same request may well succeed later (timeouts, network errors, 429 and 5xx). */
  get transient(): boolean {
    return (
      this.code === "timeout" ||
      this.code === "network" ||
      this.code === "rate-limited" ||
      (this.code === "http" && (this.status ?? 0) >= 500)
    );
  }
}
