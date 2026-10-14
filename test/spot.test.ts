import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cheapestHours,
  cheapestWindow,
  createSpotClient,
  formatOre,
  guessSpotArea,
  hourlyAverages,
  isCompleteSpotDay,
  isSpotArea,
  normalizeSpotDay,
  parseElprisResponse,
  priceLevel,
  SPOT_AREAS,
  SPOT_SOURCE,
  type SpotPoint,
  spotWindow,
  summarizeSpotPrices,
  toSpotArea,
  toSpotDay,
  withVat,
} from "../src/spot/mod.ts";
import { memoryStore } from "../src/core/cache.ts";
import { SourceError } from "../src/core/errors.ts";
import { addDays, stockholmMidnight } from "../src/core/time.ts";
import { elprisDay, fakeFetch, hourlyDay, quick } from "./helpers.ts";

const at = (iso: string): number => Date.parse(iso);

test("areas: validation, normalisation and a rough guess from a position", () => {
  assert.deepEqual(SPOT_AREAS.map((a) => a.id), ["SE1", "SE2", "SE3", "SE4"]);
  assert.ok(isSpotArea("SE3") && !isSpotArea("se3") && !isSpotArea("SE5"));
  assert.equal(toSpotArea(" se4 "), "SE4");
  assert.throws(() => toSpotArea("SE9"), RangeError);
  assert.throws(() => toSpotArea(3), RangeError);
  const guess = (latitude: number, longitude: number): string => guessSpotArea({ latitude, longitude });
  assert.equal(guess(67.85, 20.2), "SE1");
  assert.equal(guess(62.4, 17.3), "SE2");
  assert.equal(guess(59.33, 18.06), "SE3");
  assert.equal(guess(57.7, 11.97), "SE3");
  assert.equal(guess(55.6, 13.0), "SE4");
  assert.equal(guess(56.9, 14.8), "SE4", "Växjö");
  assert.throws(() => guessSpotArea({ latitude: 100, longitude: 0 }), RangeError);
});

test("parsing: valid rows only, sorted; anything but a list is an error", () => {
  const points = parseElprisResponse([...elprisDay().reverse(), { SEK_per_kWh: "x" }, { SEK_per_kWh: null }, null, { SEK_per_kWh: 1, time_start: "nope", time_end: "x" }, { SEK_per_kWh: 1, EUR_per_kWh: "n/a", time_start: "2026-10-13T00:00:00+02:00", time_end: "2026-10-13T00:15:00+02:00" }]);
  assert.equal(points.length, 97);
  assert.ok(points.every((p, i) => i === 0 || Date.parse(p.start) >= Date.parse(points[i - 1].start)));
  assert.equal(points[96].eur, null);
  assert.throws(() => parseElprisResponse({ error: "x" }), (e: SourceError) => e.code === "invalid-response");
});

test("days: quarter and hourly resolution, completeness and the autumn DST quirk", () => {
  const quarter = toSpotDay("SE3", "2026-10-12", parseElprisResponse(elprisDay()));
  assert.equal(quarter.resolutionMinutes, 15);
  assert.ok(quarter.complete);
  assert.ok(!isCompleteSpotDay(quarter.points.slice(1), "2026-10-12"), "a gap");
  assert.ok(!isCompleteSpotDay(quarter.points, "not-a-date"));
  assert.ok(!isCompleteSpotDay([], "2026-10-12"));
  assert.ok(!isCompleteSpotDay([{ ...quarter.points[0], sek: NaN }, ...quarter.points.slice(1)], "2026-10-12"));

  // 25-hour day where the source gave the first 02:00 hour a two-hour end.
  const date = "2023-10-29";
  const from = stockholmMidnight(date);
  const raw = parseElprisResponse(hourlyDay(from, 25)) as SpotPoint[];
  raw[2] = { ...raw[2], end: new Date(Date.parse(raw[2].start) + 2 * 3_600_000).toISOString() };
  assert.ok(!isCompleteSpotDay(raw, date));
  const fixed = normalizeSpotDay(raw, date);
  assert.ok(isCompleteSpotDay(fixed, date));
  assert.equal(fixed[2].sourceEnd, raw[2].end);
  assert.equal(fixed.filter((p) => p.sourceEnd).length, 1, "only the broken interval changes");
  assert.deepEqual(normalizeSpotDay(raw.slice(0, 20), date), raw.slice(0, 20), "no complete grid: left alone");
  assert.deepEqual(normalizeSpotDay([], date), []);
  const spring = toSpotDay("SE4", "2026-03-29", parseElprisResponse(hourlyDay(stockholmMidnight("2026-03-29"), 23)));
  assert.ok(spring.complete);
  assert.equal(spring.resolutionMinutes, 60);
  assert.equal(toSpotDay("SE4", "2026-03-29", []).resolutionMinutes, 60);
});

test("analysis: hourly averages, summary, levels, windows and cheapest hours", () => {
  const points = parseElprisResponse(elprisDay());
  const hours = hourlyAverages(points);
  assert.equal(hours.length, 24);
  assert.ok(Math.abs(hours[0].sek - (points[0].sek + points[1].sek + points[2].sek + points[3].sek) / 4) < 1e-12);
  assert.equal(hourlyAverages([{ ...points[0], eur: null }, points[1]])[0].eur, null);

  const noon = at("2026-10-12T12:07:00+02:00");
  const s = summarizeSpotPrices(points, { now: noon })!;
  assert.ok(s.current && Date.parse(s.current.start) <= noon && noon < Date.parse(s.current.end));
  assert.equal(s.next?.start, points[points.indexOf(s.current!) + 1].start);
  assert.equal(s.level, "high", "midday is the most expensive in the fixture");
  assert.ok(s.min.sek < s.average && s.average < s.max.sek);
  assert.equal(s.cheapest?.start, "2026-10-12T21:00:00+02:00");
  const before = summarizeSpotPrices(points, { now: at("2026-10-11T12:00:00Z"), windowHours: 2 })!;
  assert.equal(before.current, null);
  assert.equal(before.level, null);
  assert.equal(before.next, points[0]);
  assert.equal(summarizeSpotPrices([]), null);

  assert.equal(Date.parse(cheapestWindow(points, 3)!.start), at("2026-10-12T00:00:00+02:00"));
  assert.equal(Date.parse(cheapestWindow(points, 3, { from: noon })!.start), at("2026-10-12T21:00:00+02:00"));
  assert.equal(cheapestWindow(points, 3, { from: at("2026-10-12T23:30:00+02:00") }), null);
  assert.throws(() => cheapestWindow(points, 0), RangeError);
  const gap = [...hours.slice(0, 2), ...hours.slice(3)];
  assert.notEqual(cheapestWindow(gap, 3)!.start, hours[0].start, "windows never span a gap");

  const cheap = cheapestHours(points, 4, { from: noon });
  assert.equal(cheap.length, 4);
  assert.ok(cheap.every((p, i) => i === 0 || Date.parse(p.start) > Date.parse(cheap[i - 1].start)), "chronological");
  assert.ok(cheap.every((p) => Date.parse(p.end) > noon));
  assert.equal(cheapestHours(points, 2).length, 2);
  assert.throws(() => cheapestHours(points, 1.5), RangeError);

  assert.equal(priceLevel(1, []), "normal");
  const flat = points.map((p) => ({ ...p, sek: 0.5 }));
  assert.equal(priceLevel(0.5, flat), "normal");
  assert.equal(priceLevel(s.min.sek, points), "low");
  assert.equal(priceLevel(s.average, points), "normal");
});

test("display windows: whole day, remaining, rolling 24 h", () => {
  const day = (d: string): SpotPoint[] =>
    Array.from({ length: 24 }, (_, h) => ({ start: `${d}T${String(h).padStart(2, "0")}:00:00+02:00`, end: `${d}T${String(h).padStart(2, "0")}:59:59+02:00`, sek: h / 10, eur: null }));
  const t = day("2026-10-12");
  const m = day("2026-10-13");
  const now = at("2026-10-12T15:20:00+02:00");
  assert.equal(spotWindow(t, m, "day", now), t);
  assert.equal(spotWindow(t, m, "remaining", now).length, 9);
  const rolling = spotWindow(t, m, "rolling", now);
  assert.equal(rolling.length, 24);
  assert.equal(rolling[0].start, t[15].start);
  assert.equal(rolling.at(-1)!.start, m[14].start);
  assert.equal(spotWindow(t, null, "rolling", now).length, 9);
  assert.ok(spotWindow(t, m, "remaining").length <= 24);
});

test("formatting: VAT and öre", () => {
  assert.equal(withVat(1), 1.25);
  assert.equal(withVat(1, 0.12), 1.12);
  assert.equal(formatOre(0.4567), "46 öre");
  assert.equal(formatOre(0.0456), "4,6 öre");
  assert.equal(formatOre(-0.05), "−5,0 öre");
});

test("client: today and tomorrow, caching, and a tomorrow that is published later", async () => {
  let t = at("2026-10-12T10:00:00+02:00");
  let published = false;
  const fetch = fakeFetch((url) => {
    if (url.pathname.includes("10-13_") && !published) return new Response("", { status: 404 });
    const [, m, d] = url.pathname.match(/(\d{2})-(\d{2})_/)!;
    return elprisDay(`2026-${m}-${d}`);
  });
  const spot = createSpotClient({ fetch, now: () => t, ...quick });
  let r = await spot.prices("se3");
  assert.equal(r.area, "SE3");
  assert.equal(r.today?.points.length, 96);
  assert.equal(r.today?.date, "2026-10-12");
  assert.equal(r.tomorrow, null);
  assert.equal(r.fetchedAt, new Date(t).toISOString());
  assert.equal(fetch.calls[0].pathname, "/api/v1/prices/2026/10-12_SE3.json");
  await spot.prices("SE3");
  assert.equal(fetch.calls.length, 2, "today cached; missing tomorrow not asked again within 15 minutes");
  published = true;
  t += 16 * 60_000;
  r = await spot.prices("SE3");
  assert.equal(r.tomorrow?.points.length, 96);
  await assert.rejects(spot.prices("SE9"), RangeError);
  await assert.rejects(spot.day("SE3", "2026-02-30"), RangeError);
  assert.equal(SPOT_SOURCE.url, "https://www.elprisetjustnu.se");
});

test("client: a failing tomorrow does not hide today; an empty day counts as unpublished", async () => {
  const fetch = fakeFetch((url) => (url.pathname.includes("10-13_") ? new Response("", { status: 500 }) : url.pathname.includes("10-14_") ? [] : elprisDay("2026-10-12")));
  const spot = createSpotClient({ fetch, now: () => at("2026-10-12T10:00:00+02:00"), ...quick });
  const r = await spot.prices("SE4");
  assert.ok(r.today);
  assert.equal(r.tomorrow, null);
  assert.equal(await spot.day("SE4", "2026-10-14"), null);
  await assert.rejects(spot.day("SE4", "2026-10-13"), (e: SourceError) => e.status === 500);
});

test("history: shared requests, persistent store for complete past days, missing days reported", async () => {
  const store = memoryStore();
  let calls = 0;
  const fetch = fakeFetch((url) => {
    calls++;
    const [y, m, d] = url.pathname.match(/(\d{4})\/(\d{2})-(\d{2})_/)!.slice(1);
    const date = `${y}-${m}-${d}`;
    if (date === "2026-01-02") return new Response("", { status: 404 });
    if (date === "2026-01-03") return hourlyDay(stockholmMidnight(date), 20);
    if (date === "2026-01-04") return new Response("", { status: 500 });
    const from = stockholmMidnight(date);
    return hourlyDay(from, (stockholmMidnight(addDays(date, 1)) - from) / 3_600_000);
  });
  const options = { fetch, store, now: () => at("2026-10-12T10:00:00Z"), ...quick };
  const spot = createSpotClient(options);
  const [a, b] = await Promise.all([spot.day("SE4", "2023-10-29"), spot.day("SE4", "2023-10-29")]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a?.points.length, 25);
  assert.ok(a?.complete);
  assert.equal(store.size, 1);
  await createSpotClient(options).day("SE4", "2023-10-29");
  assert.equal(calls, 1, "a new client reads the persistent store");

  const range = await spot.history("SE4", "2026-01-01", "2026-01-05", { concurrency: 3 });
  assert.deepEqual(range.days.map((d) => d.date), ["2026-01-01", "2026-01-05"]);
  assert.deepEqual(range.missing.map((m) => [m.date, m.reason]), [["2026-01-02", "not published"], ["2026-01-03", "incomplete"], ["2026-01-04", "elprisetjustnu answered HTTP 500"]]);
  assert.equal(store.size, 3, "only complete past days are stored");
  assert.ok(!JSON.stringify(range).includes("NaN"));
  await assert.rejects(spot.history("SE4", "2026-01-01", "2027-02-03"), RangeError);
  await assert.rejects(spot.history("SE4", "2026-01-01", "2026-01-31", { maxDays: 7 }), RangeError);
  await assert.rejects(spot.history("SE4", "2026-01-05", "2026-01-01"), RangeError);
  await assert.rejects(spot.history("SE4", "x", "2026-01-01"), RangeError);
  await assert.rejects(spot.history("XX", "2026-01-01", "2026-01-02"), RangeError);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createSpotClient({ ...options, cache: false }).history("SE3", "2025-01-01", "2025-01-02", { signal: controller.signal }));
});

test("history: a corrupt stored day is refetched", async () => {
  const store = memoryStore();
  await store.set("spot:SE1:2025-05-05", JSON.stringify([{ start: "x" }]));
  const fetch = fakeFetch(() => hourlyDay(stockholmMidnight("2025-05-05"), 24));
  const day = await createSpotClient({ fetch, store, ...quick }).day("SE1", "2025-05-05");
  assert.ok(day?.complete);
  assert.equal(fetch.calls.length, 1);
});
