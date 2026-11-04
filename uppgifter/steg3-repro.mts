import assert from "node:assert/strict";
import { combineQuotes, createMarketClient } from "../src/market/mod.ts";
import { fakeFetch } from "../test/helpers.ts";
const now = Date.parse("2026-10-25T12:00:00Z"), start = now - 260 * 86400000;
const log = (msg: string, data: object = {}) => console.log(new Date(now).toISOString(), msg, JSON.stringify(data));
const chart = (price: number, splits = {}) => ({ chart: { result: [{
  meta: { symbol: "TEST.ST", currency: "SEK", regularMarketTime: (now - 86400000) / 1000, regularMarketPrice: price },
  timestamp: Array.from({ length: 260 }, (_, i) => (start + i * 86400000) / 1000),
  indicators: { quote: [{ close: Array.from({ length: 260 }, () => price) }], adjclose: [{ adjclose: Array.from({ length: 260 }, () => price) }] },
  events: { splits } }] } });
const hooks = { onRequest: (e: any) => log("INFO  request", { source: e.source, status: e.status, ms: e.ms, attempt: e.attempt }),
  onCacheEvent: (e: any) => log("DEBUG cache", e) };
const before = await createMarketClient({ fetch: fakeFetch(() => chart(100)), now: () => now, retries: 0, ...hooks }).quote("TEST.ST", "max");
const cached = { ...before, charts: before.liveCharts, dividendPerShare: 10, dividendYieldPct: 10 };
log("INFO  cached quote", { price: cached.latestPrice, dividendPerShare: cached.dividendPerShare, ma200: cached.analytics?.ma200, splits: cached.corporateSplits?.length ?? 0 });
const after = await createMarketClient({ fetch: fakeFetch(() => chart(50, { s: { date: (now - 2 * 86400000) / 1000, numerator: 2, denominator: 1 } })), now: () => now, retries: 0, ...hooks }).quote("TEST.ST", "max");
const fresh = { ...after, charts: after.liveCharts, dividendPerShare: null, dividendYieldPct: null, analytics: undefined };
log("INFO  fresh quote", { price: fresh.latestPrice, dividendPerShare: fresh.dividendPerShare, maxPoints: fresh.charts.MAX.length, splits: fresh.corporateSplits });
const combined = combineQuotes(cached, fresh);
log("INFO  combined quote", { price: combined.latestPrice, dividendPerShare: combined.dividendPerShare, ma200: combined.analytics?.ma200, dividendYieldPct: combined.dividendYieldPct });
const implied = (combined.dividendPerShare ?? 0) / combined.latestPrice * 100;
if (combined.dividendPerShare != null) log("WARN  unit mismatch", { impliedYieldPct: implied, reportedYieldPct: combined.dividendYieldPct });
assert.equal(combined.dividendPerShare, null, `pre-split dividend leaked: ${combined.dividendPerShare} kr at price ${combined.latestPrice}`);
