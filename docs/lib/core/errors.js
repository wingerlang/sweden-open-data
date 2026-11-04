/**
 * Errors raised when an upstream data source cannot deliver.
 *
 * Invalid arguments (an unknown price area, coordinates outside the globe, a malformed date) throw a
 * standard {@link RangeError} before any request is made. Everything that goes wrong *after* that – timeouts,
 * network failures, HTTP errors, unexpected payloads – is reported as a {@link SourceError}.
 *
 * @module
 */
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
  code;
  /** Name of the source that failed, for example `"elprisetjustnu"`. */
  source;
  /** HTTP status, when the source answered. */
  status;
  /** The URL that was requested. */
  url;
  /** How long the source asked us to wait before trying again (`Retry-After`), in milliseconds. */
  retryAfterMs;
  constructor(message, options) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SourceError";
    this.code = options.code;
    this.source = options.source;
    this.status = options.status;
    this.url = options.url;
    this.retryAfterMs = options.retryAfterMs;
  }
  /** `true` when the same request may well succeed later (timeouts, network errors, 429 and 5xx). */
  get transient() {
    return (
      this.code === "timeout" ||
      this.code === "network" ||
      this.code === "rate-limited" ||
      (this.code === "http" && (this.status ?? 0) >= 500)
    );
  }
}
