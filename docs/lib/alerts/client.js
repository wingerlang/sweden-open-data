/**
 * Alerts client: VMA and news from [Krisinformation.se](https://www.krisinformation.se) and weather warnings
 * from [SMHI](https://www.smhi.se/vader/varningar-och-brandrisk), matched to your places.
 *
 * @module
 */
import { createContext } from "../core/context.js";
import { SourceError } from "../core/errors.js";
import { isCoordinates } from "../core/geo.js";
import { createGeoClient } from "../geo/client.js";
import { parseKrisinformation, parseSmhiWarnings, relevantAlerts, } from "./alerts.js";
/** All feeds, in the order they are reported. */
export const ALERT_FEEDS = Object.freeze(["vma", "news", "smhi"]);
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
export function createAlertsClient(options = {}) {
    const ctx = createContext(options);
    const locale = ctx.locale;
    const geo = createGeoClient(ctx);
    const feeds = [
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
            load: async (signal) => parseKrisinformation(await ctx.http.json("krisinformation", `${ctx.endpoints.krisinformation}/news?days=30`, { signal }), "news"),
        },
        {
            id: "smhi",
            name: "SMHI · varningar",
            url: "https://www.smhi.se/vader/varningar-och-brandrisk",
            load: async (signal) => parseSmhiWarnings(await ctx.http.json("smhi", ctx.endpoints.smhiWarnings, { signal }), {
                now: ctx.now(),
                locale,
            }),
        },
    ];
    async function feed(options = {}) {
        if (options.feeds && (!options.feeds.length || options.feeds.some((id) => !ALERT_FEEDS.includes(id)))) {
            throw new RangeError(`feeds must be a non-empty list of ${ALERT_FEEDS.join(", ")}`);
        }
        const chosen = options.feeds ? feeds.filter((f) => options.feeds?.includes(f.id)) : feeds;
        const results = await Promise.all(chosen.map((f) => ctx.cache
            .get(`alerts:${f.id}:${locale}`, ctx.ttl.alerts, (signal) => f.load(signal), {
            signal: options.signal,
            source: f.id === "smhi" ? "smhi" : "krisinformation",
        })
            .then((alerts) => ({ ok: true, alerts }), (error) => ({ ok: false, alerts: [], error }))));
        if (results.every((r) => !r.ok)) {
            const first = results[0].error;
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
