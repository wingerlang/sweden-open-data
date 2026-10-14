/**
 * Options shared by every client, and the context the clients are built on.
 *
 * @module
 */
import { createMemoryCache, type MemoryCache, type PersistentStore } from "./cache.ts";
import { createHttp, type Http, type HttpOptions } from "./http.ts";

/** Supported languages for generated texts (weather descriptions, warning titles). */
export type Locale = "sv" | "en";

/** Base URLs of the upstream services. Override them to use a mirror, a proxy or a local fake. */
export interface Endpoints {
  /** elprisetjustnu.se price API. */
  spot: string;
  /** Open-Meteo forecast API. */
  weather: string;
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
}

/** The public endpoints used by default. */
export const DEFAULT_ENDPOINTS: Readonly<Endpoints> = Object.freeze({
  spot: "https://www.elprisetjustnu.se/api/v1/prices",
  weather: "https://api.open-meteo.com/v1/forecast",
  geocoding: "https://geocoding-api.open-meteo.com/v1/search",
  photon: "https://photon.komoot.io/api/",
  photonReverse: "https://photon.komoot.io/reverse",
  krisinformation: "https://api.krisinformation.se/v3",
  smhiWarnings: "https://opendata-download-warnings.smhi.se/ibww/api/version/1/warning.json",
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
}

/** The default {@link CacheTtl}. */
export const DEFAULT_TTL: Readonly<CacheTtl> = Object.freeze({
  spotDay: 12 * 3_600_000,
  spotMissing: 15 * 60_000,
  weather: 20 * 60_000,
  alerts: 5 * 60_000,
  region: 30 * 86_400_000,
  search: 3_600_000,
});

/** Options for `createClient` and the individual client factories. All are optional. */
export interface ClientOptions extends HttpOptions {
  /**
   * In-memory caching. `true` (default) uses {@link DEFAULT_TTL}; `false` disables it (concurrent identical requests
   * are still shared); an object tunes it.
   */
  cache?: boolean | { maxEntries?: number; ttl?: Partial<CacheTtl> };
  /** Durable storage for immutable data (complete historical spot-price days). */
  store?: PersistentStore;
  /** Override individual upstream URLs. */
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
  ttl: CacheTtl;
  store: PersistentStore | undefined;
  endpoints: Endpoints;
  precision: number;
  now: () => number;
  locale: Locale;
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
  const context: Context & { [CONTEXT]: true } = {
    [CONTEXT]: true,
    http: createHttp(o),
    cache: createMemoryCache({ maxEntries: tuning.maxEntries, now, enabled: cache !== false }),
    ttl: { ...DEFAULT_TTL, ...tuning.ttl },
    store: o.store,
    endpoints: { ...DEFAULT_ENDPOINTS, ...o.endpoints },
    precision,
    now,
    locale: o.locale === "en" ? "en" : "sv",
  };
  return context;
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

/** Writes to a {@link PersistentStore}, ignoring failures. */
export async function storeSet(store: PersistentStore | undefined, key: string, value: unknown): Promise<void> {
  if (!store) return;
  try {
    await store.set(key, JSON.stringify(value));
  } catch {
    // A store that cannot write only costs a refetch later.
  }
}
