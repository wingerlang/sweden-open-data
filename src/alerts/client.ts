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

/** The three feeds: VMA and news from Krisinformation.se, weather warnings from SMHI. */
export type AlertFeedId = "vma" | "news" | "smhi";

/** All feeds, in the order they are reported. */
export const ALERT_FEEDS: readonly AlertFeedId[] = Object.freeze(["vma", "news", "smhi"] as const);

/** Options for {@link AlertsClient.feed}. */
export interface FeedOptions {
  /** Read only these feeds. Default: all. */
  feeds?: AlertFeedId[];
  signal?: AbortSignal;
}

/** A feed and whether it could be read. */
export interface FeedStatus {
  id: AlertFeedId;
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
  /** Read only these feeds. Default: all. */
  feeds?: AlertFeedId[];
  signal?: AbortSignal;
}

/** Alerts. */
export interface AlertsClient {
  /**
   * Every current alert from every feed. Feeds fail independently.
   * @throws {SourceError} only when every feed fails.
   */
  feed(options?: FeedOptions): Promise<AlertFeed>;
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
  const feeds: { id: AlertFeedId; name: string; url: string; load: (signal?: AbortSignal) => Promise<Alert[]> }[] = [
    {
      id: "vma",
      name: "Krisinformation.se · VMA",
      url: "https://www.krisinformation.se",
      load: async (signal) => parseKrisinformation(await ctx.http.json("krisinformation", `${ctx.endpoints.krisinformation}/vmas`, { signal }), "vma"),
    },
    {
      id: "news",
      name: "Krisinformation.se · nyheter",
      url: "https://www.krisinformation.se",
      load: async (signal) =>
        parseKrisinformation(await ctx.http.json("krisinformation", `${ctx.endpoints.krisinformation}/news?days=30`, { signal }), "news"),
    },
    {
      id: "smhi",
      name: "SMHI · varningar",
      url: "https://www.smhi.se/vader/varningar-och-brandrisk",
      load: async (signal) => parseSmhiWarnings(await ctx.http.json("smhi", ctx.endpoints.smhiWarnings, { signal }), { now: ctx.now(), locale }),
    },
  ];

  async function feed(options: FeedOptions = {}): Promise<AlertFeed> {
    if (options.feeds && (!options.feeds.length || options.feeds.some((id) => !ALERT_FEEDS.includes(id)))) {
      throw new RangeError(`feeds must be a non-empty list of ${ALERT_FEEDS.join(", ")}`);
    }
    const chosen = options.feeds ? feeds.filter((f) => options.feeds?.includes(f.id)) : feeds;
    const results = await Promise.all(chosen.map((f) =>
      ctx.cache.get(`alerts:${f.id}:${locale}`, ctx.ttl.alerts, (signal) => f.load(signal), { signal: options.signal, source: f.id === "smhi" ? "smhi" : "krisinformation" }).then(
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
      sources: chosen.map((f, i) => ({ id: f.id, name: f.name, url: f.url, ok: results[i].ok })),
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
        feed({ feeds: options.feeds, signal: options.signal }),
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
