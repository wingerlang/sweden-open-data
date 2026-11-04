/**
 * Historical hourly temperatures from the [Open-Meteo archive](https://open-meteo.com/en/docs/historical-weather-api)
 * (ERA5 reanalysis, CC BY 4.0) – for example to compare energy use or spot prices with the weather of a period.
 * Reanalysis is a model of the past, not a station observation at the address.
 *
 * ```ts
 * import { createWeatherHistoryClient } from "@wingerlang/sweden-open-data/weather";
 *
 * const { hours } = await createWeatherHistoryClient().history({ latitude: 59.33, longitude: 18.07 }, "2026-01-01", "2026-01-31");
 * ```
 *
 * @module
 */
import { createContext } from "../core/context.js";
import { assertCoordinates, roundCoordinates } from "../core/geo.js";
import { invalidResponse } from "../core/parse.js";
import { isCalendarDate } from "../core/time.js";
/**
 * Converts an Open-Meteo archive response (`timeformat=unixtime`) into a {@link WeatherHistory}.
 *
 * @throws {SourceError} with code `"invalid-response"` when the series are missing, of different lengths or too long.
 */
export function parseWeatherHistory(raw, fetchedAt) {
    const h = raw?.hourly;
    if (!Array.isArray(h?.time) ||
        !Array.isArray(h.temperature_2m) ||
        h.time.length !== h.temperature_2m.length ||
        h.time.length > 1000)
        throw invalidResponse("open-meteo-archive", "Invalid historical weather");
    return {
        hours: h.time.flatMap((t, i) => typeof t === "number" &&
            Number.isFinite(t) &&
            typeof h.temperature_2m[i] === "number" &&
            Number.isFinite(h.temperature_2m[i])
            ? [{ at: t * 1000, celsius: h.temperature_2m[i] }]
            : []),
        fetchedAt,
        source: "Open-Meteo · historical reanalysis",
        sourceUrl: "https://open-meteo.com/en/docs/historical-weather-api",
    };
}
/**
 * Creates a client for historical temperatures: 1–31 calendar days per request, positions rounded like every other
 * request, results cached ({@link CacheTtl.weatherHistory}, default 6 h). Pass a {@link Context} to share its cache.
 */
export function createWeatherHistoryClient(options = {}) {
    const ctx = createContext(options);
    return {
        async history(position, from, to, historyOptions = {}) {
            assertCoordinates(position);
            if (!isCalendarDate(from) ||
                !isCalendarDate(to) ||
                from > to ||
                (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 31) {
                throw new RangeError("Use 1–31 calendar days");
            }
            const p = roundCoordinates(position, ctx.precision);
            const url = new URL(ctx.endpoints.weatherArchive);
            url.search = new URLSearchParams({
                latitude: String(p.latitude),
                longitude: String(p.longitude),
                start_date: from,
                end_date: to,
                hourly: "temperature_2m",
                timezone: "UTC",
                timeformat: "unixtime",
            }).toString();
            return ctx.cache.get(`weather-history:${p.latitude},${p.longitude}:${from}:${to}`, ctx.ttl.weatherHistory, async (signal) => parseWeatherHistory(await ctx.http.json("open-meteo-archive", url, { signal }), new Date(ctx.now()).toISOString()), { signal: historyOptions.signal, source: "open-meteo-archive" });
        },
    };
}
