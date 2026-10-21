import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../src/core/errors.ts";
import { createHttp, type RequestEvent } from "../src/core/http.ts";
import { createMemoryCache, memoryStore } from "../src/core/cache.ts";
import { createContext, DEFAULT_ENDPOINTS, DEFAULT_TTL, storeGet, storeSet } from "../src/core/context.ts";
import {
  addDays,
  hoursInDay,
  isCalendarDate,
  stockholmClock,
  stockholmDateTime,
  stockholmMidnight,
  swedishDate,
} from "../src/core/time.ts";
import { assertCoordinates, distanceKm, fold, inPolygon, isCoordinates, roundCoordinates } from "../src/core/geo.ts";
import { fakeFetch, square } from "./helpers.ts";

test("SourceError: transient for timeouts, network, 429 and 5xx only", () => {
  const e = (code: SourceError["code"], status?: number): SourceError =>
    new SourceError("x", { code, source: "s", status });
  assert.equal(e("timeout").transient, true);
  assert.equal(e("network").transient, true);
  assert.equal(e("rate-limited", 429).transient, true);
  assert.equal(e("http", 503).transient, true);
  assert.equal(e("http", 400).transient, false);
  assert.equal(e("http").transient, false);
  assert.equal(e("invalid-response").transient, false);
  assert.equal(e("aborted").transient, false);
  const withCause = new SourceError("y", { code: "network", source: "s", url: "https://x", cause: new Error("dns") });
  assert.equal((withCause.cause as Error).message, "dns");
  assert.equal(withCause.name, "SourceError");
  assert.equal(withCause.url, "https://x");
  assert.ok(withCause instanceof Error);
});

test("http: JSON, headers, 404 as undefined, and an event per attempt", async () => {
  const events: RequestEvent[] = [];
  let headers: Headers | undefined;
  const fetch = fakeFetch((url, init) => {
    headers = new Headers(init?.headers);
    return url.pathname === "/missing" ? new Response("no", { status: 404 }) : { ok: 1 };
  });
  const http = createHttp({ fetch, userAgent: "test/1.0", onRequest: (e) => events.push(e) });
  assert.deepEqual(await http.json("src", "https://x.test/data"), { ok: 1 });
  assert.equal(headers?.get("user-agent"), "test/1.0");
  assert.equal(headers?.get("accept"), "application/json");
  assert.equal(await http.json("src", new URL("https://x.test/missing"), { allowNotFound: true }), undefined);
  await assert.rejects(
    http.json("src", "https://x.test/missing"),
    (e: SourceError) => e.code === "http" && e.status === 404 && !e.transient,
  );
  assert.deepEqual(
    events.map((e) => [e.source, e.status, e.attempt, !!e.error]),
    [
      ["src", 200, 1, false],
      ["src", 404, 1, false],
      ["src", 404, 1, true],
    ],
  );
  assert.ok(events.every((e) => e.ms >= 0 && e.url.startsWith("https://x.test/")));
});

test("http: retries transient failures with backoff, never permanent ones", async () => {
  let n = 0;
  const flaky = fakeFetch(() => (++n < 3 ? new Response("busy", { status: 503 }) : { n }));
  assert.deepEqual(await createHttp({ fetch: flaky, retries: 2, retryDelayMs: 1 }).json("s", "https://x.test"), {
    n: 3,
  });
  assert.equal(flaky.calls.length, 3);

  const limited = fakeFetch(() => new Response("slow down", { status: 429 }));
  await assert.rejects(
    createHttp({ fetch: limited, retries: 1, retryDelayMs: 0 }).json("s", "https://x.test"),
    (e: SourceError) => e.code === "rate-limited",
  );
  assert.equal(limited.calls.length, 2);

  const bad = fakeFetch(() => new Response("bad", { status: 400 }));
  await assert.rejects(
    createHttp({ fetch: bad, retries: 3 }).json("s", "https://x.test"),
    (e: SourceError) => e.status === 400,
  );
  assert.equal(bad.calls.length, 1, "400 is not retried");

  const down = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    createHttp({ fetch: down, retries: 0 }).json("s", "https://x.test"),
    (e: SourceError) => e.code === "network" && e.transient,
  );
});

test("http: invalid JSON, timeouts and cancellation", async () => {
  const html = fakeFetch(() => new Response("<html>", { status: 200 }));
  await assert.rejects(
    createHttp({ fetch: html }).json("s", "https://x.test"),
    (e: SourceError) => e.code === "invalid-response",
  );

  const hang = fakeFetch(
    (_, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
  );
  await assert.rejects(
    createHttp({ fetch: hang, timeoutMs: 20, retries: 0 }).json("s", "https://x.test"),
    (e: SourceError) => e.code === "timeout",
  );

  const controller = new AbortController();
  const pending = createHttp({ fetch: hang, timeoutMs: 5000 }).json("s", "https://x.test", {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, (e: SourceError) => e.code === "aborted" && !e.transient);

  // Cancelling while waiting to retry stops the retry.
  const failing = fakeFetch(() => new Response("", { status: 500 }));
  const c2 = new AbortController();
  const retrying = createHttp({ fetch: failing, retries: 3, retryDelayMs: 1000 }).json("s", "https://x.test", {
    signal: c2.signal,
  });
  setTimeout(() => c2.abort(), 10);
  await assert.rejects(retrying, (e: SourceError) => e.code === "aborted");
  assert.equal(failing.calls.length, 1);

  const already = AbortSignal.abort();
  await assert.rejects(
    createHttp({ fetch: failing, retries: 1, retryDelayMs: 0 }).json("s", "https://x.test", { signal: already }),
    (e: SourceError) => e.code === "aborted",
  );
});

test("http: works without AbortSignal.any", async () => {
  const original = AbortSignal.any;
  // deno-lint-ignore no-explicit-any
  (AbortSignal as any).any = undefined;
  try {
    const fetch = fakeFetch(() => ({ ok: true }));
    const controller = new AbortController();
    assert.deepEqual(await createHttp({ fetch }).json("s", "https://x.test", { signal: controller.signal }), {
      ok: true,
    });
    await assert.rejects(
      createHttp({ fetch }).json("s", "https://x.test", { signal: AbortSignal.abort() }),
      (e: SourceError) => e.code === "aborted",
    );
    // A fetch that, like the real one, rejects when its (combined) signal aborts.
    const slow: typeof globalThis.fetch = (_input, init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ ok: true })), 200);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      });
    const later = new AbortController();
    const pending = createHttp({ fetch: slow }).json("s", "https://x.test", { signal: later.signal });
    setTimeout(() => later.abort(), 10);
    await assert.rejects(pending, (e: SourceError) => e.code === "aborted");
  } finally {
    AbortSignal.any = original;
  }
});

test("memory cache: single flight, TTL, per-value TTL, failures not cached, LRU", async () => {
  let t = 0;
  let loads = 0;
  const cache = createMemoryCache({ maxEntries: 2, now: () => t });
  const load = async (): Promise<number> => ++loads;
  const [a, b] = await Promise.all([cache.get("k", 100, load), cache.get("k", 100, load)]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  t = 99;
  assert.equal(await cache.get("k", 100, load), 1);
  t = 100;
  assert.equal(await cache.get("k", 100, load), 2, "expired");

  await assert.rejects(cache.get("bad", 100, () => Promise.reject(new Error("x"))));
  assert.equal(await cache.get("bad", 100, async () => "ok"), "ok", "a failure is retried");

  assert.equal(
    await cache.get(
      "short",
      (v: string) => (v === "miss" ? 0 : 100),
      async () => "miss",
    ),
    "miss",
  );
  assert.equal(await cache.get("short", 100, async () => "hit"), "hit", "TTL 0 is not kept");

  await cache.get("x", 100, async () => 1);
  await cache.get("y", 100, async () => 2);
  assert.equal(cache.size, 2);
  let reloaded = false;
  await cache.get("bad", 100, async () => {
    reloaded = true;
    return "again";
  });
  assert.ok(reloaded, "least recently used entry was evicted");
  cache.clear();
  assert.equal(cache.size, 0);
  assert.throws(() => createMemoryCache({ maxEntries: 0 }), RangeError);
});

test("memory cache: disabled still shares concurrent loads", async () => {
  let loads = 0;
  const cache = createMemoryCache({ enabled: false });
  const load = async (): Promise<number> => ++loads;
  await Promise.all([cache.get("k", 1000, load), cache.get("k", 1000, load)]);
  await cache.get("k", 1000, load);
  assert.equal(loads, 2);
});

test("context: defaults, overrides, validation, reuse and resilient stores", async () => {
  const ctx = createContext({
    endpoints: { weather: "https://mirror.test" },
    cache: { ttl: { weather: 5 } },
    locale: "en",
  });
  assert.equal(ctx.endpoints.weather, "https://mirror.test");
  assert.equal(ctx.endpoints.spot, DEFAULT_ENDPOINTS.spot);
  assert.equal(ctx.ttl.weather, 5);
  assert.equal(ctx.ttl.spotDay, DEFAULT_TTL.spotDay);
  assert.equal(ctx.locale, "en");
  assert.equal(createContext().locale, "sv");
  assert.equal(createContext(ctx), ctx, "an existing context is reused as is");
  assert.throws(() => createContext({ coordinatePrecision: 9 }), RangeError);
  assert.throws(() => createContext({ coordinatePrecision: 1.5 }), RangeError);

  const store = memoryStore();
  await storeSet(store, "a", { x: 1 });
  assert.deepEqual(await storeGet(store, "a"), { x: 1 });
  assert.equal(store.size, 1);
  assert.equal(await storeGet(store, "missing"), undefined);
  assert.equal(await storeGet(undefined, "a"), undefined);
  await storeSet(undefined, "a", 1);
  const broken = {
    get: (): never => {
      throw new Error("disk");
    },
    set: (): never => {
      throw new Error("disk");
    },
  };
  assert.equal(await storeGet(broken, "a"), undefined);
  await storeSet(broken, "a", 1);
  assert.equal(await storeGet({ get: () => "{not json", set: () => {} }, "a"), undefined);
});

test("time: Swedish dates regardless of the runtime's time zone, including DST days", () => {
  assert.equal(swedishDate(Date.parse("2026-10-12T22:30:00Z")), "2026-10-13");
  assert.equal(swedishDate(Date.parse("2026-01-12T22:30:00Z")), "2026-01-12");
  assert.equal(swedishDate("2026-12-31T23:30:00Z", 1), "2027-01-02");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.ok(isCalendarDate("2026-02-28"));
  assert.ok(!isCalendarDate("2026-02-30"));
  assert.ok(!isCalendarDate("2026-2-3"));
  assert.ok(!isCalendarDate(20260101));
  assert.throws(() => addDays("idag", 1), RangeError);
  assert.equal(new Date(stockholmMidnight("2026-01-15")).toISOString(), "2026-01-14T23:00:00.000Z");
  assert.equal(new Date(stockholmMidnight("2026-07-15")).toISOString(), "2026-07-14T22:00:00.000Z");
  assert.equal(hoursInDay("2026-03-29"), 23);
  assert.equal(hoursInDay("2026-10-25"), 25);
  assert.equal(hoursInDay("2026-10-12"), 24);
  assert.equal(stockholmClock("2026-10-12T12:05:00Z"), "14:05");
  assert.equal(stockholmDateTime(Date.parse("2026-10-12T12:05:09Z")), "2026-10-12T14:05:09");
});

test("geo: validation, rounding, distance, polygons with holes and folding", () => {
  assert.ok(isCoordinates({ latitude: 59.3, longitude: 18 }));
  for (const bad of [
    null,
    1,
    {},
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: NaN, longitude: 0 },
    { latitude: "59", longitude: 18 },
  ]) {
    assert.ok(!isCoordinates(bad), JSON.stringify(bad));
  }
  assert.throws(() => assertCoordinates({ latitude: 100, longitude: 0 }, "home"), /home must be/);
  assert.deepEqual(roundCoordinates({ latitude: 59.32938, longitude: 18.06861 }), {
    latitude: 59.33,
    longitude: 18.07,
  });
  assert.deepEqual(roundCoordinates({ latitude: 59.32938, longitude: 18.06861 }, 0), { latitude: 59, longitude: 18 });
  const km = distanceKm({ latitude: 59.3293, longitude: 18.0686 }, { latitude: 57.7089, longitude: 11.9746 });
  assert.ok(km > 390 && km < 400, `Stockholm–Göteborg ${km}`);
  const withHole = [...square(14, 56, 1), ...square(14, 56, 0.2)];
  assert.ok(inPolygon({ latitude: 56.5, longitude: 14 }, withHole));
  assert.ok(!inPolygon({ latitude: 56, longitude: 14 }, withHole), "inside the hole");
  assert.ok(!inPolygon({ latitude: 58, longitude: 14 }, withHole));
  assert.ok(!inPolygon({ latitude: 56, longitude: 14 }, []));
  assert.equal(fold("Åraslöv ÉÄ"), "araslov ea");
});
