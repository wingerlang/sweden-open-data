import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";

const STOCKHOLM = { latitude: 59.33, longitude: 18.07 };

test("spot.history keeps past days in a cache of their own, so current data stays cached", async () => {
  const fake = createFakeSources();
  const se = createClient({ fetch: fake.fetch, retries: 0 });
  await se.weather.forecast(STOCKHOLM);
  await se.spot.history("SE3", "2025-01-01", "2025-12-31");
  await se.spot.history("SE4", "2025-01-01", "2025-12-31");
  const before = fake.calls.length;
  await se.weather.forecast(STOCKHOLM);
  assert.equal(fake.calls.length - before, 0, "the forecast is still cached");
  await se.spot.history("SE4", "2025-12-01", "2025-12-31");
  assert.equal(fake.calls.length - before, 0, "recent history days are still cached");
  se.clearCache();
  await se.spot.history("SE4", "2025-12-31", "2025-12-31");
  assert.equal(fake.calls.length - before, 1, "clearCache empties the history cache too");
});
