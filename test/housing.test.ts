import { test } from "node:test";
import assert from "node:assert/strict";
import { createHousingClient, parseHousing } from "../src/economy/mod.ts";
import { createClient, memoryStore } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";
import { fakeFetch, quick } from "./helpers.ts";
const sample = () => ({
  id: ["Tid", "Region", "ContentsCode"],
  size: [3, 2, 1],
  dimension: {
    Tid: { category: { index: { "2025K1": 0, "2025K2": 1, "2025K3": 2 } } },
    Region: { category: { index: { "00": 0, RIKS4: 1 } } },
    ContentsCode: { category: { index: { BO0501K2: 0 } } },
  },
  value: [100, 200, 101, null, 102, 220],
  note: ["Synthetic fixture"],
  updated: "2026-01-01",
});
test("housing parser honors dimension order, requested region, missing values and quarter boundaries", () => {
  const result = parseHousing(sample(), "RIKS4", "quarter");
  assert.deepEqual(result.points, [
    { period: "2025K1", from: "2025-01-01", to: "2025-03-31", value: 200 },
    { period: "2025K3", from: "2025-07-01", to: "2025-09-30", value: 220 },
  ]);
  assert.deepEqual(result.notes, ["Synthetic fixture"]);
  for (const raw of [
    { ...sample(), value: [1] },
    { ...sample(), value: [100, -1, 101, null, 102, 220] },
    { ...sample(), id: ["Tid", "Region", "Unexpected"] },
  ])
    assert.throws(() => parseHousing(raw, "RIKS4", "quarter"));
  assert.throws(() => parseHousing(sample(), "RIKS8", "quarter"));
  assert.throws(() => parseHousing(sample(), "bad", "quarter"));
});
test("annual county indices preserve annual periods and their different content code", () => {
  const raw = {
    id: ["Lan", "ContentsCode", "Tid"],
    size: [1, 1, 2],
    dimension: {
      Lan: { category: { index: { "12": 0 } } },
      ContentsCode: { category: { index: { BO0501R5: 0 } } },
      Tid: { category: { index: { "2024": 0, "2025": 1 } } },
    },
    value: [300, 315],
  };
  assert.deepEqual(
    parseHousing(raw, "12", "year").points.map((p) => [p.from, p.to, p.value]),
    [
      ["2024-01-01", "2024-12-31", 300],
      ["2025-01-01", "2025-12-31", 315],
    ],
  );
});
test("housing clients deduplicate loads, reuse durable copies and retain last good data when SCB fails", async () => {
  let now = Date.parse("2026-10-25T12:00:00Z");
  const fetch = fakeFetch(() => sample()),
    store = memoryStore(),
    options = { ...quick, fetch, store, now: () => now },
    client = createHousingClient(options);
  const [a, b] = await Promise.all([client.housePrices("RIKS4"), client.housePrices("RIKS4")]);
  assert.deepEqual(a, b);
  assert.equal(fetch.calls.length, 1);
  assert.equal(a.base, "1981=100");
  assert.equal(fetch.calls[0].searchParams.get("valueCodes[Region]"), "RIKS4");
  await createHousingClient(options).housePrices("RIKS4");
  assert.equal(fetch.calls.length, 1);
  now += 7 * 3600000;
  const down = createHousingClient({ ...options, fetch: fakeFetch(() => new Response("", { status: 503 })) });
  assert.equal((await down.housePrices("RIKS4")).stale, true);
  await assert.rejects(() => client.housePrices("12"));
});
test("the shared economy client and dev-board fake include both housing frequencies", async () => {
  const fake = createFakeSources(),
    client = createClient({ ...quick, fetch: fake.fetch });
  assert.equal((await client.economy.housePrices("RIKS4")).points.length, 4);
  assert.equal((await client.economy.housePrices("12", { frequency: "year" })).base, "1990=100");
  assert.ok((await client.economy.cpi()).points.length > 12);
});
