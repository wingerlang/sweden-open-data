import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bankListRateFor,
  createBankRateClient,
  createMortgageRateClient,
  isMortgageBank,
  mortgageBindingFor,
  mortgageRateAt,
  parseHandelsbankenRates,
  parseMortgageRates,
} from "../src/economy/mod.ts";
import { createClient, memoryStore } from "../src/mod.ts";
import { createFakeSources, fakeBankAverageRates, fakeBankListRates, fakeMortgageRates } from "../src/testing.ts";
import { fakeFetch, quick } from "./helpers.ts";

const sample = () => ({
  id: ["Tid", "Referenssektor", "Motpartssektor", "Avtal", "Rantebindningstid", "ContentsCode"],
  size: [3, 1, 1, 2, 2, 1],
  dimension: {
    Tid: { category: { index: { "2026M06": 0, "2026M07": 1, "2026M08": 2 } } },
    Referenssektor: { category: { index: ["1"] } },
    Motpartssektor: { category: { index: { "2c": 0 } } },
    Avtal: { category: { index: { "0100": 0, "0200": 1 } } },
    Rantebindningstid: { category: { index: { "1.1.1": 0, "1.1.2.3": 1 } } },
    ContentsCode: { category: { index: { "000004ZW": 0 } } },
  },
  // Tid × Avtal × Rantebindningstid
  value: [2.7, 3.5, 2.4, 3.2, 2.65, null, 2.39, 3.21, 2.6, 3.4, 2.38, 3.19],
  updated: "2026-09-25T06:00:00Z",
});

test("mortgage-rate parser follows advertised dimension order and keeps missing months missing", () => {
  const { series, updated } = parseMortgageRates(sample());
  assert.equal(updated, "2026-09-25T06:00:00Z");
  assert.deepEqual(
    series.map((s) => [s.agreement, s.binding, s.points.map((p) => p.ratePct)]),
    [
      ["new", "floating", [2.7, 2.65, 2.6]],
      ["new", "5y+", [3.5, 3.4]],
      ["outstanding", "floating", [2.4, 2.39, 2.38]],
      ["outstanding", "5y+", [3.2, 3.21, 3.19]],
    ],
  );
  assert.equal(series[1].points[0].month, "2026-06");
  assert.equal(series[0].label, "Rörlig (3 mån) · nya avtal");
  for (const raw of [
    { ...sample(), value: [1] },
    { ...sample(), value: sample().value.map((v, i) => (i === 0 ? 99 : v)) },
    { ...sample(), value: sample().value.map((v, i) => (i === 0 ? "x" : v)) },
    { ...sample(), id: ["Tid", "Referenssektor", "Motpartssektor", "Avtal", "Rantebindningstid", "Other"] },
    { ...sample(), dimension: { ...sample().dimension, Tid: { category: { index: { "2026-06": 0, b: 1, c: 2 } } } } },
    { ...sample(), dimension: { ...sample().dimension, Tid: { category: { index: { a: 0, b: 0, c: 2 } } } } },
    { ...sample(), dimension: { ...sample().dimension, Tid: {} } },
    { ...sample(), dimension: { ...sample().dimension, Motpartssektor: { category: { index: { x: 0 } } } } },
    { ...sample(), value: sample().value.map(() => null) },
    null,
  ])
    assert.throws(() => parseMortgageRates(raw));
});

test("binding bands and month lookups never invent earlier observations", () => {
  assert.deepEqual(
    [0, 3, 6, 12, 24, 36, 60, 120].map(mortgageBindingFor),
    ["floating", "floating", "3m-1y", "3m-1y", "1y-3y", "1y-3y", "3y-5y", "5y+"],
  );
  assert.throws(() => mortgageBindingFor(-1));
  const floating = parseMortgageRates(sample()).series[0];
  assert.equal(mortgageRateAt(floating, "2026-05"), undefined);
  assert.equal(mortgageRateAt(floating, "2026-07"), 2.65);
  assert.equal(mortgageRateAt(floating, "2027-01"), 2.6);
});

test("mortgage-rate clients request one table, share loads and serve the last good copy", async () => {
  let now = Date.parse("2026-10-25T12:00:00Z");
  const fetch = fakeFetch(() => sample()),
    store = memoryStore(),
    options = { ...quick, fetch, store, now: () => now },
    client = createMortgageRateClient(options);
  const [a, b] = await Promise.all([client.mortgageRates(), client.mortgageRates()]);
  assert.deepEqual(a, b);
  assert.equal(fetch.calls.length, 1);
  assert.match(fetch.calls[0].pathname, /TAB5783/);
  assert.equal(fetch.calls[0].searchParams.get("valueCodes[Avtal]"), "0100,0200");
  now += 7 * 3600000;
  const down = createMortgageRateClient({ ...options, fetch: fakeFetch(() => new Response("", { status: 503 })) });
  assert.equal((await down.mortgageRates()).stale, true);
});

test("Handelsbanken parser converts months and years, sorts and rejects malformed rows", () => {
  const parsed = parseHandelsbankenRates(fakeBankListRates(), fakeBankAverageRates(Date.parse("2026-10-25T12:00:00Z")));
  assert.deepEqual(
    parsed.listRates.map((r) => [r.bindingMonths, r.ratePct]),
    [
      [3, 3.94],
      [12, 3.69],
      [36, 3.99],
      [60, 4.19],
    ],
  );
  assert.equal(parsed.listRates[0].effectivePct, 4.01);
  assert.deepEqual(
    parsed.averageRates.filter((r) => r.bindingMonths === 3).map((r) => r.month),
    ["2026-07", "2026-08", "2026-09"],
  );
  const row = (patch: Record<string, unknown>) => ({
    interestRates: [{ periodBasisType: "3", term: "3", rateValue: { valueRaw: 3 }, ...patch }],
  });
  for (const [list, averages] of [
    [{}, fakeBankAverageRates()],
    [row({ periodBasisType: "9" }), fakeBankAverageRates()],
    [row({ term: "x" }), fakeBankAverageRates()],
    [row({ rateValue: { valueRaw: "3" } }), fakeBankAverageRates()],
    [{ interestRates: [...row({}).interestRates, ...row({}).interestRates] }, fakeBankAverageRates()],
    [row({}), {}],
    [row({}), { averageRatePeriods: [{ period: "2026-01", rates: [] }] }],
  ])
    assert.throws(() => parseHandelsbankenRates(list, averages));
  assert.deepEqual(parseHandelsbankenRates(row({ effectiveRateValue: {} }), { averageRatePeriods: [] }).listRates, [
    { bindingMonths: 3, ratePct: 3 },
  ]);
});

test("bank rate clients validate banks, pick the nearest binding and fall back when the page fails", async () => {
  assert.equal(isMortgageBank("handelsbanken"), true);
  assert.equal(isMortgageBank("toString"), false);
  let now = Date.parse("2026-10-25T12:00:00Z");
  const fake = createFakeSources({ now: () => now }),
    store = memoryStore(),
    client = createBankRateClient({ ...quick, fetch: fake.fetch, store, now: () => now }),
    rates = await client.bankMortgageRates("handelsbanken");
  assert.equal(rates.name, "Handelsbanken");
  assert.equal(bankListRateFor(rates, 0)?.ratePct, 3.94);
  assert.equal(bankListRateFor(rates, 24)?.ratePct, 3.69);
  assert.equal(bankListRateFor(rates, 120)?.ratePct, 4.19);
  assert.equal(bankListRateFor({ ...rates, listRates: [{ bindingMonths: 12, ratePct: 3 }] }, 3)?.ratePct, 3);
  await assert.rejects(() => client.bankMortgageRates("nordea" as "handelsbanken"), RangeError);
  now += 7 * 3600000;
  const down = createBankRateClient({
    ...quick,
    store,
    now: () => now,
    fetch: fakeFetch(() => new Response("", { status: 503 })),
  });
  assert.equal((await down.bankMortgageRates("handelsbanken")).stale, true);
});

test("the shared economy client and the fakes include mortgage rates", async () => {
  const fake = createFakeSources(),
    client = createClient({ ...quick, fetch: fake.fetch });
  const rates = await client.economy.mortgageRates();
  assert.equal(rates.series.length, 10);
  assert.equal(rates.table, "TAB5783");
  assert.equal((fakeMortgageRates() as { size: number[] }).size.length, 6);
});
