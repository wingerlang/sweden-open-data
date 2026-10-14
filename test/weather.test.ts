import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWeatherClient,
  describeWeather,
  type Forecast,
  forecastAt,
  formatTemperature,
  openMeteoUrl,
  parseOpenMeteo,
  WEATHER_CODES,
  WEATHER_SOURCE,
} from "../src/weather/mod.ts";
import { SourceError } from "../src/core/errors.ts";
import { fakeFetch, openMeteoResponse, quick } from "./helpers.ts";

const NOW = Date.parse("2026-10-12T12:00:00Z");

test("parsing: absolute times, skipped gaps, Swedish and English labels", () => {
  const w = parseOpenMeteo(openMeteoResponse(), NOW);
  assert.equal(w.current.temperature, 9.4);
  assert.equal(w.current.feelsLike, 6.8);
  assert.equal(w.current.humidity, 71);
  assert.equal(w.current.time, "2026-10-12T12:00:00.000Z", "local time becomes UTC");
  assert.equal(w.current.isDay, true);
  assert.equal(w.days.length, 2, "a day without max/min is skipped");
  assert.equal(w.days[0].sunrise, "2026-10-12T05:18:00.000Z");
  assert.equal(w.days[0].precipitationProbability, 80);
  assert.equal(w.hours.length, 46, "hours over an hour old and an hour without temperature are skipped");
  assert.ok(w.hours.some((h) => !h.isDay));
  assert.equal(w.fetchedAt, new Date(NOW).toISOString());
  assert.equal(w.timezone, "Europe/Stockholm");
  assert.equal(describeWeather(w.current.code).label, "Lätt regn");
  assert.deepEqual(describeWeather(61, "en"), { label: "Light rain", icon: "rain" });
  assert.deepEqual(describeWeather(1234), { label: "Okänt väder", icon: "cloud" });
  assert.equal(describeWeather(1234, "en").label, "Unknown weather");
  assert.ok(WEATHER_CODES.includes(95));
  assert.throws(() => parseOpenMeteo({}), (e: SourceError) => e.code === "invalid-response");
  assert.throws(() => parseOpenMeteo(null));

  const sparse = parseOpenMeteo({ current: { time: "2026-10-12T14:00", temperature_2m: "5" }, latitude: 1, longitude: 2 }, NOW);
  assert.equal(sparse.current.code, 3);
  assert.equal(sparse.current.wind, null);
  assert.equal(sparse.current.time, "2026-10-12T14:00:00.000Z", "no offset given: treated as UTC");
  assert.deepEqual([sparse.hours, sparse.days], [[], []]);
  const odd = parseOpenMeteo({ current: { time: "2026-10-12T14:00", temperature_2m: 5, wind_speed_10m: "" }, daily: { time: ["2026-10-12"], temperature_2m_max: [1], temperature_2m_min: [0] }, hourly: { time: ["2026-10-12T14:00"], temperature_2m: [1] } }, NOW);
  assert.equal(odd.current.wind, null);
  assert.equal(odd.days[0].code, 3);
  assert.equal(odd.hours[0].code, 3);
});

test("request URL: rounded position, all fields, validated options", () => {
  const url = new URL(openMeteoUrl({ latitude: 59.3293, longitude: 18.0686 }));
  assert.equal(url.searchParams.get("latitude"), "59.33");
  assert.equal(url.searchParams.get("longitude"), "18.07");
  assert.equal(url.searchParams.get("forecast_days"), "7");
  assert.equal(url.searchParams.get("wind_speed_unit"), "ms");
  assert.ok(url.searchParams.get("hourly")!.includes("precipitation_probability"));
  assert.equal(new URL(openMeteoUrl({ latitude: 59.3293, longitude: 18.0686 }, { precision: 3, days: 3, base: "https://m.test/f" })).search.includes("latitude=59.329"), true);
  assert.throws(() => openMeteoUrl({ latitude: 59, longitude: 18 }, { days: 17 }), RangeError);
  assert.throws(() => openMeteoUrl({ latitude: 99, longitude: 18 }), RangeError);
});

test("formatting temperatures", () => {
  assert.equal(formatTemperature(-3.6), "−4°");
  assert.equal(formatTemperature(12.4), "12°");
  assert.equal(formatTemperature(null), "–");
  assert.equal(formatTemperature(undefined), "–");
  assert.equal(formatTemperature(NaN), "–");
});

test("forecastAt: moves a saved forecast forward, never shows yesterday as now", () => {
  const w = parseOpenMeteo(openMeteoResponse(), NOW);
  assert.equal(forecastAt(w, NOW)?.currentIsForecast, undefined, "fresh conditions are kept");
  const later = forecastAt(w, NOW + 20 * 3_600_000)!;
  assert.equal(later.currentIsForecast, true);
  assert.equal(later.current.feelsLike, null);
  assert.ok(later.days.every((d) => d.date >= "2026-10-13"));
  assert.equal(forecastAt(w, NOW + 49 * 3_600_000), null, "too old");
  assert.equal(forecastAt({ ...w, hours: [] }, NOW + 5 * 3_600_000), null, "no forecast for the hour");
  assert.equal(forecastAt({ ...w, days: [] }, NOW), null);
  assert.equal(forecastAt({ ...w, fetchedAt: "x" }, NOW), null);
  assert.equal(forecastAt({ temp: 1 } as unknown as Forecast, NOW), null, "an old cached shape is rejected");
  assert.ok(forecastAt({ ...w, timezone: "" }, NOW));
});

test("client: rounds before sending, caches per ~1 km, reports failures", async () => {
  let fail = false;
  const fetch = fakeFetch(() => {
    if (fail) throw new TypeError("offline");
    return openMeteoResponse();
  });
  const weather = createWeatherClient({ fetch, now: () => NOW, ...quick });
  const a = await weather.forecast({ latitude: 59.3293, longitude: 18.0686 });
  const b = await weather.forecast({ latitude: 59.331, longitude: 18.071 });
  assert.equal(a, b);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].searchParams.get("latitude"), "59.33");
  await weather.forecast({ latitude: 59.33, longitude: 18.07 }, { days: 3 });
  assert.equal(fetch.calls.length, 2, "different length, different request");
  fail = true;
  await assert.rejects(weather.forecast({ latitude: 10, longitude: 10 }), (e: SourceError) => e.code === "network" && e.source === "open-meteo");
  await assert.rejects(weather.forecast({ latitude: 999, longitude: 1 }), RangeError);
  assert.equal(WEATHER_SOURCE.license, "CC BY 4.0");
});
