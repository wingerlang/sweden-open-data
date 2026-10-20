/**
 * Contract tests against the real sources. They catch upstream format changes that the offline tests cannot.
 * Run with `npm run test:live` (needs network). CI runs them weekly and on demand – see .github/workflows/live.yml.
 * A source being temporarily down is reported as a skip, not a failure; a changed format fails.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { adjustForInflation, annualAverage, createClient, isCompleteSpotDay, latestCpi, SourceError, swedishDate } from "../src/mod.ts";

const se = createClient({
  userAgent: "sweden-open-data contract tests (https://github.com/wingerlang/sweden-open-data)",
  retries: 2,
  timeoutMs: 15_000,
});
const stockholm = { latitude: 59.33, longitude: 18.07 };

async function live<T>(t: TestContext, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SourceError && error.transient) {
      t.skip(`${error.source} is unavailable right now: ${error.message}`);
      return undefined;
    }
    throw error;
  }
}

test("elprisetjustnu: today is published, complete and plausible", async (t) => {
  const r = await live(t, () => se.spot.prices("SE3"));
  if (!r) return;
  assert.ok(r.today, "today's prices exist");
  assert.equal(r.today.date, swedishDate());
  assert.ok(isCompleteSpotDay(r.today.points, r.today.date), "covers the whole day");
  assert.ok([15, 60].includes(r.today.resolutionMinutes));
  assert.ok(r.today.points.every((p) => p.sek > -5 && p.sek < 50), "SEK/kWh in a plausible range");
});

test("Open-Meteo: current conditions, hours and days", async (t) => {
  const w = await live(t, () => se.weather.forecast(stockholm));
  if (!w) return;
  assert.ok(w.current.temperature > -50 && w.current.temperature < 50);
  assert.ok(w.hours.length >= 24 && w.days.length >= 6);
  assert.ok(w.days.every((d) => d.max >= d.min));
});

test("Krisinformation and SMHI: feeds parse", async (t) => {
  const feed = await live(t, () => se.alerts.feed());
  if (!feed) return;
  assert.deepEqual(feed.sources.map((s) => s.id), ["vma", "news", "smhi"]);
  assert.ok(feed.sources.some((s) => s.ok));
  for (const a of feed.alerts) {
    assert.ok(a.id && a.title && a.url.startsWith("https://"), a.id);
    assert.ok(Number.isFinite(Date.parse(a.published || a.start || "")), `${a.id} has a date`);
  }
});

test("Photon: an address, a rural address and a region", async (t) => {
  const exact = await live(t, () => se.geo.addresses("Drottninggatan 1, Stockholm"));
  if (!exact) return;
  assert.ok(exact.length > 0 && exact[0].countryCode === "SE");
  const rural = await live(t, () => se.geo.addresses("Åraslöv 1105, 28890 Vinslöv"));
  if (!rural) return;
  assert.ok(rural.length > 0);
  const region = await live(t, () => se.geo.region({ latitude: 56.1, longitude: 13.91 }));
  if (!region) return;
  assert.equal(region.county, "Skåne län");
});

test("Open-Meteo geocoding: a city", async (t) => {
  const places = await live(t, () => se.geo.places("Uppsala", { country: "SE" }));
  if (!places) return;
  assert.ok(places.some((p) => p.name === "Uppsala"));
});

test("SCB: KPI, KPIF och KPIF-XE är hela, sammanfogade och rimliga", async (t) => {
  const kpi = await live(t, () => se.economy.cpi("KPI"));
  if (!kpi) return;
  assert.equal(kpi.points[0].month, "1980-01");
  assert.ok(kpi.points.length >= 561, "varje månad från 1980");
  assert.ok(Math.abs((annualAverage(kpi, 2020) ?? 0) - 100) < 0.05, "2020 = 100");
  const latest = latestCpi(kpi)!;
  assert.ok(Date.now() - Date.parse(latest.month + "-01") < 75 * 86_400_000, "senaste månaden är högst två månader gammal");
  const gap = adjustForInflation(kpi, 1, "2025-12", "2026-01").change;
  assert.ok(Math.abs(gap) < 0.02, "ingen spricka vid basbytet");
  for (const index of ["KPIF", "KPIF-XE"] as const) {
    const s = await live(t, () => se.economy.cpi(index));
    if (s) assert.equal(s.points[0].month, "1987-01");
  }
});
