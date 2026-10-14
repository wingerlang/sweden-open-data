import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, createMemoryCache, parseRetryAfter, SourceError } from "../src/mod.ts";
import { createFakeSources, fakeSpotDay, sourceOf, SOURCE_IDS, withFaults } from "../src/testing.ts";
import { parseElprisResponse, isCompleteSpotDay } from "../src/spot/mod.ts";
import { fakeFetch, KRIS_NEWS, quick, SMHI_WARNINGS } from "./helpers.ts";

const NOON = Date.parse("2026-10-14T12:00:00+02:00");

test("stale-if-error: the last good value is served while a source is down, then refreshed", async () => {
  let t = 0;
  let fail = false;
  let loads = 0;
  const events: string[] = [];
  const cache = createMemoryCache({ now: () => t, staleIfErrorMs: 1000, onEvent: (e) => events.push(e.type) });
  const load = async (): Promise<number> => {
    loads++;
    if (fail) throw new Error("down");
    return loads;
  };
  assert.equal(await cache.get("k", 100, load), 1);
  t = 150;
  fail = true;
  assert.equal(await cache.get("k", 100, load), 1, "expired, source down: stale value");
  assert.equal(await cache.get("k", 100, load), 1, "the failing source is not asked again for a minute");
  assert.equal(loads, 2);
  t = 2000;
  await assert.rejects(cache.get("k", 100, load), /down/, "beyond the stale window the error surfaces");
  fail = false;
  assert.equal(await cache.get("k", 100, load), 4);
  assert.deepEqual(events, ["miss", "miss", "stale", "hit", "miss", "miss"]);
  const plain = createMemoryCache({ now: () => t });
  await plain.get("x", 10, async () => 1);
  t += 20;
  await assert.rejects(plain.get("x", 10, () => Promise.reject(new Error("no stale by default"))));
});

test("stale-if-error through the client, with fetchedAt showing the age", async () => {
  let t = NOON;
  const fake = createFakeSources({ now: () => t });
  const se = createClient({ fetch: fake.fetch, now: () => t, ...quick, cache: { staleIfErrorMs: 3_600_000 } });
  const first = await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
  t += 25 * 60_000;
  fake.setFault("open-meteo", { offline: true });
  const second = await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
  assert.equal(second.fetchedAt, first.fetchedAt);
  assert.equal(se.stats().cache.stale, 1);
  assert.equal(se.stats().sources["open-meteo"].failures, 1);
});

test("Retry-After: honoured when short, not waited for when long", async () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter(new Date(Date.now() + 5000).toUTCString(), Date.now()) !== undefined, true);
  assert.equal(parseRetryAfter("soon"), undefined);
  assert.equal(parseRetryAfter(null), undefined);
  let n = 0;
  const shortWait = fakeFetch(() => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "0" } }) : { ok: 1 }));
  const se = createClient({ fetch: shortWait, retries: 1, retryDelayMs: 0 });
  const started = Date.now();
  await se.weather.forecast({ latitude: 1, longitude: 1 }).catch(() => {});
  assert.ok(Date.now() - started < 1000);
  assert.equal(shortWait.calls.length, 2);
  const longWait = fakeFetch(() => new Response("", { status: 503, headers: { "retry-after": "120" } }));
  const se2 = createClient({ fetch: longWait, retries: 3, retryDelayMs: 0 });
  await assert.rejects(se2.weather.forecast({ latitude: 1, longitude: 1 }), (e: SourceError) => e.retryAfterMs === 120_000 && e.status === 503);
  assert.equal(longWait.calls.length, 1, "a long Retry-After is reported, not slept through");
});

test("stats: per-source counters, retries and reset", async () => {
  let n = 0;
  const fetch = fakeFetch(() => (++n === 1 ? new Response("", { status: 500 }) : []));
  const se = createClient({ fetch, retries: 1, retryDelayMs: 0, now: () => NOON });
  await se.spot.day("SE3", "2026-10-14");
  await se.spot.day("SE3", "2026-10-14");
  const s = se.stats();
  assert.equal(s.requests, 2);
  assert.equal(s.failures, 1);
  assert.equal(s.sources.elprisetjustnu.retries, 1);
  assert.equal(s.sources.elprisetjustnu.lastStatus, 200);
  assert.match(s.sources.elprisetjustnu.lastError ?? "", /HTTP 500/);
  assert.deepEqual(s.cache, { hits: 1, misses: 1, stale: 0 });
  se.resetStats();
  assert.equal(se.stats().requests, 0);
  assert.deepEqual(se.stats().sources, {});
});

test("alerts: filter by kind and severity, and choose feeds", async () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  const fetch = fakeFetch((url) => (url.pathname.endsWith("warning.json") ? SMHI_WARNINGS : url.pathname.endsWith("/news") ? KRIS_NEWS : []));
  const se = createClient({ fetch, now: () => now, ...quick });
  const vinslov = { latitude: 56.1, longitude: 13.91, county: "Skåne län", municipality: "Hässleholms kommun" };
  const all = await se.alerts.near([vinslov]);
  assert.ok(all.alerts.some((a) => a.kind === "news"));
  const warnings = await se.alerts.near([vinslov], { kinds: ["warning"] });
  assert.deepEqual(warnings.alerts.map((a) => a.kind), ["warning"]);
  assert.equal((await se.alerts.near([vinslov], { minLevel: "orange" })).alerts.some((a) => a.level === "yellow"), false);
  assert.ok((await se.alerts.near([vinslov], { minLevel: "yellow" })).alerts.some((a) => a.level === "yellow"));
  const before = fetch.calls.length;
  const onlySmhi = await se.alerts.near([vinslov], { feeds: ["smhi"] });
  assert.deepEqual(onlySmhi.sources.map((s) => s.id), ["smhi"]);
  assert.equal(fetch.calls.length, before, "feeds are cached per feed");
  await assert.rejects(se.alerts.feed({ feeds: [] }), RangeError);
  await assert.rejects(se.alerts.feed({ feeds: ["twitter" as "smhi"] }), RangeError);
});

test("geo: limits", async () => {
  const fake = createFakeSources();
  const se = createClient({ fetch: fake.fetch, ...quick });
  assert.equal((await se.geo.addresses("Åraslöv 1105, 28890 Vinslöv", { limit: 1 })).length, 1);
  assert.equal((await se.geo.addresses("Åraslöv 1105, 28890 Vinslöv")).length, 3, "the cache keeps the full list");
  assert.equal((await se.geo.places("St", { limit: 1 })).length <= 1, true);
  await assert.rejects(se.geo.places("Stockholm", { limit: 0 }), RangeError);
  await assert.rejects(se.geo.addresses("Stockholm", { limit: 21 }), RangeError);
});

test("spot overview: now, today and tomorrow in one call", async () => {
  let t = Date.parse("2026-10-14T10:00:00+02:00");
  const fake = createFakeSources({ now: () => t });
  const se = createClient({ fetch: fake.fetch, now: () => t, ...quick });
  let o = await se.spot.overview("SE4", { windowHours: 2 });
  assert.ok(o.current && Date.parse(o.current.start) <= t);
  assert.equal(o.today?.current, o.current);
  assert.equal(o.tomorrow, null, "not published before 13:00");
  assert.equal(Date.parse(o.today!.cheapest!.end) - Date.parse(o.today!.cheapest!.start), 2 * 3_600_000);
  t = Date.parse("2026-10-14T14:00:00+02:00");
  se.clearCache();
  o = await se.spot.overview("SE4");
  assert.ok(o.tomorrow && o.tomorrow.current === null && o.tomorrow.cheapest);
  assert.ok(o.tomorrow.cheapest.start.startsWith("2026-10-15"));
  const down = createClient({ fetch: fakeFetch(() => new Response("", { status: 404 })), ...quick });
  assert.deepEqual({ ...(await down.spot.overview("SE1")), fetchedAt: "" }, { area: "SE1", current: null, today: null, tomorrow: null, fetchedAt: "" });
});

test("testing: fake sources are realistic, deterministic and cover DST days", async () => {
  assert.deepEqual(fakeSpotDay("SE3", "2026-10-14"), fakeSpotDay("SE3", "2026-10-14"));
  assert.notDeepEqual(fakeSpotDay("SE3", "2026-10-14"), fakeSpotDay("SE4", "2026-10-14"));
  for (const [date, n] of [["2026-10-25", 100], ["2026-03-29", 92], ["2026-10-14", 96]] as const) {
    const points = parseElprisResponse(fakeSpotDay("SE3", date));
    assert.equal(points.length, n, date);
    assert.ok(isCompleteSpotDay(points, date), date);
  }
  const se4 = parseElprisResponse(fakeSpotDay("SE4", "2026-10-14"));
  const se1 = parseElprisResponse(fakeSpotDay("SE1", "2026-10-14"));
  assert.ok(se4.reduce((a, p) => a + p.sek, 0) > se1.reduce((a, p) => a + p.sek, 0), "the south is dearer");

  const fake = createFakeSources({ now: () => NOON });
  const se = createClient({ fetch: fake.fetch, now: () => NOON, ...quick });
  const w = await se.weather.forecast({ latitude: 67.86, longitude: 20.23 });
  assert.equal(w.current.time, new Date(Math.floor(NOON / 60_000) * 60_000).toISOString());
  assert.equal(w.days.length, 7);
  assert.deepEqual((await se.geo.region({ latitude: 0, longitude: 0 })).guessed, true, "far from the gazetteer");
  assert.equal((await se.geo.places("Göte"))[0].name, "Göteborg");
  assert.equal((await fake.fetch("https://example.com/x")).status, 404);
  assert.equal((await fake.fetch("https://www.elprisetjustnu.se/api/v1/prices/nonsense")).status, 404);
  assert.equal((await fake.fetch("https://www.elprisetjustnu.se/api/v1/prices/2027/01-01_SE3.json")).status, 404, "the future is not published");
  const feed = await se.alerts.feed();
  assert.equal(feed.alerts.length, 4);
  assert.ok(fake.calls.length > 0);
});

test("testing: faults – status, Retry-After, offline, invalid JSON, delay, hang, rate", async () => {
  assert.deepEqual(SOURCE_IDS.map((id) => id), ["elprisetjustnu", "open-meteo", "open-meteo-geocoding", "photon", "krisinformation", "smhi"]);
  assert.equal(sourceOf("https://api.open-meteo.com/v1/forecast"), "open-meteo");
  assert.equal(sourceOf("https://geocoding-api.open-meteo.com/v1/search"), "open-meteo-geocoding");
  assert.equal(sourceOf("https://photon.komoot.io/api/"), "photon");
  assert.equal(sourceOf("https://example.com"), undefined);

  const fake = createFakeSources({ now: () => NOON });
  const se = createClient({ fetch: fake.fetch, now: () => NOON, ...quick, timeoutMs: 50, cache: false });
  const here = { latitude: 59.33, longitude: 18.07 };
  fake.setFault("open-meteo", { status: 503, retryAfter: 1 });
  await assert.rejects(se.weather.forecast(here), (e: SourceError) => e.status === 503 && e.retryAfterMs === 1000);
  fake.setFault("open-meteo", { offline: true });
  await assert.rejects(se.weather.forecast(here), (e: SourceError) => e.code === "network");
  fake.setFault("open-meteo", { invalidJson: true });
  await assert.rejects(se.weather.forecast(here), (e: SourceError) => e.code === "invalid-response");
  fake.setFault("open-meteo", { hang: true });
  await assert.rejects(se.weather.forecast(here), (e: SourceError) => e.code === "timeout");
  fake.setFault("open-meteo", { delayMs: 200 });
  await assert.rejects(se.weather.forecast(here), (e: SourceError) => e.code === "timeout", "slower than the timeout");
  fake.setFault("open-meteo", { delayMs: 5 });
  assert.ok(await se.weather.forecast(here));
  assert.deepEqual(Object.keys(fake.faults()), ["open-meteo"]);
  fake.setFault("open-meteo", null);
  assert.deepEqual(fake.faults(), {});

  let r = 0.9;
  const flaky = withFaults(fakeFetch(() => ({ ok: true })), () => r);
  flaky.setFault("smhi", { status: 500, rate: 0.5 });
  assert.equal((await flaky.fetch("https://opendata-download-warnings.smhi.se/x")).status, 200, "above the rate: passes");
  r = 0.1;
  assert.equal((await flaky.fetch("https://opendata-download-warnings.smhi.se/x")).status, 500);
  assert.equal(flaky.calls.length, 2);
  flaky.reset();
  assert.equal(flaky.calls.length, 0);
  const controller = new AbortController();
  flaky.setFault("smhi", { delayMs: 10_000 });
  const pending = flaky.fetch("https://opendata-download-warnings.smhi.se/x", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending);
  await assert.rejects(flaky.fetch(new Request("https://opendata-download-warnings.smhi.se/x"), { signal: AbortSignal.abort() }));
});
