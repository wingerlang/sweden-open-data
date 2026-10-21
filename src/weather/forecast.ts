/**
 * Weather forecasts from [Open-Meteo](https://open-meteo.com) (free, no key, CC BY 4.0), normalised to a small
 * format with absolute times, plus WMO weather codes in Swedish and English. Everything here is pure.
 *
 * @module
 */
import { SourceError } from "../core/errors.ts";
import { type Coordinates, assertCoordinates } from "../core/geo.ts";
import { TIME_ZONE } from "../core/time.ts";
import type { Locale } from "../core/context.ts";

export type { Locale };

/** Conditions right now. Times are ISO 8601 in UTC. */
export interface CurrentWeather {
  time: string;
  /** °C. */
  temperature: number;
  /** Apparent ("feels like") temperature, °C. */
  feelsLike: number | null;
  /** WMO weather code – see {@link describeWeather}. */
  code: number;
  /** Mean wind, m/s. */
  wind: number | null;
  /** Gusts, m/s. */
  gust: number | null;
  /** Precipitation, mm. */
  precipitation: number | null;
  /** Relative humidity, %. */
  humidity: number | null;
  isDay: boolean;
}

/** One forecast hour. */
export interface HourlyWeather {
  time: string;
  temperature: number;
  code: number;
  /** mm. */
  precipitation: number | null;
  /** Probability of precipitation, %. */
  precipitationProbability: number | null;
  /** m/s. */
  wind: number | null;
  isDay: boolean;
}

/** One forecast day. */
export interface DailyWeather {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  code: number;
  max: number;
  min: number;
  /** mm. */
  precipitation: number | null;
  /** %. */
  precipitationProbability: number | null;
  sunrise: string | null;
  sunset: string | null;
  /** Maximum mean wind, m/s. */
  wind: number | null;
}

/** A forecast for one position. */
export interface Forecast {
  latitude: number;
  longitude: number;
  timezone: string;
  current: CurrentWeather;
  /** From the current hour, up to 7 days. */
  hours: HourlyWeather[];
  days: DailyWeather[];
  /** When the forecast was fetched (ISO 8601). */
  fetchedAt: string;
  /** `true` when {@link forecastAt} replaced stale current conditions with the forecast for the hour. */
  currentIsForecast?: boolean;
}

/** A coarse category for choosing an icon. */
export type WeatherIcon =
  | "sun"
  | "partly"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "sleet"
  | "snow"
  | "showers"
  | "snowshowers"
  | "thunder";

/** A described weather code. */
export interface WeatherDescription {
  label: string;
  icon: WeatherIcon;
}

const CODES: Record<number, [WeatherIcon, string, string]> = {
  0: ["sun", "Klart", "Clear sky"],
  1: ["partly", "Mestadels klart", "Mainly clear"],
  2: ["partly", "Halvklart", "Partly cloudy"],
  3: ["cloud", "Mulet", "Overcast"],
  45: ["fog", "Dimma", "Fog"],
  48: ["fog", "Underkyld dimma", "Freezing fog"],
  51: ["drizzle", "Lätt duggregn", "Light drizzle"],
  53: ["drizzle", "Duggregn", "Drizzle"],
  55: ["drizzle", "Kraftigt duggregn", "Dense drizzle"],
  56: ["sleet", "Underkylt duggregn", "Freezing drizzle"],
  57: ["sleet", "Kraftigt underkylt duggregn", "Dense freezing drizzle"],
  61: ["rain", "Lätt regn", "Light rain"],
  63: ["rain", "Regn", "Rain"],
  65: ["rain", "Kraftigt regn", "Heavy rain"],
  66: ["sleet", "Underkylt regn", "Freezing rain"],
  67: ["sleet", "Kraftigt underkylt regn", "Heavy freezing rain"],
  71: ["snow", "Lätt snöfall", "Light snow"],
  73: ["snow", "Snöfall", "Snow"],
  75: ["snow", "Kraftigt snöfall", "Heavy snow"],
  77: ["snow", "Snökorn", "Snow grains"],
  80: ["showers", "Lätta regnskurar", "Light rain showers"],
  81: ["showers", "Regnskurar", "Rain showers"],
  82: ["showers", "Kraftiga regnskurar", "Violent rain showers"],
  85: ["snowshowers", "Snöbyar", "Snow showers"],
  86: ["snowshowers", "Kraftiga snöbyar", "Heavy snow showers"],
  95: ["thunder", "Åska", "Thunderstorm"],
  96: ["thunder", "Åska med hagel", "Thunderstorm with hail"],
  99: ["thunder", "Kraftig åska med hagel", "Severe thunderstorm with hail"],
};

/** All WMO codes Open-Meteo uses. */
export const WEATHER_CODES: readonly number[] = Object.freeze(Object.keys(CODES).map(Number));

/**
 * Describes a WMO weather code.
 *
 * @example
 * ```ts
 * describeWeather(61);        // { label: "Lätt regn", icon: "rain" }
 * describeWeather(61, "en");  // { label: "Light rain", icon: "rain" }
 * ```
 */
export function describeWeather(code: number, locale: Locale = "sv"): WeatherDescription {
  const entry = CODES[code];
  if (!entry) return { label: locale === "en" ? "Unknown weather" : "Okänt väder", icon: "cloud" };
  return { label: locale === "en" ? entry[2] : entry[1], icon: entry[0] };
}

/** Formats a temperature as whole degrees with a typographic minus: `-3.6` → `"−4°"`. */
export function formatTemperature(celsius: number | null | undefined): string {
  return celsius == null || !Number.isFinite(celsius) ? "–" : Math.round(celsius).toString().replace("-", "−") + "°";
}

/** Options for {@link openMeteoUrl}. */
export interface OpenMeteoUrlOptions {
  /** Forecast endpoint. */
  base?: string;
  /** Forecast days, 1–16. Default 7. */
  days?: number;
  /** Decimals for the coordinates. Default 2 (≈ 1 km). */
  precision?: number;
}

/** Builds the Open-Meteo request for a position, with all fields {@link parseOpenMeteo} reads. */
export function openMeteoUrl(position: Coordinates, options: OpenMeteoUrlOptions = {}): string {
  assertCoordinates(position, "position");
  const days = options.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 16) throw new RangeError("days must be an integer 1–16");
  const precision = options.precision ?? 2;
  const url = new URL(options.base ?? "https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", position.latitude.toFixed(precision));
  url.searchParams.set("longitude", position.longitude.toFixed(precision));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,is_day",
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,weather_code,precipitation,precipitation_probability,wind_speed_10m,is_day",
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max",
  );
  url.searchParams.set("timezone", TIME_ZONE);
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("forecast_days", String(days));
  return url.toString();
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Converts an Open-Meteo response into a {@link Forecast}. Current conditions are required; hourly and daily
 * series are read as far as they are valid. Hours more than one hour in the past are dropped.
 *
 * @throws {SourceError} with code `"invalid-response"` when there are no current conditions.
 */
export function parseOpenMeteo(json: any, now: number = Date.now()): Forecast {
  const c = json?.current;
  const h = json?.hourly ?? {};
  const d = json?.daily ?? {};
  if (!c || num(c.temperature_2m) === null) {
    throw new SourceError("Unexpected response from Open-Meteo", { code: "invalid-response", source: "open-meteo" });
  }
  // Open-Meteo returns local times without a zone ("2026-10-12T14:00"); the response carries the offset.
  const offset = Number(json.utc_offset_seconds) || 0;
  const abs = (t: unknown): string => new Date(Date.parse(String(t) + "Z") - offset * 1000).toISOString();
  const hours: HourlyWeather[] = [];
  for (let i = 0; i < (h.time?.length ?? 0); i++) {
    const time = abs(h.time[i]);
    const temperature = num(h.temperature_2m?.[i]);
    if (Date.parse(time) < now - 3_600_000 || temperature === null) continue;
    hours.push({
      time,
      temperature,
      code: num(h.weather_code?.[i]) ?? 3,
      precipitation: num(h.precipitation?.[i]),
      precipitationProbability: num(h.precipitation_probability?.[i]),
      wind: num(h.wind_speed_10m?.[i]),
      isDay: h.is_day?.[i] !== 0,
    });
  }
  const days: DailyWeather[] = [];
  for (let i = 0; i < (d.time?.length ?? 0); i++) {
    const max = num(d.temperature_2m_max?.[i]);
    const min = num(d.temperature_2m_min?.[i]);
    if (max === null || min === null) continue;
    days.push({
      date: String(d.time[i]),
      code: num(d.weather_code?.[i]) ?? 3,
      max,
      min,
      precipitation: num(d.precipitation_sum?.[i]),
      precipitationProbability: num(d.precipitation_probability_max?.[i]),
      sunrise: d.sunrise?.[i] ? abs(d.sunrise[i]) : null,
      sunset: d.sunset?.[i] ? abs(d.sunset[i]) : null,
      wind: num(d.wind_speed_10m_max?.[i]),
    });
  }
  return {
    latitude: Number(json.latitude),
    longitude: Number(json.longitude),
    timezone: String(json.timezone || TIME_ZONE),
    current: {
      time: abs(c.time),
      temperature: num(c.temperature_2m) as number,
      feelsLike: num(c.apparent_temperature),
      code: num(c.weather_code) ?? 3,
      wind: num(c.wind_speed_10m),
      gust: num(c.wind_gusts_10m),
      precipitation: num(c.precipitation),
      humidity: num(c.relative_humidity_2m),
      isDay: c.is_day !== 0,
    },
    hours,
    days,
    fetchedAt: new Date(now).toISOString(),
  };
}

/**
 * Re-bases a saved forecast on another moment: drops past hours and days and, when the current conditions are
 * older than 90 minutes, replaces them with the forecast for the running hour (marked `currentIsForecast`).
 * Returns `null` when the forecast is too old (48 h) or no longer covers `now` – never stale data as "now".
 */
export function forecastAt<T extends Forecast>(forecast: T, now: number = Date.now()): T | null {
  if (!forecast?.current || !Array.isArray(forecast.hours) || !Array.isArray(forecast.days)) return null;
  const fetched = Date.parse(forecast.fetchedAt);
  if (!Number.isFinite(fetched) || now - fetched > 48 * 3_600_000) return null;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: forecast.timezone || TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const days = forecast.days.filter((d) => d.date >= date);
  const hours = forecast.hours.filter((h) => Date.parse(h.time) >= now - 3_600_000);
  if (!days.length) return null;
  if (now - Date.parse(forecast.current.time) < 90 * 60_000) return { ...forecast, days, hours };
  const hour = hours.find((h) => Date.parse(h.time) <= now && Date.parse(h.time) + 3_600_000 > now);
  if (!hour) return null;
  return {
    ...forecast,
    days,
    hours,
    currentIsForecast: true,
    current: {
      time: hour.time,
      temperature: hour.temperature,
      code: hour.code,
      wind: hour.wind,
      precipitation: hour.precipitation,
      isDay: hour.isDay,
      feelsLike: null,
      gust: null,
      humidity: null,
    },
  };
}
