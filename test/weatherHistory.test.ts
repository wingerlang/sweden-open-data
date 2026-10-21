import { test } from "node:test";
import assert from "node:assert/strict";
import { createWeatherHistoryClient, parseWeatherHistory } from "../src/weather/history.ts";
test("historical temperatures preserve zero, skip missing and invalid values and convert epoch seconds", () => {
  const r = parseWeatherHistory({ hourly: { time: [100, 200, 300], temperature_2m: [0, null, -3] } }, "now");
  assert.deepEqual(r.hours, [
    { at: 100000, celsius: 0 },
    { at: 300000, celsius: -3 },
  ]);
  assert.throws(() => parseWeatherHistory({ hourly: { time: [1], temperature_2m: [] } }, "now"));
});
test("history rounds coordinates, requests UTC epoch timestamps, caches and rejects oversized periods", async () => {
  let calls = 0;
  const c = createWeatherHistoryClient({
    fetch: async (input) => {
      calls++;
      const u = new URL(String(input));
      assert.equal(u.searchParams.get("latitude"), "55.12");
      assert.equal(u.searchParams.get("timezone"), "UTC");
      return new Response(JSON.stringify({ hourly: { time: [100], temperature_2m: [1] } }));
    },
  });
  await c.history({ latitude: 55.123456, longitude: 13.123456 }, "2026-01-01", "2026-01-31");
  await c.history({ latitude: 55.123456, longitude: 13.123456 }, "2026-01-01", "2026-01-31");
  assert.equal(calls, 1);
  await assert.rejects(c.history({ latitude: 55, longitude: 13 }, "2026-01-01", "2026-02-01"), RangeError);
});
