/**
 * Alerts client: VMA and news from [Krisinformation.se](https://www.krisinformation.se) and weather warnings
 * from [SMHI](https://www.smhi.se/vader/varningar-och-brandrisk), matched to your places.
 *
 * @module
 */
import { type ClientOptions, type Context, createContext } from "../core/context.ts";
import { SourceError } from "../core/errors.ts";
import { isCoordinates } from "../core/geo.ts";
import { createGeoClient } from "../geo/client.ts";
import type { Region } from "../geo/regions.ts";
import { type Alert, type RelevanceOptions, type RelevantAlert, parseKrisinformation, parseSmhiWarnings, relevantAlerts } from "./alerts.ts";

/** A feed and whether it could be read. */
export interface FeedStatus {
  name: string;
  url: string;
  ok: boolean;
}

/** All current alerts from all feeds. */
export interface AlertFeed {
  alerts: Alert[];
  /** One entry per feed. A failing feed is reported here instead of failing the whole call. */
  sources: FeedStatus[];
  fetchedAt: string;
}

/** Alerts for a set of places. */
export interface NearbyAlerts {
  /** The places, with county and municipality resolved. */
  places: Region[];
  /** Relevant alerts, most important first. */
  alerts: RelevantAlert[];
  sources: FeedStatus[];
  fetchedAt: string;
}

/** Options for {@link AlertsClient.near}. */
export interface NearOptions extends Omit<RelevanceOptions, "now"> {
  signal?: AbortSignal;
}

/** Alerts. */
export interface AlertsClient {
  /**
   * Every current alert from every feed. Feeds fail independently.
   * @throws {SourceError} only when every feed fails.
   */
  feed(options?: { signal?: AbortSignal }): Promise<AlertFeed>;
  /**
   * Alerts that concern any of `places`. Plain coordinates are resolved to county and municipality first;
   * pass {@link Region}s with `county` set to skip that lookup. At most 20 places.
   */
  near(places: Region[], options?: NearOptions): Promise<NearbyAlerts>;
}

/**
 * Creates an {@link AlertsClient}.
 *
 * @example
 * ```ts
 * const alerts = createAlertsClient();
 * const { alerts: list } = await alerts.near([{ latitude: 56.1, longitude: 13.91 }], { days: 7, neighbors: true });
 * for (const a of list) console.log(a.level ?? "info", a.title);
 * ```
 */
export function createAlertsClient(options: ClientOptions | Context = {}): AlertsClient {
  const ctx = createContext(options);
  const locale = ctx.locale;
  const geo = createGeoClient(ctx);
  const feeds: { name: string; url: string; load: (signal?: AbortSignal) => Promise<Alert[]> }[] = [
    {
      name: "Krisinformation.se · VMA",
      url: "https://www.krisinformation.se",
      load: async (signal) => parseKrisinformation(await ctx.http.json("krisinformation", `${ctx.endpoints.krisinformation}/vmas`, { signal }), "vma"),
    },
    {
      name: "Krisinformation.se · nyheter",
      url: "https://www.krisinformation.se",
      load: async (signal) =>
        parseKrisinformation(await ctx.http.json("krisinformation", `${ctx.endpoints.krisinformation}/news?days=30`, { signal }), "news"),
    },
    {
      name: "SMHI · varningar",
      url: "https://www.smhi.se/vader/varningar-och-brandrisk",
      load: async (signal) => parseSmhiWarnings(await ctx.http.json("smhi", ctx.endpoints.smhiWarnings, { signal }), { now: ctx.now(), locale }),
    },
  ];

  async function feed(options: { signal?: AbortSignal } = {}): Promise<AlertFeed> {
    const results = await Promise.all(feeds.map((f) =>
      ctx.cache.get(`alerts:${f.name}:${locale}`, ctx.ttl.alerts, () => f.load(options.signal)).then(
        (alerts) => ({ ok: true, alerts }),
        (error: unknown) => ({ ok: false, alerts: [] as Alert[], error }),
      )
    ));
    if (results.every((r) => !r.ok)) {
      const first = (results[0] as { error?: unknown }).error;
      throw first instanceof SourceError
        ? first
        : new SourceError("No alert feed could be read", { code: "network", source: "alerts", cause: first });
    }
    return {
      alerts: results.flatMap((r) => r.alerts),
      sources: feeds.map((f, i) => ({ name: f.name, url: f.url, ok: results[i].ok })),
      fetchedAt: new Date(ctx.now()).toISOString(),
    };
  }

  return {
    feed,
    async near(places, options = {}) {
      if (!Array.isArray(places) || !places.length || places.length > 20 || !places.every(isCoordinates)) {
        throw new RangeError("places must be 1–20 positions");
      }
      const [regions, all] = await Promise.all([
        Promise.all(places.map((p) => (p.county ? Promise.resolve(p) : geo.region(p, { signal: options.signal })))),
        feed({ signal: options.signal }),
      ]);
      return {
        places: regions,
        alerts: relevantAlerts(all.alerts, regions, { ...options, now: ctx.now() }),
        sources: all.sources,
        fetchedAt: all.fetchedAt,
      };
    },
  };
}
