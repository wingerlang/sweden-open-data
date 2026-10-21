import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createClient,
  createContext,
  createSpotClient,
  createWeatherClient,
  DEFAULT_ENDPOINTS,
  type RequestEvent,
  SourceError,
} from "../src/mod.ts";
import * as root from "../src/mod.ts";
import { elprisDay, fakeFetch, openMeteoResponse, quick } from "./helpers.ts";

test("createClient: one cache and one configuration for every area", async () => {
  const events: RequestEvent[] = [];
  const fetch = fakeFetch((url) => (url.hostname === "api.open-meteo.com" ? openMeteoResponse() : elprisDay()));
  const se = createClient({
    fetch,
    onRequest: (e) => events.push(e),
    now: () => Date.parse("2026-10-12T10:00:00+02:00"),
    ...quick,
  });
  assert.ok(Object.isFrozen(se));
  const { today } = await se.spot.prices("SE3");
  assert.equal(today?.points.length, 96);
  await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
  await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
  assert.equal(fetch.calls.filter((c) => c.hostname === "api.open-meteo.com").length, 1);
  se.clearCache();
  await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
  assert.equal(fetch.calls.filter((c) => c.hostname === "api.open-meteo.com").length, 2, "cleared");
  assert.deepEqual([...new Set(events.map((e) => e.source))].sort(), ["elprisetjustnu", "open-meteo"]);
  assert.equal(typeof se.alerts.near, "function");
  assert.equal(typeof se.geo.addresses, "function");
});

test("standalone clients can share a context", async () => {
  const fetch = fakeFetch(() => openMeteoResponse());
  const shared = createContext({ fetch, ...quick });
  const a = createWeatherClient(shared);
  const b = createWeatherClient(shared);
  await a.forecast({ latitude: 59.33, longitude: 18.07 });
  await b.forecast({ latitude: 59.33, longitude: 18.07 });
  assert.equal(fetch.calls.length, 1);
  assert.ok(createSpotClient());
});

test("custom endpoints and disabled cache", async () => {
  const fetch = fakeFetch(() => openMeteoResponse());
  const se = createClient({ fetch, cache: false, endpoints: { weather: "https://mirror.test/forecast" }, ...quick });
  await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
  await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].origin + fetch.calls[0].pathname, "https://mirror.test/forecast");
  assert.ok(DEFAULT_ENDPOINTS.spot.startsWith("https://"));
  assert.ok(Object.isFrozen(DEFAULT_ENDPOINTS));
});

test("the main entry point exports every area", () => {
  for (const name of [
    "createClient",
    "createSpotClient",
    "createWeatherClient",
    "createAlertsClient",
    "createGeoClient",
    "summarizeSpotPrices",
    "describeWeather",
    "relevantAlerts",
    "parseAddressQuery",
    "swedishDate",
    "distanceKm",
    "memoryStore",
    "SourceError",
  ]) {
    assert.equal(typeof (root as Record<string, unknown>)[name], "function", name);
  }
  assert.ok(new SourceError("x", { code: "http", source: "s" }) instanceof Error);
});
