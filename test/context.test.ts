import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, DEFAULT_ENDPOINTS, DEFAULT_TTL, type SourceError } from "../src/mod.ts";
import { createInvestmentClient } from "../src/investments/mod.ts";
import { createVehicleClient } from "../src/vehicles/mod.ts";
import { fakeFetch } from "./helpers.ts";

test("context: every network client takes its address and lifetime from the shared context", () => {
  for (const key of ["weatherArchive", "ibindex", "biluppgifter", "transportstyrelsen"] as const) {
    assert.match(DEFAULT_ENDPOINTS[key], /^https:\/\//);
  }
  for (const key of ["weatherHistory", "investments", "investmentsOverview", "vehicle"] as const) {
    assert.ok(DEFAULT_TTL[key] > 0);
  }
});

test("weather.history: on the main client, via the context's endpoint, cache and cancellation", async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.origin + url.pathname, "https://archive.test/v1/archive");
    return { hourly: { time: [1_767_225_600], temperature_2m: [-2.5] } };
  });
  const se = createClient({ fetch, retries: 0, endpoints: { weatherArchive: "https://archive.test/v1/archive" } });
  const position = { latitude: 59.33, longitude: 18.07 };
  const first = await se.weather.history(position, "2026-01-01", "2026-01-01");
  assert.deepEqual(first.hours, [{ at: 1_767_225_600_000, celsius: -2.5 }]);
  await se.weather.history(position, "2026-01-01", "2026-01-01");
  assert.equal(fetch.calls.length, 1, "cached in the shared cache");
  await assert.rejects(
    se.weather.history(position, "2026-01-02", "2026-01-02", { signal: AbortSignal.abort() }),
    (e: SourceError) => e.code === "aborted",
  );
});

test("investments: endpoint from the context and cancellation per call", async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.origin, "https://ib.test");
    return [{ product: "INVE B", productName: "Investor B" }];
  });
  const ib = createInvestmentClient({ fetch, retries: 0, endpoints: { ibindex: "https://ib.test/ibi" } });
  assert.equal((await ib.companies()).companies[0].product, "INVE B");
  assert.equal(fetch.calls[0].pathname, "/ibi/companies/getCompanies.req");
  await assert.rejects(ib.overview({ signal: AbortSignal.abort() }), (e: SourceError) => e.code === "aborted");
});

test("vehicles: the API key only ever goes to the default address", async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.origin, new URL(DEFAULT_ENDPOINTS.biluppgifter).origin);
    return new Response("{}", { status: 404 });
  });
  const options = { apiKey: "test-only", fetch, retries: 0, endpoints: { biluppgifter: "https://evil.test/" } };
  const vehicles = createVehicleClient(options as Parameters<typeof createVehicleClient>[0]);
  assert.equal(await vehicles.lookup("ABC123"), null);
  assert.equal(fetch.calls.length, 1);
});

test("stats: every source is counted under its own name", async () => {
  const fetch = fakeFetch((url) =>
    url.hostname.startsWith("archive")
      ? { hourly: { time: [1_767_225_600], temperature_2m: [1] } }
      : { hourly: { time: [1_767_225_600], uv_index: [2] }, latitude: 59.33, longitude: 18.07 },
  );
  const se = createClient({ fetch, retries: 0 });
  const here = { latitude: 59.33, longitude: 18.07 };
  await se.weather.history(here, "2026-01-01", "2026-01-01");
  await se.weather.environment(here, { metrics: ["uv"] });
  assert.deepEqual(Object.keys(se.stats().sources).sort(), ["open-meteo-air-quality", "open-meteo-archive"]);
});
