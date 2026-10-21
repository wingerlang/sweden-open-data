import test from "node:test";
import assert from "node:assert/strict";
import { createWeatherClient, parseWeatherEnvironment, pollenWarnings } from "../src/weather/mod.ts";
const now = Date.parse("2026-05-20T12:30:00Z"),
  hour = Math.floor(now / 3600000) * 3600;
const fixture = () => ({
  latitude: 59.33,
  longitude: 18.07,
  hourly: {
    time: [hour - 86400, hour, hour + 3600, hour + 86400],
    uv_index: [9, 3.2, 4.8, 10],
    birch_pollen: [999, 0, 30, 999],
    grass_pollen: [0, null, 8, null],
    pm2_5: [2, 3, 4, 5],
    pm10: [4, 5, 6, 7],
    european_aqi: [10, 20, 25, 30],
  },
});

test("environment parser preserves unknown, zero and fractional values with UTC timestamps", () => {
  const forecast = parseWeatherEnvironment(fixture(), ["uv", "pollen", "airQuality"], now);
  assert.equal(forecast.hours[1].uvIndex, 3.2);
  assert.equal(forecast.hours[1].pollen.birch, 0);
  assert.equal(forecast.hours[1].pollen.grass, null);
  assert.equal(forecast.hours[1].pollen.alder, null);
  assert.equal(forecast.hours[1].pm25, 3);
  assert.equal(forecast.hours[1].time, "2026-05-20T12:00:00.000Z");
  assert.equal(forecast.fetchedAt, "2026-05-20T12:30:00.000Z");
  const selected = parseWeatherEnvironment(fixture(), ["uv"], now);
  assert.equal(selected.hours[1].pollen.birch, null);
  assert.equal(selected.hours[1].europeanAqi, null);
});
test("malformed environmental responses fail; unavailable concentrations stay unknown", () => {
  for (const raw of [
    null,
    {},
    { ...fixture(), latitude: 999 },
    { ...fixture(), hourly: { ...fixture().hourly, uv_index: [1] } },
    { ...fixture(), hourly: { ...fixture().hourly, time: [hour, hour, hour + 3600, hour + 7200] } },
    { ...fixture(), hourly: { time: [hour] } },
  ])
    assert.throws(
      () => parseWeatherEnvironment(raw, ["uv", "pollen"], now),
      (e) => (e as { code: string }).code === "invalid-response",
    );
  const raw = fixture();
  raw.hourly.birch_pollen = [-1, NaN, Infinity, 0];
  const result = parseWeatherEnvironment(raw, ["pollen"], now);
  assert.deepEqual(
    result.hours.map((h) => h.pollen.birch),
    [null, null, null, 0],
  );
});
test("caller-defined pollen warnings use next 24 hours and never warn on missing data", () => {
  const forecast = parseWeatherEnvironment(fixture(), ["pollen"], now);
  // Exclude the deliberately high value beyond the next 24-hour window.
  forecast.hours[3].time = new Date(now + 86400000).toISOString();
  assert.deepEqual(
    pollenWarnings(forecast, 20, now).map((w) => [w.species, w.concentration]),
    [["birch", 30]],
  );
  assert.deepEqual(pollenWarnings(forecast, 100, now), []);
  assert.throws(() => pollenWarnings(forecast, 0, now), RangeError);
});
test("opt-in client rounds coordinates, separates metric caches and validates before network", async () => {
  const urls: string[] = [];
  const client = createWeatherClient({
    retries: 0,
    now: () => now,
    fetch: async (input) => {
      urls.push(String(input));
      return Response.json(fixture());
    },
  });
  await client.environment({ latitude: 59.3293, longitude: 18.0686 }, { metrics: ["pollen", "uv"] });
  await client.environment({ latitude: 59.331, longitude: 18.071 }, { metrics: ["uv", "pollen", "uv"] });
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("latitude"), "59.33");
  assert.equal(url.searchParams.get("longitude"), "18.07");
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.match(url.searchParams.get("hourly")!, /birch_pollen/);
  assert.doesNotMatch(url.searchParams.get("hourly")!, /pm10/);
  await client.environment({ latitude: 59.33, longitude: 18.07 }, { metrics: ["uv"] });
  assert.equal(urls.length, 2);
  await assert.rejects(client.environment({ latitude: 999, longitude: 1 }), RangeError);
  await assert.rejects(client.environment({ latitude: 59, longitude: 18 }, { days: 5 }), RangeError);
  await assert.rejects(client.environment({ latitude: 59, longitude: 18 }, { metrics: [] }), RangeError);
  assert.equal(urls.length, 2);
});
test("environment source errors and cancellation retain typed errors", async () => {
  const client = createWeatherClient({ retries: 0, fetch: async () => new Response("", { status: 503 }) });
  await assert.rejects(
    client.environment({ latitude: 59, longitude: 18 }),
    (e) => (e as { source: string }).source === "open-meteo-air-quality",
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    client.environment({ latitude: 59, longitude: 18 }, { signal: abort.signal }),
    (e) => (e as { code: string }).code === "aborted",
  );
});
