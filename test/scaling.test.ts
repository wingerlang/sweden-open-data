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

test("alert matching: the bounding-box shortcut never changes the answer", async () => {
  const { alertPlaces } = await import("../src/alerts/alerts.ts");
  // An L shape: its bounding box covers the empty corner at (15.5, 57.5).
  const lShape = [
    [
      [14, 56],
      [17, 56],
      [17, 57],
      [15, 57],
      [15, 58],
      [14, 58],
      [14, 56],
    ],
  ];
  const alert = {
    id: "smhi:1",
    source: "SMHI" as const,
    kind: "warning" as const,
    title: "t",
    summary: "",
    url: "https://www.smhi.se",
    published: "2026-10-21T10:00:00Z",
    areas: [],
    polygons: [lShape],
  };
  const places = [
    { latitude: 56.5, longitude: 16.5 }, // inside
    { latitude: 57.5, longitude: 15.5 }, // inside the box, outside the polygon
    { latitude: 60, longitude: 18 }, // outside the box
    { latitude: 57.5, longitude: 14.5 }, // inside
  ];
  for (let round = 0; round < 2; round++) assert.deepEqual(alertPlaces(alert, places).places, [0, 3]);
});
