/**
 * Options shared by every client, and the context the clients are built on.
 *
 * @module
 */
import { type CacheEvent, createMemoryCache, type MemoryCache, type PersistentStore } from "./cache.ts";
import { createHttp, type Http, type HttpOptions } from "./http.ts";
import { createStats, type StatsCollector } from "./stats.ts";

/** Supported languages for generated texts (weather descriptions, warning titles). */
export type Locale = "sv" | "en";

/** Base URLs of the upstream services. Override them to use a mirror, a proxy or a local fake. */
export interface Endpoints {
  /** elprisetjustnu.se price API. */
  spot: string;
  /** Open-Meteo forecast API. */
  weather: string;
  /** Open-Meteo / CAMS air-quality, UV and pollen API. */
  airQuality: string;
  /** Open-Meteo geocoding API (place names). */
  geocoding: string;
  /** Photon search API (addresses and points of interest, OpenStreetMap data). */
  photon: string;
  /** Photon reverse geocoding API. */
  photonReverse: string;
  /** Krisinformation.se API v3. */
  krisinformation: string;
  /** SMHI impact-based weather warnings. */
  smhiWarnings: string;
  /** SCB Statistikdatabasen, PxWebApi v2. */
  scb: string;
  /** Open-Meteo historical weather (ERA5 archive). */
  weatherArchive: string;
  /** IBIndex read endpoints (experimental `/investments`). */
  ibindex: string;
  /**
   * Biluppgifter vehicle API. The vehicle clients always use the default, so an API key or a registration number is
   * never sent to an overridden address.
   */
  biluppgifter: string;
  /** Transportstyrelsen's public vehicle page (experimental `/vehicles/free`); always the default, as above. */
  transportstyrelsen: string;
}

/** The public endpoints used by default. */
export const DEFAULT_ENDPOINTS: Readonly<Endpoints> = Object.freeze({
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
  biluppgifter: "https://api.biluppgifter.se/api/v1/vehicle/regno/",
  transportstyrelsen: "https://fordon-fu-regnr.transportstyrelsen.se/UppgifterAnnatFordon/TillbakaTillFordonsuppgifter",
});

/** How long results are kept in memory, in milliseconds. */
export interface CacheTtl {
  /** A published day of spot prices. Default 12 h. */
  spotDay: number;
  /** A day that is not published yet (tomorrow before ~13:00). Default 15 min. */
  spotMissing: number;
  /** A weather forecast. Default 20 min. */
  weather: number;
  /** Each alert feed (VMA, news, SMHI warnings). Default 5 min. */
  alerts: number;
  /** County and municipality for a position. Default 30 days. */
  region: number;
  /** Address and place searches. Default 1 h. */
  search: number;
  /** A consumer price index series (published monthly). Default 6 h. */
  cpi: number;
  /** A period of historical temperatures. Default 6 h. */
  weatherHistory: number;
  /** IBIndex companies and one company's history and holdings. Default 6 h. */
  investments: number;
  /** The IBIndex overview of today's prices and NAV. Default 15 min. */
  investmentsOverview: number;
  /** A vehicle that was found. Default 6 h (the authenticated client's `ttlMs` overrides it). */
  vehicle: number;
}

/** The default {@link CacheTtl}. */
export const DEFAULT_TTL: Readonly<CacheTtl> = Object.freeze({
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

/** Options for `createClient` and the individual client factories. All are optional. */
export interface ClientOptions extends HttpOptions {
  /**
   * In-memory caching. `true` (default) uses {@link DEFAULT_TTL}; `false` disables it (concurrent identical requests
   * are still shared); an object tunes it.
   */
  cache?:
    | boolean
    | {
        /** Maximum number of cached results. Default `500`. */
        maxEntries?: number;
        /** Maximum number of past days kept by `spot.history`, in a cache of their own. Default `400`. */
        archiveEntries?: number;
        /** Lifetimes per kind of data. */
        ttl?: Partial<CacheTtl>;
        /**
         * Keep serving the last good result for this long after it expired when the source fails, instead of an error.
         * Default `0`. A dashboard might use a few hours; results carry `fetchedAt`, so you can show their age.
         */
        staleIfErrorMs?: number;
      };
  /** Called for every cache hit, miss and stale answer. Must not throw. */
  onCacheEvent?: (event: CacheEvent) => void;
  /** Durable storage: complete historical spot-price days, and the last good consumer price index series. */
  store?: PersistentStore;
  /** Override individual upstream URLs (`https:`, or `http:` for localhost). Treat them as trusted configuration. */
  endpoints?: Partial<Endpoints>;
  /**
   * Decimals that positions are rounded to before they are sent to a source (and used as cache keys).
   * Default `2` (≈ 1 km) – better privacy and better cache hit rates.
   */
  coordinatePrecision?: number;
  /** Clock in milliseconds since the epoch. Default `Date.now`. Inject one for tests or replays. */
  now?: () => number;
  /** Language of generated texts such as warning titles. Default `"sv"`. */
  locale?: Locale;
}

/**
 * What every client is built on: network layer, cache, endpoints, clock. `createClient` builds one and shares it.
 * Build one yourself with {@link createContext} only to share a cache between standalone clients.
 */
export interface Context {
  http: Http;
  cache: MemoryCache;
  /**
   * A separate, bounded cache for immutable historical data (past days of spot prices), so a long history request
   * never pushes current data out of {@link Context.cache}.
   */
  archive: MemoryCache;
  ttl: CacheTtl;
  store: PersistentStore | undefined;
  endpoints: Endpoints;
  precision: number;
  now: () => number;
  locale: Locale;
  stats: StatsCollector;
}

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
export function createContext(options: ClientOptions | Context = {}): Context {
  if ((options as { [CONTEXT]?: true })[CONTEXT]) return options as Context;
  const o = options as ClientOptions;
  const cache = o.cache ?? true;
  const tuning = typeof cache === "object" ? cache : {};
  const precision = o.coordinatePrecision ?? 2;
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new RangeError("coordinatePrecision must be an integer 0–6");
  }
  const now = o.now ?? Date.now;
  const stats = createStats(now);
  const context: Context & { [CONTEXT]: true } = {
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
function checkEndpoints(endpoints: Endpoints): Endpoints {
  for (const [name, value] of Object.entries(endpoints)) {
    let url: URL | undefined;
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
export async function storeGet(store: PersistentStore | undefined, key: string): Promise<unknown> {
  if (!store) return undefined;
  try {
    const raw = await store.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Writes to a {@link PersistentStore}, ignoring failures. Without `ttlMs` the value is kept until replaced. */
export async function storeSet(
  store: PersistentStore | undefined,
  key: string,
  value: unknown,
  ttlMs?: number,
): Promise<void> {
  if (!store) return;
  try {
    await store.set(key, JSON.stringify(value), ttlMs === undefined ? undefined : { ttlMs });
  } catch {
    // A store that cannot write only costs a refetch later.
  }
}
