import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryCache } from "../src/core/cache.ts";
import { SourceError } from "../src/core/errors.ts";
import { createClient } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";

const STOCKHOLM = { latitude: 59.33, longitude: 18.07 };
const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("cancellation: one caller cancelling does not cancel others waiting for the same data", async () => {
  const fake = createFakeSources();
  fake.setFault("open-meteo", { delayMs: 100 });
  const se = createClient({ fetch: fake.fetch, retries: 0 });
  const first = new AbortController();
  const a = se.weather.forecast(STOCKHOLM, { signal: first.signal });
  const b = se.weather.forecast(STOCKHOLM);
  setTimeout(() => first.abort(), 20);
  await assert.rejects(a, (e: SourceError) => e instanceof SourceError && e.code === "aborted");
  const forecast = await b;
  assert.equal(typeof forecast.current.temperature, "number");
  assert.equal(fake.calls.filter((u) => u.hostname === "api.open-meteo.com").length, 1);
});

test("cancellation: the shared load is aborted only when every waiting caller has cancelled", async () => {
  const cache = createMemoryCache();
  let loadSignal: AbortSignal | undefined;
  const load = (signal: AbortSignal): Promise<string> => {
    loadSignal = signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve("value"), 200);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  };
  const one = new AbortController();
  const two = new AbortController();
  const a = cache.get("k", 1000, load, { signal: one.signal, source: "test" });
  const b = cache.get("k", 1000, load, { signal: two.signal, source: "test" });
  one.abort();
  await assert.rejects(a, (e: SourceError) => e.code === "aborted" && e.source === "test");
  await later(5);
  assert.equal(loadSignal?.aborted, false, "the load keeps running for the second caller");
  two.abort();
  await assert.rejects(b, (e: SourceError) => e.code === "aborted");
  await later(5);
  assert.equal(loadSignal?.aborted, true, "nobody is waiting any more");
  assert.equal(cache.size, 0, "an aborted load is not cached");
});

test("cancellation: an already aborted signal never starts a load, and a caller without a signal keeps it alive", async () => {
  const cache = createMemoryCache();
  let loads = 0;
  const load = async (): Promise<number> => {
    loads++;
    await later(20);
    return 42;
  };
  await assert.rejects(
    cache.get("k", 1000, load, { signal: AbortSignal.abort() }),
    (e: SourceError) => e.code === "aborted",
  );
  assert.equal(loads, 0);
  const cancelled = new AbortController();
  const a = cache.get("k", 1000, load, { signal: cancelled.signal });
  const b = cache.get("k", 1000, load);
  cancelled.abort();
  await assert.rejects(a);
  assert.equal(await b, 42);
  assert.equal(await cache.get("k", 1000, load, { signal: new AbortController().signal }), 42, "cached value");
  assert.equal(loads, 1);
});

test("cancellation: a caller arriving after everyone else cancelled starts a fresh load", async () => {
  const cache = createMemoryCache();
  let loads = 0;
  const load = (signal: AbortSignal): Promise<number> => {
    const n = ++loads;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(n), 20);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        setTimeout(() => reject(signal.reason), 5); // the abandoned load fails a little later
      });
    });
  };
  const first = new AbortController();
  const a = cache.get("k", 1000, load, { signal: first.signal });
  first.abort();
  const b = cache.get("k", 1000, load);
  await assert.rejects(a);
  assert.equal(await b, 2, "the newcomer got its own load, not the abandoned one");
  assert.equal(await cache.get("k", 1000, load), 2, "and its result is cached");
});
