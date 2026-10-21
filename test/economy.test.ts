import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  adjustForInflation,
  annualAverage,
  averageAnnualInflation,
  cpiAt,
  createEconomyClient,
  deflate,
  inflationRate,
  inflationRates,
  latestCpi,
  parseScbMonthly,
  realChange,
  scbDataUrl,
  spliceSeries,
  toMonth,
  type CpiSeries,
} from "../src/economy/mod.ts";
import { createClient, memoryStore, SourceError } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";
import { fakeFetch, quick } from "./helpers.ts";

/** Shaped like SCB's answer for TAB6792 (real values from 2026-10-14), shortened. */
const scb = (content: string, months: Record<string, number | null>, extra: Record<string, unknown> = {}) => ({
  version: "2.0",
  class: "dataset",
  id: ["ContentsCode", "Tid"],
  size: [1, Object.keys(months).length],
  updated: "2026-10-14T06:00:00Z",
  dimension: {
    ContentsCode: { label: "tabellinnehåll", category: { index: { [content]: 0 }, label: { [content]: "KPI" } } },
    Tid: { label: "månad", category: { index: Object.fromEntries(Object.keys(months).map((k, i) => [k, i])) } },
  },
  value: Object.values(months),
  ...extra,
});

const series = (points: Record<string, number>): CpiSeries => ({
  index: "KPI",
  label: "KPI",
  base: "2020=100",
  fetchedAt: "2026-10-20T00:00:00Z",
  source: "test",
  sourceUrl: "",
  tables: [],
  points: Object.entries(points).map(([month, value]) => ({ month, value })),
});

test("SCB:s JSON-stat läses per månad, tomma månader hoppas över och fel format avvisas", () => {
  const r = parseScbMonthly(
    scb("000007T9", { "1980M01": 28.37, "2000M06": 77.76, "2025M12": 124.42, "2026M01": null }),
    "000007T9",
  );
  assert.deepEqual(r.points, [
    { month: "1980-01", value: 28.37 },
    { month: "2000-06", value: 77.76 },
    { month: "2025-12", value: 124.42 },
  ]);
  assert.equal(r.updated, "2026-10-14T06:00:00Z");
  // Another content code in the same answer is picked by position.
  const two = {
    ...scb("A", { "2026M01": 1 }),
    size: [2, 1],
    value: [1, 2],
    dimension: {
      ContentsCode: { category: { index: { A: 0, B: 1 } } },
      Tid: { category: { index: { "2026M01": 0 } } },
    },
  };
  assert.deepEqual(parseScbMonthly(two, "B").points, [{ month: "2026-01", value: 2 }]);
  const listed = {
    ...scb("A", { "2026M02": 2 }),
    dimension: { ContentsCode: { category: { index: ["A"] } }, Tid: { category: { index: ["2026M02"] } } },
  };
  assert.deepEqual(parseScbMonthly(listed, "A").points, [{ month: "2026-02", value: 2 }], "index som lista");
  assert.throws(
    () => parseScbMonthly({ ...scb("A", { "2026M01": 1 }), dimension: {} }, "A"),
    /lacks the dimension Tid/,
  );
  assert.throws(() => parseScbMonthly({}, "x"), SourceError);
  assert.throws(() => parseScbMonthly(scb("A", { "2026M01": 1 }), "B"), /lacks B/);
  assert.throws(() => parseScbMonthly(scb("A", { "2026M13": 1 }), "A"), /month/);
  assert.throws(() => parseScbMonthly(scb("A", { "2026M01": -1 }), "A"), /value/);
  assert.throws(() => parseScbMonthly({ ...scb("A", { "2026M01": 1 }), value: [1, 2] }, "A"), /size/);
});

test("delarna fogas ihop vid basbytet: den senare tabellen gäller från sin första månad", () => {
  const old = [
    { month: "2025-11", value: 124 },
    { month: "2025-12", value: 124.42 },
    { month: "2026-01", value: 999 },
  ];
  const fresh = [
    { month: "2026-01", value: 124.58 },
    { month: "2026-02", value: 125 },
  ];
  assert.deepEqual(
    spliceSeries([old, fresh, []]).map((p) => p.value),
    [124, 124.42, 124.58, 125],
  );
});

test("månader: datum och tidsstämplar blir YYYY-MM, och månader räknas över årsskiften", () => {
  assert.equal(toMonth("2026-09-14"), "2026-09");
  assert.equal(toMonth("2026-09-14T10:00:00Z"), "2026-09");
  assert.throws(() => toMonth("2026-13"), RangeError);
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2025-12", 13), "2027-01");
});

test("pengars värde, inflationstakt och genomsnitt räknas ur indexet", () => {
  const kpi = series({ "2000-01": 80, "2000-02": 81, "2001-01": 82, "2026-08": 124.85, "2026-09": 125.94 });
  const a = adjustForInflation(kpi, 10_000, "2000-01");
  assert.equal(a.to, "2026-09");
  assert.ok(Math.abs(a.amount - 15_742.5) < 1e-6);
  assert.ok(Math.abs(a.change - 0.574_25) < 1e-9);
  assert.equal(adjustForInflation(kpi, 100, "2026-09-30", "2000-01-01").amount, (100 * 80) / 125.94);
  assert.throws(() => adjustForInflation(kpi, 1, "1999-01"), /no value for 1999-01 \(2000-01–2026-09\)/);
  assert.throws(() => adjustForInflation(kpi, Number.NaN, "2000-01"), RangeError);
  assert.equal(inflationRate(kpi, "2001-01"), 82 / 80 - 1);
  assert.equal(inflationRate(kpi, "2000-02", 1), 81 / 80 - 1);
  assert.equal(inflationRate(kpi, "2026-09"), null, "inget värde ett år tidigare");
  assert.deepEqual(
    inflationRates(kpi).map((p) => p.month),
    ["2001-01"],
  );
  assert.ok(Math.abs(averageAnnualInflation(kpi, "2000-01", "2001-01") - 0.025) < 1e-12);
  assert.throws(() => averageAnnualInflation(kpi, "2001-01", "2000-01"), RangeError);
  assert.equal(cpiAt(kpi, "2000-02-15"), 81);
  assert.equal(latestCpi(kpi)?.month, "2026-09");
});

test("årsmedel kräver alla tolv månader", () => {
  const full = series(
    Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2020-${String(i + 1).padStart(2, "0")}`, 94 + i])),
  );
  assert.equal(annualAverage(full, 2020), 99.5);
  assert.equal(annualAverage(full, 2021), null);
});

test("lön mot inflation: nominell, real förändring och vad som behövs för samma köpkraft", () => {
  const kpi = series({ "2018-01": 100, "2026-09": 125 });
  const r = realChange(kpi, { amount: 32_000, month: "2018-01" }, { amount: 41_000, month: "2026-09" });
  assert.equal(r.inflation, 0.25);
  assert.equal(r.earlierInLaterPrices, 40_000);
  assert.ok(Math.abs(r.nominal - 0.281_25) < 1e-12);
  assert.ok(Math.abs(r.real - 0.025) < 1e-12);
  assert.throws(() => realChange(kpi, { amount: 0, month: "2018-01" }, { amount: 1, month: "2026-09" }), RangeError);
  assert.deepEqual(
    deflate(kpi, [
      { amount: 100, month: "2018-01-31" },
      { amount: 1, month: "2010-01" },
    ]),
    [{ amount: 125, month: "2018-01" }],
  );
});

test("klienten hämtar båda KPI-tabellerna, fogar ihop, cachar och sparar i lagret", async () => {
  const fetch = fakeFetch((url) => {
    const table = url.pathname.split("/").at(-2);
    assert.equal(url.searchParams.get("outputFormat"), "json-stat2");
    assert.equal(url.searchParams.get("valueCodes[Tid]"), "*");
    return table === "TAB6792"
      ? scb("000007T9", { "2025M11": 124.1, "2025M12": 124.42, "2026M01": null })
      : scb("00000808", { "2025M12": null, "2026M01": 124.58 }, { updated: "2026-10-15T06:00:00Z" });
  });
  const store = memoryStore();
  let now = Date.parse("2026-10-20T08:00:00Z");
  const economy = createEconomyClient({ fetch, store, now: () => now, ...quick });
  const kpi = await economy.cpi();
  assert.deepEqual(
    kpi.points.map((p) => [p.month, p.value]),
    [
      ["2025-11", 124.1],
      ["2025-12", 124.42],
      ["2026-01", 124.58],
    ],
  );
  assert.deepEqual(kpi.tables, ["TAB6792", "TAB6596"]);
  assert.equal(kpi.updated, "2026-10-15T06:00:00Z");
  assert.equal(kpi.stale, undefined);
  await economy.cpi("KPI");
  assert.equal(fetch.calls.length, 2, "cachad i minnet");
  assert.equal(store.size, 1);

  // A restarted server reads the fresh copy from the store.
  const restarted = createEconomyClient({ fetch, store, now: () => now, ...quick });
  assert.equal((await restarted.cpi()).points.length, 3);
  assert.equal(fetch.calls.length, 2);

  // When the copy is old and SCB is down, the old copy is served and marked.
  now += 7 * 3_600_000;
  const down = createEconomyClient({
    fetch: fakeFetch(() => new Response("", { status: 503 })),
    store,
    now: () => now,
    ...quick,
  });
  const stale = await down.cpi();
  assert.equal(stale.stale, true);
  assert.equal(stale.points.length, 3);
  await assert.rejects(
    createEconomyClient({ fetch: fakeFetch(() => new Response("", { status: 503 })), ...quick }).cpi(),
    SourceError,
  );
  await assert.rejects(economy.cpi("KPI2" as never), RangeError);
});

test("SCB-adressen har hakparenteser som SCB förväntar sig", () => {
  assert.equal(
    scbDataUrl("https://x/api/v2/", "TAB1", "C"),
    "https://x/api/v2/tables/TAB1/data?lang=sv&outputFormat=json-stat2&valueCodes[ContentsCode]=C&valueCodes[Tid]=*",
  );
});

test("hela klienten och testkällorna har KPI, KPIF och KPIF-XE", async () => {
  const now = Date.parse("2026-10-20T08:00:00Z");
  const se = createClient({ fetch: createFakeSources({ now: () => now }).fetch, now: () => now, ...quick });
  const kpi = await se.economy.cpi("KPI");
  assert.equal(kpi.points[0].month, "1980-01");
  assert.equal(latestCpi(kpi)?.month, "2026-09");
  assert.ok(
    kpi.points.some((p) => p.month === "2025-12") && kpi.points.some((p) => p.month === "2026-01"),
    "båda delarna",
  );
  assert.ok(Math.abs((annualAverage(kpi, 2020) ?? 0) - 100) < 0.1);
  for (const index of ["KPIF", "KPIF-XE"] as const)
    assert.equal((await se.economy.cpi(index)).points[0].month, "1987-01");
});
