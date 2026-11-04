/**
 * Per-source request limits: at most `concurrency` requests at a time and at most `perMinute` started in any minute.
 * Free sources ask for fair use; a server with many users stays within it by queueing instead of being blocked.
 *
 * @module
 */
/**
 * Conservative defaults. Photon's public instance asks for moderate use, and an address search can fan out into
 * several requests; two at a time keeps one busy user from flooding it. Adjust to each source's own terms with
 * `limits` in the client options.
 */
export const DEFAULT_LIMITS = Object.freeze({
  yahoo: Object.freeze({ concurrency: 2 }),
  nasdaq: Object.freeze({ concurrency: 2 }),
  fred: Object.freeze({ concurrency: 2 }),
  mfn: Object.freeze({ concurrency: 2 }),
  photon: Object.freeze({ concurrency: 2 }),
  handelsbanken: Object.freeze({ concurrency: 1, perMinute: 10 }),
});
const MINUTE = 60_000;
function check(source, limit) {
  for (const key of ["concurrency", "perMinute"]) {
    const value = limit[key];
    if (value !== undefined && !(Number.isInteger(value) && value >= 1) && value !== Infinity) {
      throw new RangeError(`limits.${source}.${key} must be a positive integer`);
    }
  }
}
/** Creates a {@link Limiter}. `limits` are merged over {@link DEFAULT_LIMITS}. */
export function createLimiter(limits = {}, now = Date.now, schedule = setTimeout) {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  for (const [source, limit] of Object.entries(merged)) check(source, limit);
  const states = new Map();
  const state = (source) => {
    const limit = merged[source];
    if (!limit || (limit.concurrency === undefined && limit.perMinute === undefined)) return undefined;
    let s = states.get(source);
    if (!s) states.set(source, (s = { limit, active: 0, starts: [], queue: [] }));
    return s;
  };
  /** Starts as many queued requests as the limits allow, and schedules a retry when the minute window is full. */
  const pump = (s) => {
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
      const next = s.queue.shift();
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
        const release = () => {
          if (released) return;
          released = true;
          s.active--;
          pump(s);
        };
        const onAbort = () => {
          const i = s.queue.indexOf(waiter);
          if (i >= 0) s.queue.splice(i, 1);
          reject(signal?.reason);
        };
        const waiter = {
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
