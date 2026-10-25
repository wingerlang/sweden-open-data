import test from "node:test";
import assert from "node:assert/strict";
import {
  createMarketClient,
  createMarketReadCache,
  movingAverage,
  marketAnalytics,
  parseNasdaqIndex,
  parseIndexCsv,
  companyMarketEvents,
  combineQuotes,
  mergeQuoteHistory,
  rebuildCharts,
  type LiveMarketQuote,
} from "../src/market/mod.ts";
import { memoryStore } from "../src/core/cache.ts";
import { fakeFetch } from "./helpers.ts";
const now = Date.parse("2026-10-25T12:00:00Z"),
  start = now - 260 * 86400000;
function chart(symbol = "TEST.ST", base = 100) {
  return {
    chart: {
      result: [
        {
          meta: { symbol, currency: "SEK", regularMarketTime: (now - 86400000) / 1000, regularMarketPrice: base + 259 },
          timestamp: Array.from({ length: 260 }, (_, i) => (start + i * 86400000) / 1000),
          indicators: {
            quote: [{ close: Array.from({ length: 260 }, (_, i) => base + i) }],
            adjclose: [{ adjclose: Array.from({ length: 260 }, (_, i) => base + i) }],
          },
          events: {
            dividends: { one: { date: (now - 86400000) / 1000, amount: 5 } },
            splits: { bad: { date: now / 1000, numerator: 1, denominator: 0 } },
          },
        },
      ],
    },
  };
}
test("quotes are single-flight, durable and carry public corporate actions and cached period analytics", async () => {
  const fetch = fakeFetch(() => chart()),
    store = memoryStore(),
    options = { fetch, store, now: () => now, retries: 0 };
  const client = createMarketClient(options),
    [a, b] = await Promise.all([client.quote("TEST.ST", "max"), client.quote("test.st", "max")]);
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(a, b);
  assert.equal(a.liveCharts.MAX.length, 260);
  assert.equal(a.analytics?.ma200, 259.5);
  assert.equal(a.analytics?.periods.MAX.totalReturn, 2.59);
  assert.equal(a.events?.filter((e) => e.type === "dividend").length, 1);
  assert.equal(a.corporateSplits?.length, 0);
  const restored = await createMarketClient({
    ...options,
    fetch: fakeFetch(() => {
      throw Error("offline");
    }),
  }).quote("TEST.ST", "max");
  assert.equal(restored.stale, false);
  assert.equal(restored.liveCharts.MAX.length, 260);
});

test("quick quotes retain verified actions, reports and full-history analytics", async () => {
  const client = createMarketClient({ fetch: fakeFetch(() => chart()), now: () => now, retries: 0 }),
    payload = await client.quote("TEST.ST", "max");
  const split = { date: start / 1000, numerator: 2, denominator: 1 },
    cached = {
      ...payload,
      charts: payload.liveCharts,
      corporateSplits: [split],
      events: [
        ...payload.events!,
        { date: "2026-10-20", type: "report" as const, label: "Rapport", url: "https://mfn.se/a/test/report" },
      ],
    };
  const fresh = {
    ...cached,
    latestPrice: 400,
    events: [],
    corporateSplits: [],
    analytics: undefined,
    charts: rebuildCharts([], now),
  };
  const combined = combineQuotes(cached, fresh);
  assert.deepEqual(
    combined.events,
    cached.events.slice().sort((a, b) => a.date.localeCompare(b.date)),
  );
  assert.deepEqual(combined.corporateSplits, [split]);
  assert.equal(combined.analytics, cached.analytics);
  assert.equal(combined.latestPrice, 400);
  assert.equal(combined.charts.MAX.length, 260);
  const splitUpdate = combineQuotes(
    { ...cached, sharesOutstanding: 100, marketCapMethod: "shares-times-price", marketCapValue: 10000 },
    {
      ...fresh,
      sharesOutstanding: null,
      marketCapValue: null,
      marketCapMethod: undefined,
      dividendPerShare: null,
      dividendYieldPct: null,
      corporateSplits: [split, { date: now / 1000, numerator: 2, denominator: 1 }],
    },
  );
  assert.equal(splitUpdate.analytics, undefined);
  assert.equal(splitUpdate.sharesOutstanding, null);
  assert.equal(splitUpdate.marketCapValue, null);
  assert.equal(splitUpdate.dividendPerShare, null);
  assert.ok(splitUpdate.events?.some((e) => e.type === "report"));
});

test("full history uses a recent tail but periodically rebuilds older source corrections", async () => {
  let time = now;
  const fetch = fakeFetch(() => chart()),
    client = createMarketClient({ fetch, now: () => time, retries: 0, store: memoryStore() });
  const initial = await client.quote("TEST.ST", "max");
  time += 11 * 60000;
  const incremental = await client.quote("TEST.ST", "max", { fresh: true });
  assert.equal(fetch.calls[1].searchParams.get("range"), "1y");
  assert.equal(incremental.historyRebuiltAt, initial.historyRebuiltAt);
  time += 31 * 86400000;
  const rebuilt = await client.quote("TEST.ST", "max", { fresh: true });
  assert.equal(fetch.calls[2].searchParams.get("period1"), "0");
  assert.ok(Date.parse(rebuilt.historyRebuiltAt!) > Date.parse(initial.historyRebuiltAt!));
});
test("an expired snapshot paints before a deferred background refresh and failures back off", async () => {
  let time = now,
    calls = 0,
    finish!: (v: { n: number; fetchedAt: string }) => void;
  const cache = createMarketReadCache<{ n: number; fetchedAt: string }>({
    now: () => time,
    valid: (v: any): v is { n: number; fetchedAt: string } => Number.isFinite(v?.n),
  });
  await cache("quote:TEST", 10, 10000, async () => ({ n: 1, fetchedAt: new Date(time).toISOString() }));
  time += 11;
  const stale = await cache("quote:TEST", 10, 10000, () => {
    calls++;
    return new Promise((resolve) => (finish = resolve));
  });
  assert.equal(stale.value.n, 1);
  assert.equal(stale.stale, true);
  assert.equal(calls, 1);
  const second = await cache("quote:TEST", 10, 10000, async () => {
    throw Error("duplicate");
  });
  assert.equal(second.value.n, 1);
  finish({ n: 2, fetchedAt: new Date(time).toISOString() });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    (
      await cache("quote:TEST", 10, 10000, async () => {
        throw Error("unexpected");
      })
    ).value.n,
    2,
  );
});
test("MA uses complete windows; total returns stay missing without adjusted closes; drawdown is observed", () => {
  const points = [100, 80, 90, 120].map((price, i) => ({ date: "2026-10-" + String(20 + i), price }));
  assert.deepEqual(
    movingAverage(points, 3).map((p) => p.value),
    [null, null, 90, 290 / 3],
  );
  assert.throws(() => movingAverage(points, 0));
  const stats = marketAnalytics(points, "2026-10-25");
  assert.equal(stats.ma50, null);
  assert.equal(stats.periods.MAX.totalReturn, null);
  assert.ok(Math.abs(stats.periods.MAX.maxDrawdown! + 0.2) < 1e-12);
  assert.ok(stats.periods.MAX.volatility! > 0);
});
test("indices are isolated; FRED missing values are not zero; bad symbols cannot become another index", async () => {
  const fetch = fakeFetch((url, init) => {
    if (url.hostname.includes("nasdaq")) {
      const id = new URLSearchParams(String(init?.body)).get("id");
      return [
        { FPSymbol: id, x: now - 86400000, y: 100 },
        { FPSymbol: id, x: now, y: 105 },
      ];
    }
    throw Error("unexpected");
  });
  const client = createMarketClient({ fetch, now: () => now, retries: 0 });
  await Promise.all([client.index("benchmark-omxspi"), client.index("benchmark-omxs30gi")]);
  assert.equal(fetch.calls.length, 2);
  assert.throws(() => parseNasdaqIndex([{ FPSymbol: "WRONG", x: now, y: 5 }], "OMXS30", "2026-10-25"));
  assert.deepEqual(
    parseIndexCsv("DATE,VALUE\n2026-10-20,100\n2026-10-21,.\n2026-10-22,110").map((p) => p.price),
    [100, 110],
  );
  await assert.rejects(() => client.quote("../../private", "max"));
  await assert.rejects(() => client.index("https://untrusted.test"));
});
test("report markers retain source links and do not invent report dates from unrelated news", () => {
  const events = companyMarketEvents(undefined, [
    { title: "Delårsrapport januari–september", date: "2026-10-20", url: "https://mfn.se/a/test/report" },
    { title: "Inbjudan till presentation av delårsrapport", date: "2026-10-19", url: "https://mfn.se/a/test/invite" },
    { title: "Ny produkt", date: "2026-10-22", url: "https://mfn.se/a/test/product" },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].date, "2026-10-20");
  assert.equal(events[0].url, "https://mfn.se/a/test/report");
});

test("incremental dividend adjustments rescale the retained past and never mutate the original", () => {
  const old = [10, 20, 30].map((price, i) => ({ date: "2026-10-" + (20 + i), price, adjustedClose: price })),
    tail = [20, 30, 40].map((price, i) => ({ date: "2026-10-" + (21 + i), price, adjustedClose: price / 2 }));
  const quote = (points: typeof old) =>
    ({
      symbol: "TEST.ST",
      currency: "SEK",
      corporateSplits: [],
      charts: rebuildCharts(points, now),
    }) as unknown as LiveMarketQuote;
  const merged = mergeQuoteHistory(quote(old), quote(tail), now)!;
  assert.equal(merged.charts.MAX[0].adjustedClose, 5);
  assert.equal(old[0].adjustedClose, 10);
  assert.equal(merged.charts.MAX.length, 4);
});

test("bad restored symbol is rejected and explicit refresh awaits new source data", async () => {
  const store = memoryStore(),
    fetch = fakeFetch(() => chart("TEST.ST", 100 + fetch.calls.length));
  await store.set(
    "market:v1:quote:TEST.ST:max:full",
    JSON.stringify({
      schema: 1,
      at: now,
      value: {
        symbol: "WRONG.ST",
        fetchedAt: new Date(now).toISOString(),
        latestPrice: 10,
        liveCharts: { MAX: [] },
        currency: "SEK",
      },
    }),
  );
  const client = createMarketClient({ store, fetch, now: () => now, retries: 0 });
  const first = await client.quote("TEST.ST", "max");
  assert.equal(first.symbol, "TEST.ST");
  assert.equal(fetch.calls.length, 1);
  const fresh = await client.quote("TEST.ST", "max", { fresh: true });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fresh.stale, false);
  assert.ok(fresh.latestPrice > first.latestPrice);
});
