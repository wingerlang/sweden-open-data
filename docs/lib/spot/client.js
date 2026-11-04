/**
 * Spot-price client backed by [elprisetjustnu.se](https://www.elprisetjustnu.se/elpris-api), which republishes
 * Nord Pool day-ahead prices for free.
 *
 * @module
 */
import { createContext, storeGet, storeSet } from "../core/context.js";
import { addDays, isCalendarDate, stockholmMidnight, swedishDate } from "../core/time.js";
import { isCompleteSpotDay, parseElprisResponse, summarizeSpotPrices, toSpotArea, toSpotDay, } from "./prices.js";
/** Where the prices come from – show it next to the data. */
export const SPOT_SOURCE = Object.freeze({
    name: "Elpriset just nu.se",
    url: "https://www.elprisetjustnu.se",
});
/**
 * Creates a {@link SpotClient}.
 *
 * @example
 * ```ts
 * const spot = createSpotClient();
 * const { today, tomorrow } = await spot.prices("SE3");
 * ```
 */
export function createSpotClient(options = {}) {
    const ctx = createContext(options);
    async function fetchDay(area, date, signal) {
        const storeKey = `spot:${area}:${date}`;
        const past = date < swedishDate(ctx.now());
        if (past) {
            const stored = await storeGet(ctx.store, storeKey);
            if (Array.isArray(stored) && isCompleteSpotDay(stored, date))
                return toSpotDay(area, date, stored);
        }
        const [y, m, d] = date.split("-");
        const json = await ctx.http.json("elprisetjustnu", `${ctx.endpoints.spot}/${y}/${m}-${d}_${area}.json`, {
            allowNotFound: true,
            signal,
        });
        if (json === undefined)
            return null;
        const day = toSpotDay(area, date, parseElprisResponse(json));
        if (!day.points.length)
            return null;
        if (past && day.complete)
            await storeSet(ctx.store, storeKey, day.points);
        return day;
    }
    const day = async (areaInput, date, options = {}) => {
        const area = toSpotArea(areaInput);
        if (!isCalendarDate(date))
            throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${String(date)}`);
        return ctx.cache.get(`spot:${area}:${date}`, (v) => (v ? ctx.ttl.spotDay : ctx.ttl.spotMissing), (signal) => fetchDay(area, date, signal), { signal: options.signal, source: "elprisetjustnu" });
    };
    const client = {
        day,
        async prices(areaInput, options = {}) {
            const area = toSpotArea(areaInput);
            const now = ctx.now();
            const [today, tomorrow] = await Promise.all([
                day(area, swedishDate(now), options),
                // Tomorrow is optional: a failure there must not hide today's prices.
                day(area, swedishDate(now, 1), options).catch(() => null),
            ]);
            return { area, today, tomorrow, fetchedAt: new Date(now).toISOString() };
        },
        async overview(areaInput, options = {}) {
            const { area, today, tomorrow, fetchedAt } = await client.prices(areaInput, options);
            const now = ctx.now();
            const windowHours = options.windowHours ?? 3;
            const todaySummary = today ? summarizeSpotPrices(today.points, { now, windowHours }) : null;
            return {
                area,
                current: todaySummary?.current ?? null,
                today: todaySummary,
                tomorrow: tomorrow
                    ? summarizeSpotPrices(tomorrow.points, { now: stockholmMidnight(tomorrow.date) - 1, windowHours })
                    : null,
                fetchedAt,
            };
        },
        async history(areaInput, from, to, options = {}) {
            const area = toSpotArea(areaInput);
            if (!isCalendarDate(from) || !isCalendarDate(to))
                throw new RangeError("from and to must be dates (YYYY-MM-DD)");
            if (to < from)
                throw new RangeError("to must not be before from");
            const dates = [];
            for (let date = from; date <= to; date = addDays(date, 1))
                dates.push(date);
            const maxDays = options.maxDays ?? 366;
            if (dates.length > maxDays)
                throw new RangeError(`At most ${maxDays} days per request`);
            const found = new Map();
            const missing = [];
            const today = swedishDate(ctx.now());
            let index = 0;
            const worker = async () => {
                while (index < dates.length) {
                    const date = dates[index++];
                    try {
                        const result = date < today
                            ? await ctx.archive.get(`spot:${area}:${date}`, (v) => (v ? ctx.ttl.spotDay : ctx.ttl.spotMissing), (signal) => fetchDay(area, date, signal), { signal: options.signal, source: "elprisetjustnu" })
                            : await day(area, date, { signal: options.signal });
                        if (!result)
                            missing.push({ date, reason: "not published" });
                        else if (!result.complete)
                            missing.push({ date, reason: "incomplete" });
                        else
                            found.set(date, result);
                    }
                    catch (error) {
                        if (options.signal?.aborted)
                            throw error;
                        missing.push({ date, reason: error instanceof Error ? error.message : String(error) });
                    }
                }
            };
            const workers = Math.max(1, Math.min(options.concurrency ?? 2, dates.length));
            await Promise.all(Array.from({ length: workers }, worker));
            return {
                area,
                from,
                to,
                days: dates.flatMap((date) => (found.has(date) ? [found.get(date)] : [])),
                missing: missing.sort((a, b) => a.date.localeCompare(b.date)),
            };
        },
    };
    return client;
}
