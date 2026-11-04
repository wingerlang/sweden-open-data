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
import { createContext } from "../core/context.js";
import { assertCoordinates, roundCoordinates } from "../core/geo.js";
import { SourceError } from "../core/errors.js";
import { finiteNumber, invalidResponse } from "../core/parse.js";
/** Swedish names of the pollen species. */
export const POLLEN_SPECIES = Object.freeze({
  alder: "Al",
  birch: "Björk",
  grass: "Gräs",
  mugwort: "Gråbo",
  olive: "Oliv",
  ragweed: "Ambrosia",
});
/** Where the values come from – show the attribution next to the data. */
export const ENVIRONMENT_SOURCE = Object.freeze({
  name: "Open-Meteo / CAMS",
  url: "https://open-meteo.com/en/docs/air-quality-api",
  attribution: "Open-Meteo · CAMS ENSEMBLE / Copernicus Atmosphere Monitoring Service (CC BY 4.0)",
});
const variables = {
  uv: ["uv_index"],
  pollen: Object.keys(POLLEN_SPECIES).map((key) => key + "_pollen"),
  airQuality: ["european_aqi", "pm2_5", "pm10"],
};
const invalid = () => invalidResponse("open-meteo-air-quality", "Invalid environmental forecast");
const value = (raw) => finiteNumber(raw, { min: 0 });
/**
 * Parses an Open-Meteo air-quality response (`timeformat=unixtime`). Only the requested arrays are read; missing
 * coverage stays `null`.
 *
 * @throws {SourceError} with code `"invalid-response"` for malformed shapes, unordered times or an invalid position.
 */
export function parseWeatherEnvironment(raw, metrics, now = Date.now()) {
  if (!raw || typeof raw !== "object") throw invalid();
  const data = raw,
    hourly = data.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length || hourly.time.length > 192) throw invalid();
  const times = hourly.time,
    fields = metrics.flatMap((metric) => variables[metric]);
  if (!fields.some((field) => Array.isArray(hourly[field]))) throw invalid();
  for (const field of fields)
    if (hourly[field] !== undefined && (!Array.isArray(hourly[field]) || hourly[field].length !== times.length))
      throw invalid();
  if (typeof data.latitude !== "number" || typeof data.longitude !== "number") throw invalid();
  try {
    assertCoordinates({ latitude: data.latitude, longitude: data.longitude });
  } catch {
    throw invalid();
  }
  const at = (field, i) => (fields.includes(field) ? value(hourly[field]?.[i]) : null);
  let previous = -Infinity;
  const hours = times.map((time, i) => {
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
      pollen: Object.fromEntries(Object.keys(POLLEN_SPECIES).map((key) => [key, at(key + "_pollen", i)])),
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
export function createWeatherEnvironmentClient(options = {}) {
  const ctx = createContext(options);
  return {
    async environment(position, options = {}) {
      assertCoordinates(position);
      if (options.signal?.aborted)
        throw new SourceError("Environmental forecast cancelled", {
          source: "open-meteo-air-quality",
          code: "aborted",
        });
      const metrics = [...new Set(options.metrics ?? ["uv", "pollen", "airQuality"])].sort(),
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
/** Peak forecast over the next 24 h above the caller's own threshold; not an official pollen warning. */
export function pollenWarnings(forecast, threshold, now = Date.now()) {
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new RangeError("Use a positive pollen threshold in grains/m³");
  const hours = forecast.hours.filter((h) => Date.parse(h.time) + 3600000 > now && Date.parse(h.time) < now + 86400000);
  return Object.keys(POLLEN_SPECIES).flatMap((species) => {
    const peak = hours
      .filter((h) => h.pollen[species] !== null)
      .sort((a, b) => b.pollen[species] - a.pollen[species])[0];
    return peak && peak.pollen[species] >= threshold
      ? [{ species, label: POLLEN_SPECIES[species], concentration: peak.pollen[species], time: peak.time }]
      : [];
  });
}
