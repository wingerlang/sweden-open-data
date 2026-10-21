/**
 * Swedish open data in one small, dependency-free, typed package: **electricity spot prices**, **weather**,
 * **VMA, crisis information and SMHI warnings**, **geocoding** that understands Swedish addresses, and
 * **consumer price indices** with inflation arithmetic.
 *
 * The core sources are free and need no API key. The optional `/vehicles` module requires a provider API key. The client adds what production use needs: caching with sensible
 * lifetimes, sharing of concurrent identical requests, timeouts, retries with backoff, cancellation, typed errors
 * and privacy-preserving rounding of positions.
 *
 * ```ts
 * import { createClient } from "@wingerlang/sweden-open-data";
 *
 * const se = createClient({ userAgent: "my-app/1.0 (https://example.com)" });
 *
 * const { today, tomorrow } = await se.spot.prices("SE3");
 * const forecast = await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
 * const { alerts } = await se.alerts.near([{ latitude: 59.33, longitude: 18.07 }]);
 * const [address] = await se.geo.addresses("Drottninggatan 1, Stockholm");
 * const kpi = await se.economy.cpi("KPI");
 * ```
 *
 * Each area is also available on its own (`/spot`, `/weather`, `/alerts`, `/geo`, `/economy`), and all parsing and analysis
 * functions are pure, so they work on data you already have.
 *
 * @module
 */
import { type ClientOptions, createContext } from "./core/context.ts";
import { type AlertsClient, createAlertsClient } from "./alerts/client.ts";
import { type GeoClient, createGeoClient } from "./geo/client.ts";
import { type SpotClient, createSpotClient } from "./spot/client.ts";
import { type WeatherClient, createWeatherClient } from "./weather/client.ts";
import { type EconomyClient, createEconomyClient } from "./economy/client.ts";
import type { ClientStats } from "./core/stats.ts";

/** All clients, sharing one cache and one network configuration. */
export interface SwedenOpenData {
  /** Electricity spot prices. */
  readonly spot: SpotClient;
  /** Weather forecasts. */
  readonly weather: WeatherClient;
  /** VMA, crisis information and weather warnings. */
  readonly alerts: AlertsClient;
  /** Addresses, places and regions. */
  readonly geo: GeoClient;
  /** Consumer price indices (KPI, KPIF, KPIF-XE) from SCB. */
  readonly economy: EconomyClient;
  /** Empties the in-memory cache. */
  clearCache(): void;
  /** Requests, failures, retries and cache use since the client was created (or since {@link SwedenOpenData.resetStats}). */
  stats(): ClientStats;
  /** Starts counting from zero. */
  resetStats(): void;
}

/**
 * Creates a client for all sources. Create it once and reuse it – the cache lives in the client.
 *
 * @example Zero configuration
 * ```ts
 * const se = createClient();
 * ```
 *
 * @example Production server
 * ```ts
 * import { fileStore } from "@wingerlang/sweden-open-data/node";
 *
 * const se = createClient({
 *   userAgent: "my-app/1.0 (https://example.com)",
 *   timeoutMs: 8000,
 *   retries: 2,
 *   store: fileStore("./cache"),            // keep historical prices across restarts
 *   onRequest: (e) => metrics.observe(e.source, e.ms, e.status),
 * });
 * ```
 */
export function createClient(options: ClientOptions = {}): SwedenOpenData {
  const ctx = createContext(options);
  return Object.freeze({
    spot: createSpotClient(ctx),
    weather: createWeatherClient(ctx),
    alerts: createAlertsClient(ctx),
    geo: createGeoClient(ctx),
    economy: createEconomyClient(ctx),
    clearCache: () => ctx.cache.clear(),
    stats: () => ctx.stats.snapshot(),
    resetStats: () => ctx.stats.reset(),
  });
}

export * from "./core/errors.ts";
export {
  type CacheTtl,
  type ClientOptions,
  type Context,
  createContext,
  DEFAULT_ENDPOINTS,
  DEFAULT_TTL,
  type Endpoints,
  type Locale,
} from "./core/context.ts";
export {
  type CacheEvent,
  createMemoryCache,
  type MemoryCache,
  type MemoryCacheOptions,
  memoryStore,
  type PersistentStore,
  type Ttl,
} from "./core/cache.ts";
export { type HttpOptions, parseRetryAfter, type RequestEvent } from "./core/http.ts";
export type { ClientStats, SourceStats } from "./core/stats.ts";
export * from "./core/geo.ts";
export * from "./core/time.ts";
export * from "./spot/mod.ts";
export * from "./weather/mod.ts";
export * from "./alerts/mod.ts";
export * from "./geo/mod.ts";
export * from "./vehicles/mod.ts";

export * from "./education/mod.ts";

export * from "./sports/mod.ts";

export * from "./economy/mod.ts";
