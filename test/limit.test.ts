import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttp } from "../src/core/http.ts";
import { SourceError } from "../src/core/errors.ts";
import { createLimiter, DEFAULT_LIMITS } from "../src/core/limit.ts";

const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("limits: never more requests in flight than the source's concurrency", async () => {
  let inFlight = 0;
  let most = 0;
  const http = createHttp({
    retries: 0,
    limits: { s: { concurrency: 2 } },
    fetch: async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await later(10);
      inFlight--;
      return Response.json({ ok: true });
    },
  });
  await Promise.all(Array.from({ length: 10 }, () => http.json("s", "https://x.test/")));
  assert.equal(most, 2);
  // Other sources are not limited by it.
  most = 0;
  await Promise.all(Array.from({ length: 5 }, () => http.json("other", "https://x.test/")));
  assert.equal(most, 5);
});

test("limits: Photon is limited to two at a time by default, and a waiting request can be cancelled", async () => {
  assert.equal(DEFAULT_LIMITS.photon.concurrency, 2);
  let calls = 0;
  const http = createHttp({
    retries: 0,
    fetch: async () => {
      calls++;
      await later(30);
      return Response.json([]);
    },
  });
  const cancel = new AbortController();
  const running = [http.json("photon", "https://p.test/"), http.json("photon", "https://p.test/")];
  const queued = http.json("photon", "https://p.test/", { signal: cancel.signal });
  await later(5);
  cancel.abort();
  await assert.rejects(queued, (e: SourceError) => e.code === "aborted");
  await Promise.all(running);
  assert.equal(calls, 2, "the cancelled request never reached the source");
});

test("limits: at most perMinute starts in any minute; later requests wait for the window", async () => {
  let now = 0;
  let wake: (() => void) | undefined;
  let waitMs = 0;
  const limiter = createLimiter(
    { s: { perMinute: 2 } },
    () => now,
    (run, ms) => {
      wake = run;
      waitMs = ms;
    },
  );
  const order: number[] = [];
  const take = (n: number): Promise<void> =>
    limiter.acquire("s").then((release) => {
      order.push(n);
      release();
    });
  await take(1);
  await take(2);
  const third = take(3);
  await later(5);
  assert.deepEqual(order, [1, 2], "the third waits");
  assert.equal(waitMs, 60_000, "it waits until the first start leaves the window");
  now = 60_001;
  wake?.();
  await third;
  assert.deepEqual(order, [1, 2, 3]);
});

test("limits: invalid values are rejected", () => {
  assert.throws(() => createLimiter({ s: { concurrency: 0 } }), RangeError);
  assert.throws(() => createLimiter({ s: { perMinute: 1.5 } }), RangeError);
  createLimiter({ s: { concurrency: Infinity } });
});
