/** Creates a {@link StatsCollector}. */
export function createStats(now = Date.now) {
  let since = now();
  let cache = { hits: 0, misses: 0, stale: 0 };
  let sources = new Map();
  return {
    request(e) {
      const s = sources.get(e.source) ?? {
        requests: 0,
        failures: 0,
        retries: 0,
        averageMs: 0,
        totalMs: 0,
        lastStatus: null,
      };
      s.requests++;
      if (e.attempt > 1) s.retries++;
      if (e.error) {
        s.failures++;
        s.lastError = e.error.message;
      }
      s.totalMs += e.ms;
      s.averageMs = Math.round(s.totalMs / s.requests);
      s.lastStatus = e.status;
      s.lastAt = new Date(now()).toISOString();
      sources.set(e.source, s);
    },
    cache(e) {
      if (e.type === "hit") cache.hits++;
      else if (e.type === "miss") cache.misses++;
      else cache.stale++;
    },
    snapshot() {
      const list = [...sources.entries()];
      return {
        since: new Date(since).toISOString(),
        requests: list.reduce((a, [, s]) => a + s.requests, 0),
        failures: list.reduce((a, [, s]) => a + s.failures, 0),
        cache: { ...cache },
        sources: Object.fromEntries(list.map(([name, { totalMs: _total, ...s }]) => [name, { ...s }])),
      };
    },
    reset() {
      since = now();
      cache = { hits: 0, misses: 0, stale: 0 };
      sources = new Map();
    },
  };
}
