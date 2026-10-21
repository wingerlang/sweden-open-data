import { createContext, type ClientOptions } from "../core/context.ts";
import { assertCoordinates, roundCoordinates, type Coordinates } from "../core/geo.ts";
import { SourceError } from "../core/errors.ts";
export interface HistoricalTemperature {
  at: number;
  celsius: number;
}
export interface WeatherHistory {
  hours: HistoricalTemperature[];
  fetchedAt: string;
  source: string;
  sourceUrl: string;
}
export function parseWeatherHistory(raw: unknown, fetchedAt: string): WeatherHistory {
  const h = (raw as { hourly?: { time?: unknown[]; temperature_2m?: unknown[] } })?.hourly;
  if (
    !Array.isArray(h?.time) ||
    !Array.isArray(h.temperature_2m) ||
    h.time.length !== h.temperature_2m.length ||
    h.time.length > 1000
  )
    throw new SourceError("Invalid historical weather", { source: "open-meteo", code: "invalid-response" });
  return {
    hours: h.time.flatMap((t, i) =>
      typeof t === "number" &&
      Number.isFinite(t) &&
      typeof h.temperature_2m![i] === "number" &&
      Number.isFinite(h.temperature_2m![i])
        ? [{ at: t * 1000, celsius: h.temperature_2m![i] as number }]
        : [],
    ),
    fetchedAt,
    source: "Open-Meteo · historical reanalysis",
    sourceUrl: "https://open-meteo.com/en/docs/historical-weather-api",
  };
}
export function createWeatherHistoryClient(options: ClientOptions = {}): {
  history: (position: Coordinates, from: string, to: string) => Promise<WeatherHistory>;
} {
  const ctx = createContext(options);
  return {
    async history(position, from, to) {
      assertCoordinates(position);
      const valid = (s: string) =>
        /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
      if (!valid(from) || !valid(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 31)
        throw new RangeError("Use 1–31 calendar days");
      const p = roundCoordinates(position, ctx.precision),
        url = new URL("https://archive-api.open-meteo.com/v1/archive");
      url.search = new URLSearchParams({
        latitude: String(p.latitude),
        longitude: String(p.longitude),
        start_date: from,
        end_date: to,
        hourly: "temperature_2m",
        timezone: "UTC",
        timeformat: "unixtime",
      }).toString();
      return ctx.cache.get(
        "weather-history:" + p.latitude + "," + p.longitude + ":" + from + ":" + to,
        6 * 3600000,
        async () => parseWeatherHistory(await ctx.http.json("open-meteo", url), new Date(ctx.now()).toISOString()),
      );
    },
  };
}
