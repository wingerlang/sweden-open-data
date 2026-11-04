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
import { createContext } from "./core/context.js";
import { createAlertsClient } from "./alerts/client.js";
import { createGeoClient } from "./geo/client.js";
import { createSpotClient } from "./spot/client.js";
import { createWeatherClient } from "./weather/client.js";
import { createEconomyClient } from "./economy/client.js";
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
export function createClient(options = {}) {
    const ctx = createContext(options);
    return Object.freeze({
        spot: createSpotClient(ctx),
        weather: createWeatherClient(ctx),
        alerts: createAlertsClient(ctx),
        geo: createGeoClient(ctx),
        economy: createEconomyClient(ctx),
        clearCache: () => {
            ctx.cache.clear();
            ctx.archive.clear();
        },
        stats: () => ctx.stats.snapshot(),
        resetStats: () => ctx.stats.reset(),
    });
}
export * from "./core/errors.js";
export { createContext, DEFAULT_ENDPOINTS, DEFAULT_TTL, } from "./core/context.js";
export { createMemoryCache, memoryStore, } from "./core/cache.js";
export { parseRetryAfter } from "./core/http.js";
export { DEFAULT_LIMITS } from "./core/limit.js";
export * from "./core/geo.js";
export * from "./core/time.js";
export * from "./spot/mod.js";
export * from "./weather/mod.js";
export * from "./alerts/mod.js";
export * from "./geo/mod.js";
export * from "./vehicles/mod.js";
export * from "./education/mod.js";
export * from "./sports/mod.js";
export * from "./economy/mod.js";
export * from "./anniversaries/mod.js";
