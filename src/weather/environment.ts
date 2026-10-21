/**
 * Optional hourly UV, pollen and air-quality forecasts from Open-Meteo / CAMS (CC BY 4.0). Model forecasts, not
 * station observations; pollen is seasonal and only available in Europe. Ordinary weather forecasts never call this
 * source – ask for it with `weather.environment()`.
 *
 * ```ts
 * const env = await createWeatherClient().environment({ latitude: 59.33, longitude: 18.07 }, { metrics: ["pollen"] });
 * pollenWarnings(env, 50); // species above 50 grains/m³ in the next 24 h
 * ```
 *
 * @module
 */
import { createContext, type ClientOptions, type Context } from "../core/context.ts";
import { assertCoordinates, roundCoordinates, type Coordinates } from "../core/geo.ts";
import { SourceError } from "../core/errors.ts";

/** A group of values: UV index, six pollen species, or European AQI with PM2.5 and PM10. */
export type EnvironmentMetric = "uv" | "pollen" | "airQuality";
/** The pollen species CAMS forecasts. */
export type PollenSpecies = "alder" | "birch" | "grass" | "mugwort" | "olive" | "ragweed";
/** Swedish names of the pollen species. */
export const POLLEN_SPECIES: Readonly<Record<PollenSpecies, string>> = Object.freeze({
  alder: "Al",
  birch: "Björk",
  grass: "Gräs",
  mugwort: "Gråbo",
  olive: "Oliv",
  ragweed: "Ambrosia",
});
/** Where the values come from – show the attribution next to the data. */
export const ENVIRONMENT_SOURCE: { readonly name: string; readonly url: string; readonly attribution: string } =
  Object.freeze({
    name: "Open-Meteo / CAMS",
    url: "https://open-meteo.com/en/docs/air-quality-api",
    attribution: "Open-Meteo · CAMS ENSEMBLE / Copernicus Atmosphere Monitoring Service (CC BY 4.0)",
  });
const variables: Record<EnvironmentMetric, string[]> = {
  uv: ["uv_index"],
  pollen: Object.keys(POLLEN_SPECIES).map((key) => key + "_pollen"),
  airQuality: ["european_aqi", "pm2_5", "pm10"],
};

/** One forecast hour. A value is `null` when it was not requested or not available – never zero by default. */
export interface WeatherEnvironmentHour {
  /** ISO timestamp in UTC; values are model forecasts, not station observations. */
  time: string;
  /** UV index. */
  uvIndex: number | null;
  /** Concentrations in grains/m³. Null means unavailable, never zero. */
  pollen: Record<PollenSpecies, number | null>;
  /** European air quality index. */
  europeanAqi: number | null;
  /** Fine particles PM2.5, µg/m³. */
  pm25: number | null;
  /** Particles PM10, µg/m³. */
  pm10: number | null;
}
/** An environmental forecast for one (rounded) position. */
export interface WeatherEnvironment {
  latitude: number;
  longitude: number;
  /** When the forecast was fetched (ISO 8601). */
  fetchedAt: string;
  source: typeof ENVIRONMENT_SOURCE;
  /** The groups that were requested. */
  metrics: EnvironmentMetric[];
  /** In time order. */
  hours: WeatherEnvironmentHour[];
}
/** Options for {@link WeatherEnvironmentClient.environment}. */
export interface EnvironmentOptions {
  /** Explicitly select data groups. Default: all; ordinary weather forecasts never fetch this endpoint. */
  metrics?: EnvironmentMetric[];
  /** 1–4 days. Pollen is seasonal and available only in Europe. */
  days?: number;
  /** Cancels this caller's wait. */
  signal?: AbortSignal;
}
/** UV, pollen and air quality. */
export interface WeatherEnvironmentClient {
  /** Hourly forecast for a position (rounded to ~1 km before sending). */
  environment(position: Coordinates, options?: EnvironmentOptions): Promise<WeatherEnvironment>;
}
const invalid = () =>
  new SourceError("Invalid environmental forecast", { source: "open-meteo-air-quality", code: "invalid-response" });
const value = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;

/**
 * Parses an Open-Meteo air-quality response (`timeformat=unixtime`). Only the requested arrays are read; missing
 * coverage stays `null`.
 *
 * @throws {SourceError} with code `"invalid-response"` for malformed shapes, unordered times or an invalid position.
 */
export function parseWeatherEnvironment(
  raw: unknown,
  metrics: EnvironmentMetric[],
  now: number = Date.now(),
): WeatherEnvironment {
  if (!raw || typeof raw !== "object") throw invalid();
  const data = raw as Record<string, unknown>,
    hourly = data.hourly as Record<string, unknown> | undefined;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length || hourly.time.length > 192) throw invalid();
  const times = hourly.time as unknown[],
    fields = metrics.flatMap((metric) => variables[metric]);
  if (!fields.some((field) => Array.isArray(hourly[field]))) throw invalid();
  for (const field of fields)
    if (
      hourly[field] !== undefined &&
      (!Array.isArray(hourly[field]) || (hourly[field] as unknown[]).length !== times.length)
    )
      throw invalid();
  if (typeof data.latitude !== "number" || typeof data.longitude !== "number") throw invalid();
  try {
    assertCoordinates({ latitude: data.latitude, longitude: data.longitude });
  } catch {
    throw invalid();
  }
  const at = (field: string, i: number): number | null =>
    fields.includes(field) ? value((hourly[field] as unknown[] | undefined)?.[i]) : null;
  let previous = -Infinity;
  const hours = times.map((time, i): WeatherEnvironmentHour => {
    if (
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      !Number.isFinite(new Date(time * 1000).getTime()) ||
      time <= previous
    )
      throw invalid();
    previous = time;
    return {
      time: new Date(time * 1000).toISOString(),
      uvIndex: at("uv_index", i),
      pollen: Object.fromEntries(Object.keys(POLLEN_SPECIES).map((key) => [key, at(key + "_pollen", i)])) as Record<
        PollenSpecies,
        number | null
      >,
      europeanAqi: at("european_aqi", i),
      pm25: at("pm2_5", i),
      pm10: at("pm10", i),
    };
  });
  return {
    latitude: data.latitude,
    longitude: data.longitude,
    fetchedAt: new Date(now).toISOString(),
    source: ENVIRONMENT_SOURCE,
    metrics: [...metrics],
    hours,
  };
}

/** Reuses the package's rounding, cache, retries, cancellation and source statistics. */
export function createWeatherEnvironmentClient(options: ClientOptions | Context = {}): WeatherEnvironmentClient {
  const ctx = createContext(options);
  return {
    async environment(position, options = {}) {
      assertCoordinates(position);
      if (options.signal?.aborted)
        throw new SourceError("Environmental forecast cancelled", {
          source: "open-meteo-air-quality",
          code: "aborted",
        });
      const metrics = [...new Set(options.metrics ?? ["uv", "pollen", "airQuality"])].sort() as EnvironmentMetric[],
        days = options.days ?? 4;
      if (!metrics.length || metrics.some((metric) => !Object.hasOwn(variables, metric)))
        throw new RangeError("Select uv, pollen or airQuality");
      if (!Number.isInteger(days) || days < 1 || days > 4) throw new RangeError("Use 1–4 forecast days");
      const p = roundCoordinates(position, ctx.precision),
        url = new URL(ctx.endpoints.airQuality);
      url.search = new URLSearchParams({
        latitude: String(p.latitude),
        longitude: String(p.longitude),
        hourly: metrics.flatMap((metric) => variables[metric]).join(","),
        forecast_days: String(days),
        timezone: "UTC",
        timeformat: "unixtime",
      }).toString();
      return ctx.cache.get(
        `weather-environment:${p.latitude},${p.longitude}:${days}:${metrics.join(",")}`,
        ctx.ttl.weather,
        async (signal) =>
          parseWeatherEnvironment(await ctx.http.json("open-meteo-air-quality", url, { signal }), metrics, ctx.now()),
        { signal: options.signal, source: "open-meteo-air-quality" },
      );
    },
  };
}

/** A pollen species whose forecast peak passes the caller's threshold. */
export interface PollenWarning {
  species: PollenSpecies;
  /** Swedish name. */
  label: string;
  /** Peak concentration, grains/m³. */
  concentration: number;
  /** Hour of the peak (ISO 8601, UTC). */
  time: string;
}
/** Peak forecast over the next 24 h above the caller's own threshold; not an official pollen warning. */
export function pollenWarnings(
  forecast: WeatherEnvironment,
  threshold: number,
  now: number = Date.now(),
): PollenWarning[] {
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new RangeError("Use a positive pollen threshold in grains/m³");
  const hours = forecast.hours.filter((h) => Date.parse(h.time) + 3600000 > now && Date.parse(h.time) < now + 86400000);
  return (Object.keys(POLLEN_SPECIES) as PollenSpecies[]).flatMap((species) => {
    const peak = hours
      .filter((h) => h.pollen[species] !== null)
      .sort((a, b) => b.pollen[species]! - a.pollen[species]!)[0];
    return peak && peak.pollen[species]! >= threshold
      ? [{ species, label: POLLEN_SPECIES[species], concentration: peak.pollen[species]!, time: peak.time }]
      : [];
  });
}
