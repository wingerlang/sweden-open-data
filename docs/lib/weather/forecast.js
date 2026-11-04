/**
 * Weather forecasts from [Open-Meteo](https://open-meteo.com) (free, no key, CC BY 4.0), normalised to a small
 * format with absolute times, plus WMO weather codes in Swedish and English. Everything here is pure.
 *
 * @module
 */
import { finiteNumber, invalidResponse, list, record } from "../core/parse.js";
import { assertCoordinates } from "../core/geo.js";
import { TIME_ZONE } from "../core/time.js";
import { DEFAULT_ENDPOINTS } from "../core/context.js";
const CODES = {
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
export const WEATHER_CODES = Object.freeze(Object.keys(CODES).map(Number));
/**
 * Describes a WMO weather code.
 *
 * @example
 * ```ts
 * describeWeather(61);        // { label: "Lätt regn", icon: "rain" }
 * describeWeather(61, "en");  // { label: "Light rain", icon: "rain" }
 * ```
 */
export function describeWeather(code, locale = "sv") {
    const entry = CODES[code];
    if (!entry)
        return { label: locale === "en" ? "Unknown weather" : "Okänt väder", icon: "cloud" };
    return { label: locale === "en" ? entry[2] : entry[1], icon: entry[0] };
}
/** Formats a temperature as whole degrees with a typographic minus: `-3.6` → `"−4°"`. */
export function formatTemperature(celsius) {
    return celsius == null || !Number.isFinite(celsius) ? "–" : Math.round(celsius).toString().replace("-", "−") + "°";
}
/** Builds the Open-Meteo request for a position, with all fields {@link parseOpenMeteo} reads. */
export function openMeteoUrl(position, options = {}) {
    assertCoordinates(position, "position");
    const days = options.days ?? 7;
    if (!Number.isInteger(days) || days < 1 || days > 16)
        throw new RangeError("days must be an integer 1–16");
    const precision = options.precision ?? 2;
    const url = new URL(options.base ?? DEFAULT_ENDPOINTS.weather);
    url.searchParams.set("latitude", position.latitude.toFixed(precision));
    url.searchParams.set("longitude", position.longitude.toFixed(precision));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,is_day");
    url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation,precipitation_probability,wind_speed_10m,is_day");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max");
    url.searchParams.set("timezone", TIME_ZONE);
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("forecast_days", String(days));
    return url.toString();
}
const num = (v) => finiteNumber(v, { strings: true });
/**
 * Converts an Open-Meteo response into a {@link Forecast}. Current conditions are required; hourly and daily
 * series are read as far as they are valid. Hours more than one hour in the past are dropped.
 *
 * @throws {SourceError} with code `"invalid-response"` when there are no current conditions.
 */
export function parseOpenMeteo(json, now = Date.now()) {
    const root = record(json);
    const c = record(root.current);
    const h = record(root.hourly);
    const d = record(root.daily);
    if (num(c.temperature_2m) === null)
        throw invalidResponse("open-meteo", "Unexpected response from Open-Meteo");
    // Open-Meteo returns local times without a zone ("2026-10-12T14:00"); the response carries the offset.
    const offset = Number(root.utc_offset_seconds) || 0;
    const abs = (t) => new Date(Date.parse(String(t) + "Z") - offset * 1000).toISOString();
    const at = (series, i) => list(series)[i];
    const hours = [];
    const hourTimes = list(h.time);
    for (let i = 0; i < hourTimes.length; i++) {
        const time = abs(hourTimes[i]);
        const temperature = num(at(h.temperature_2m, i));
        if (Date.parse(time) < now - 3_600_000 || temperature === null)
            continue;
        hours.push({
            time,
            temperature,
            code: num(at(h.weather_code, i)) ?? 3,
            precipitation: num(at(h.precipitation, i)),
            precipitationProbability: num(at(h.precipitation_probability, i)),
            wind: num(at(h.wind_speed_10m, i)),
            isDay: at(h.is_day, i) !== 0,
        });
    }
    const days = [];
    const dayTimes = list(d.time);
    for (let i = 0; i < dayTimes.length; i++) {
        const max = num(at(d.temperature_2m_max, i));
        const min = num(at(d.temperature_2m_min, i));
        if (max === null || min === null)
            continue;
        const sunrise = at(d.sunrise, i);
        const sunset = at(d.sunset, i);
        days.push({
            date: String(dayTimes[i]),
            code: num(at(d.weather_code, i)) ?? 3,
            max,
            min,
            precipitation: num(at(d.precipitation_sum, i)),
            precipitationProbability: num(at(d.precipitation_probability_max, i)),
            sunrise: sunrise ? abs(sunrise) : null,
            sunset: sunset ? abs(sunset) : null,
            wind: num(at(d.wind_speed_10m_max, i)),
        });
    }
    return {
        latitude: Number(root.latitude),
        longitude: Number(root.longitude),
        timezone: String(root.timezone || TIME_ZONE),
        current: {
            time: abs(c.time),
            temperature: num(c.temperature_2m),
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
export function forecastAt(forecast, now = Date.now()) {
    if (!forecast?.current || !Array.isArray(forecast.hours) || !Array.isArray(forecast.days))
        return null;
    const fetched = Date.parse(forecast.fetchedAt);
    if (!Number.isFinite(fetched) || now - fetched > 48 * 3_600_000)
        return null;
    const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: forecast.timezone || TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(now));
    const days = forecast.days.filter((d) => d.date >= date);
    const hours = forecast.hours.filter((h) => Date.parse(h.time) >= now - 3_600_000);
    if (!days.length)
        return null;
    if (now - Date.parse(forecast.current.time) < 90 * 60_000)
        return { ...forecast, days, hours };
    const hour = hours.find((h) => Date.parse(h.time) <= now && Date.parse(h.time) + 3_600_000 > now);
    if (!hour)
        return null;
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
