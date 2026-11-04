import { test } from "node:test";
import assert from "node:assert/strict";
import { createPolicyRateClient, parsePolicyRate, policyRateAt } from "../src/economy/mod.ts";
import { createClient, memoryStore } from "../src/mod.ts";
import { createFakeSources, fakePolicyRate } from "../src/testing.ts";
import { fakeFetch, quick } from "./helpers.ts";

test("policy-rate parser keeps only changes and the latest observation, sorted by date", () => {
  const points = parsePolicyRate([
    { date: "2024-05-08", value: 3.75 },
    { date: "2020-01-01", value: 0 },
    { date: "2020-02-01", value: 0 },
    { date: "2020-03-01", value: 0 },
    { date: "2022-05-05", value: -0.25 },
  ]);
  assert.deepEqual(points, [
    { date: "2020-01-01", ratePct: 0 },
    { date: "2022-05-05", ratePct: -0.25 },
    { date: "2024-05-08", ratePct: 3.75 },
  ]);
  for (const raw of [
    null,
    [],
    [{ date: "2024-02-30", value: 1 }],
    [{ date: "2024-01-01", value: "1" }],
    [{ date: "2024-01-01", value: 101 }],
    [{ date: "2024-01-01", value: -21 }],
    [{ value: 1 }],
  ])
    assert.throws(() => parsePolicyRate(raw));
});

test("policyRateAt returns the rate that applied on a date", () => {
  const series = { points: parsePolicyRate(fakePolicyRate()) };
  assert.equal(policyRateAt(series, "2019-12-31"), undefined);
  assert.equal(policyRateAt(series, "2021-01-01"), 0);
  assert.equal(policyRateAt(series, "2023-10-01"), 4);
  assert.equal(policyRateAt(series, "2026-01-01"), 3.75);
});

test("policy-rate client asks the Riksbank once, caches and falls back to the last good copy", async () => {
  const fake = createFakeSources({ now: () => Date.parse("2026-11-04T12:00:00Z") });
  const se = createClient({ ...quick, fetch: fake.fetch, store: memoryStore() });
  const first = await se.economy.policyRate();
  assert.equal(first.seriesId, "SECBREPOEFF");
  assert.equal(first.points.at(-1)?.ratePct, 3.75);
  await se.economy.policyRate();
  const requests = fake.calls.filter((u) => u.hostname === "api.riksbank.se");
  assert.equal(requests.length, 1);
  assert.match(requests[0].href, /Observations\/SECBREPOEFF\/1985-01-01\/2026-11-04$/);
});

test("policy-rate client serves the stored copy as stale when the Riksbank fails", async () => {
  const store = memoryStore();
  let fail = false;
  const fetchImpl = fakeFetch(() => (fail ? new Response("down", { status: 503 }) : Response.json(fakePolicyRate())));
  let now = 0;
  const client = createPolicyRateClient({ ...quick, fetch: fetchImpl, store, now: () => now });
  const fresh = await client.policyRate();
  assert.equal(fresh.stale, undefined);
  fail = true;
  now = 7 * 3600_000;
  const stale = await client.policyRate();
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.points, fresh.points);
});
