/**
 * Options shared by every client, and the context the clients are built on.
 *
 * @module
 */
import { createMemoryCache } from "./cache.js";
import { createHttp } from "./http.js";
import { createStats } from "./stats.js";
/** The public endpoints used by default. */
export const DEFAULT_ENDPOINTS = Object.freeze({
  marketSearch: "https://query1.finance.yahoo.com/v1/finance/search",
  marketNasdaq: "https://indexes.nasdaqomx.com/Index/HistoryChartData",
  marketFred: "https://fred.stlouisfed.org/graph/fredgraph.csv",
  marketChart: "https://query1.finance.yahoo.com/v8/finance/chart/",
  marketSummary: "https://query2.finance.yahoo.com/v10/finance/quoteSummary/",
  marketReports: "https://mfn.se/",
  spot: "https://www.elprisetjustnu.se/api/v1/prices",
  weather: "https://api.open-meteo.com/v1/forecast",
  airQuality: "https://air-quality-api.open-meteo.com/v1/air-quality",
  geocoding: "https://geocoding-api.open-meteo.com/v1/search",
  photon: "https://photon.komoot.io/api/",
  photonReverse: "https://photon.komoot.io/reverse",
  krisinformation: "https://api.krisinformation.se/v3",
  smhiWarnings: "https://opendata-download-warnings.smhi.se/ibww/api/version/1/warning.json",
  scb: "https://statistikdatabasen.scb.se/api/v2",
  weatherArchive: "https://archive-api.open-meteo.com/v1/archive",
  ibindex: "https://ibindex.se/ibi/",
  handelsbankenRates: "https://www.handelsbanken.se/rsopdistresource/slan/resource/open/v1/mortgagerates/",
  biluppgifter: "https://api.biluppgifter.se/api/v1/vehicle/regno/",
  transportstyrelsen: "https://fordon-fu-regnr.transportstyrelsen.se/UppgifterAnnatFordon/TillbakaTillFordonsuppgifter",
});
/** The default {@link CacheTtl}. */
export const DEFAULT_TTL = Object.freeze({
  marketQuote: 30000,
  marketHistory: 10 * 60000,
  marketFundamentals: 6 * 3600000,
  marketIndex: 3600000,
  spotDay: 12 * 3_600_000,
  spotMissing: 15 * 60_000,
  weather: 20 * 60_000,
  alerts: 5 * 60_000,
  region: 30 * 86_400_000,
  search: 3_600_000,
  cpi: 6 * 3_600_000,
  weatherHistory: 6 * 3_600_000,
  investments: 6 * 3_600_000,
  investmentsOverview: 15 * 60_000,
  vehicle: 6 * 3_600_000,
});
const CONTEXT = Symbol.for("sweden-open-data.context");
/**
 * Builds a {@link Context} from options, or returns an existing one unchanged.
 *
 * @example Two standalone clients sharing one cache
 * ```ts
 * const shared = createContext({ timeoutMs: 5000 });
 * const spot = createSpotClient(shared);
 * const weather = createWeatherClient(shared);
 * ```
 */
export function createContext(options = {}) {
  if (options[CONTEXT]) return options;
  const o = options;
  const cache = o.cache ?? true;
  const tuning = typeof cache === "object" ? cache : {};
  const precision = o.coordinatePrecision ?? 2;
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new RangeError("coordinatePrecision must be an integer 0–6");
  }
  const now = o.now ?? Date.now;
  const stats = createStats(now);
  const context = {
    [CONTEXT]: true,
    http: createHttp({
      ...o,
      onRequest: (event) => {
        stats.request(event);
        o.onRequest?.(event);
      },
    }),
    cache: createMemoryCache({
      maxEntries: tuning.maxEntries,
      now,
      enabled: cache !== false,
      staleIfErrorMs: tuning.staleIfErrorMs,
      onEvent: (event) => {
        stats.cache(event);
        o.onCacheEvent?.(event);
      },
    }),
    archive: createMemoryCache({
      maxEntries: tuning.archiveEntries ?? 400,
      now,
      enabled: cache !== false,
      staleIfErrorMs: tuning.staleIfErrorMs,
      onEvent: (event) => {
        stats.cache(event);
        o.onCacheEvent?.(event);
      },
    }),
    ttl: { ...DEFAULT_TTL, ...tuning.ttl },
    store: o.store,
    endpoints: checkEndpoints({ ...DEFAULT_ENDPOINTS, ...o.endpoints }),
    precision,
    now,
    locale: o.locale === "en" ? "en" : "sv",
    stats,
  };
  return context;
}
/**
 * Endpoints are trusted configuration: they decide where positions and queries are sent. Only `https:` is accepted,
 * and `http:` only for this computer (`localhost`, `127.0.0.1`, `[::1]`) – for local mirrors and fakes.
 */
function checkEndpoints(endpoints) {
  for (const [name, value] of Object.entries(endpoints)) {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      url = undefined;
    }
    const local = url?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!url || !(url.protocol === "https:" || local) || url.username || url.password) {
      throw new RangeError(`endpoints.${name} must be an https:// URL (or http://localhost): ${String(value)}`);
    }
  }
  return endpoints;
}
/** Reads from a {@link PersistentStore}, treating failures as a miss. */
export async function storeGet(store, key) {
  if (!store) return undefined;
  try {
    const raw = await store.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}
/** Writes to a {@link PersistentStore}, ignoring failures. Without `ttlMs` the value is kept until replaced. */
export async function storeSet(store, key, value, ttlMs) {
  if (!store) return;
  try {
    await store.set(key, JSON.stringify(value), ttlMs === undefined ? undefined : { ttlMs });
  } catch {
    // A store that cannot write only costs a refetch later.
  }
}
