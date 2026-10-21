import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryStore } from "../src/core/cache.ts";
import { createContext } from "../src/core/context.ts";
import { SourceError } from "../src/core/errors.ts";
import { cachedWithStore, redactError, redactedHooks } from "../src/core/source.ts";

interface Value {
  fetchedAt: string;
  stale?: boolean;
  n: number;
}
const isValue = (v: unknown): v is Value => !!v && typeof v === "object" && typeof (v as Value).n === "number";

test("cachedWithStore: store first while young, fresh results never stale, last good copy when the source fails", async () => {
  let now = Date.parse("2026-10-21T12:00:00Z");
  const store = memoryStore();
  const ctx = createContext({ store, now: () => now, cache: false });
  let loads = 0;
  let fail = false;
  const load = async (): Promise<Value> => {
    loads++;
    if (fail) throw new SourceError("down", { code: "http", status: 503, source: "s" });
    return { fetchedAt: new Date(now).toISOString(), n: loads };
  };
  const get = (): Promise<Value> => cachedWithStore(ctx, "k", 60_000, isValue, load, { source: "s" });
  assert.deepEqual(await get(), { fetchedAt: "2026-10-21T12:00:00.000Z", n: 1 });
  await store.set("k", JSON.stringify({ fetchedAt: new Date(now).toISOString(), n: 1, stale: true }));
  assert.equal((await get()).stale, undefined, "a young stored copy is fresh");
  assert.equal(loads, 1);
  now += 120_000;
  fail = true;
  assert.deepEqual(await get(), { fetchedAt: "2026-10-21T12:00:00.000Z", n: 1, stale: true });
  await store.set("k", "not json");
  await assert.rejects(get(), SourceError);
});

test("redaction: errors and hook events never carry the real URL or key", () => {
  const redaction = { source: "v", url: "https://x/[redacted]", message: "Lookup failed", cacheKey: "v:[redacted]" };
  const original = new SourceError("v answered HTTP 429 for ABC123", {
    code: "rate-limited",
    source: "v",
    status: 429,
    url: "https://x/ABC123",
    retryAfterMs: 1000,
    cause: new Error("ABC123"),
  });
  const clean = redactError(original, redaction);
  assert.equal(clean.message, "Lookup failed (rate-limited)");
  assert.equal(clean.url, "https://x/[redacted]");
  assert.equal(clean.retryAfterMs, 1000);
  assert.equal(clean.cause, undefined);
  const seen: unknown[] = [];
  const hooks = redactedHooks({ onRequest: (e) => seen.push(e), onCacheEvent: (e) => seen.push(e) }, redaction);
  hooks.onRequest({ source: "v", url: "https://x/ABC123", status: 429, ms: 1, attempt: 1, error: original });
  hooks.onCacheEvent({ type: "miss", key: "v:ABC123" });
  assert.doesNotMatch(JSON.stringify(seen), /ABC123/);
  redactedHooks({}, redaction).onCacheEvent({ type: "hit", key: "k" });
});
