/**
 * Per-source request limits: at most `concurrency` requests at a time and at most `perMinute` started in any minute.
 * Free sources ask for fair use; a server with many users stays within it by queueing instead of being blocked.
 *
 * @module
 */

/** Limits for one source. Leave a field out for no limit. */
export interface SourceLimit {
  /** Requests in flight at the same time. */
  concurrency?: number;
  /** Requests started in any 60-second window. */
  perMinute?: number;
}

/**
 * Conservative defaults. Photon's public instance asks for moderate use, and an address search can fan out into
 * several requests; two at a time keeps one busy user from flooding it. Adjust to each source's own terms with
 * `limits` in the client options.
 */
export const DEFAULT_LIMITS: Readonly<Record<string, SourceLimit>> = Object.freeze({
  photon: Object.freeze({ concurrency: 2 }),
});

/** Gives out permission to start a request, per source. */
export interface Limiter {
  /** Waits for a free slot for `source`; resolves to a function that frees it again. Rejects when `signal` aborts. */
  acquire(source: string, signal?: AbortSignal): Promise<() => void>;
}

interface Waiter {
  start: () => void;
  signal?: AbortSignal;
}

interface State {
  limit: SourceLimit;
  active: number;
  /** Start times within the last minute, oldest first. */
  starts: number[];
  queue: Waiter[];
  timer?: unknown;
}

const MINUTE = 60_000;

function check(source: string, limit: SourceLimit): void {
  for (const key of ["concurrency", "perMinute"] as const) {
    const value = limit[key];
    if (value !== undefined && !(Number.isInteger(value) && value >= 1) && value !== Infinity) {
      throw new RangeError(`limits.${source}.${key} must be a positive integer`);
    }
  }
}

/** Creates a {@link Limiter}. `limits` are merged over {@link DEFAULT_LIMITS}. */
export function createLimiter(
  limits: Record<string, SourceLimit> = {},
  now: () => number = Date.now,
  schedule: (run: () => void, ms: number) => unknown = setTimeout,
): Limiter {
  const merged: Record<string, SourceLimit> = { ...DEFAULT_LIMITS, ...limits };
  for (const [source, limit] of Object.entries(merged)) check(source, limit);
  const states = new Map<string, State>();

  const state = (source: string): State | undefined => {
    const limit = merged[source];
    if (!limit || (limit.concurrency === undefined && limit.perMinute === undefined)) return undefined;
    let s = states.get(source);
    if (!s) states.set(source, (s = { limit, active: 0, starts: [], queue: [] }));
    return s;
  };

  /** Starts as many queued requests as the limits allow, and schedules a retry when the minute window is full. */
  const pump = (s: State): void => {
    for (;;) {
      while (s.queue.length && s.queue[0].signal?.aborted) s.queue.shift();
      if (!s.queue.length) return;
      if (s.limit.concurrency !== undefined && s.active >= s.limit.concurrency) return;
      const t = now();
      while (s.starts.length && s.starts[0] <= t - MINUTE) s.starts.shift();
      if (s.limit.perMinute !== undefined && s.starts.length >= s.limit.perMinute) {
        if (!s.timer) {
          s.timer = schedule(
            () => {
              s.timer = undefined;
              pump(s);
            },
            s.starts[0] + MINUTE - t,
          );
        }
        return;
      }
      const next = s.queue.shift() as Waiter;
      s.active++;
      s.starts.push(t);
      next.start();
    }
  };

  return {
    acquire(source, signal) {
      const s = state(source);
      if (!s) return Promise.resolve(() => {});
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          s.active--;
          pump(s);
        };
        const onAbort = (): void => {
          const i = s.queue.indexOf(waiter);
          if (i >= 0) s.queue.splice(i, 1);
          reject(signal?.reason);
        };
        const waiter: Waiter = {
          signal,
          start: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve(release);
          },
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        s.queue.push(waiter);
        pump(s);
      });
    },
  };
}
