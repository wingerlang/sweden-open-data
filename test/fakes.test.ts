import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/mod.ts";
import { createInvestmentClient } from "../src/investments/mod.ts";
import { createFreeVehicleClient } from "../src/vehicles/free.ts";
import { createFakeSources, SOURCE_IDS } from "../src/testing.ts";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const here = { latitude: 59.33, longitude: 18.07 };

test("fakes: every source in SOURCE_IDS answers through createFakeSources", async () => {
  const fake = createFakeSources({ now: () => NOW });
  const options = { fetch: fake.fetch, retries: 0, now: () => NOW };
  const se = createClient(options);
  const history = await se.weather.history(here, "2026-01-01", "2026-01-02");
  assert.equal(history.hours.length, 48);
  const environment = await se.weather.environment(here, { days: 1 });
  assert.equal(environment.hours.length, 24);
  assert.ok(environment.hours.every((h) => h.uvIndex !== null && h.pm25 !== null && h.pollen.birch !== null));
  const ib = createInvestmentClient(options);
  const overview = await ib.overview();
  assert.deepEqual(
    overview.companies.map((c) => c.product),
    ["DEMO A", "DEMO B"],
  );
  const detail = await ib.company("DEMO A");
  assert.equal(detail.history.length, 30);
  assert.equal(detail.holdings.length, 3);
  const vehicle = await createFreeVehicleClient(options).lookup("ABC123");
  assert.deepEqual([vehicle?.make, vehicle?.mileageKm, vehicle?.annualTaxKr], ["EXEMPEL", 48500, 1234]);
  const hosts = new Set(fake.calls.map((u) => u.hostname));
  for (const host of ["archive-api.open-meteo.com", "air-quality-api.open-meteo.com", "ibindex.se"]) {
    assert.ok(hosts.has(host), host);
  }
  assert.ok(SOURCE_IDS.includes("transportstyrelsen"));
});

import { createMarketClient } from "../src/market/mod.ts";
test("market fakes cover quotes, company data, reports and the exact FRED fallback", async () => {
  const fake = createFakeSources({ now: () => NOW }),
    market = createMarketClient({ fetch: fake.fetch, now: () => NOW, retries: 0 });
  assert.equal((await market.quote("SYNTH.ST", "max")).symbol, "SYNTH.ST");
  assert.equal((await market.fundamentals("SYNTH.ST")).currency, "SEK");
  assert.equal((await market.reports("synthetic")).slug, "synthetic");
  fake.setFault("nasdaq", { status: 503 });
  assert.equal((await market.index("benchmark-omxs30gi")).sourceName, "Nasdaq via FRED");
  for (const source of ["yahoo", "nasdaq", "fred", "mfn"] as const) assert.ok(SOURCE_IDS.includes(source));
});
