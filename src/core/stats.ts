/**
 * Counters for requests and cache use, per source – for health pages, metrics and the dev board.
 *
 * @module
 */
import type { CacheEvent } from "./cache.ts";
import type { RequestEvent } from "./http.ts";

/** Counters for one source. */
export interface SourceStats {
  /** Attempts, including retries. */
  requests: number;
  /** Attempts that failed. */
  failures: number;
  /** Attempts after the first for the same request. */
  retries: number;
  /** Mean duration of an attempt in milliseconds. */
  averageMs: number;
  /** Status of the latest attempt (`null` when it got no response). */
  lastStatus: number | null;
  /** Message of the latest failure. */
  lastError?: string;
  /** When the latest attempt finished (ISO 8601). */
  lastAt?: string;
}

/** A snapshot of a client's counters. */
export interface ClientStats {
  /** When counting started (ISO 8601). */
  since: string;
  /** Attempts over all sources. */
  requests: number;
  /** Failed attempts over all sources. */
  failures: number;
  /** In-memory cache: fresh hits, loads, and stale values served because a source failed. */
  cache: { hits: number; misses: number; stale: number };
  /** Per source, for example `"open-meteo"`. */
  sources: Record<string, SourceStats>;
}

/** Collects {@link ClientStats}. */
export interface StatsCollector {
  request(event: RequestEvent): void;
  cache(event: CacheEvent): void;
  snapshot(): ClientStats;
  reset(): void;
}

/** Creates a {@link StatsCollector}. */
export function createStats(now: () => number = Date.now): StatsCollector {
  let since = now();
  let cache = { hits: 0, misses: 0, stale: 0 };
  let sources = new Map<string, SourceStats & { totalMs: number }>();
  return {
    request(e) {
      const s = sources.get(e.source) ?? { requests: 0, failures: 0, retries: 0, averageMs: 0, totalMs: 0, lastStatus: null };
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
