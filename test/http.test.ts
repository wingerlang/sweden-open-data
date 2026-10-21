import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttp } from "../src/core/http.ts";
import { SourceError } from "../src/core/errors.ts";
import { createFreeVehicleClient } from "../src/vehicles/free.ts";

/** A response of `bytes` bytes, sent in 64 kB chunks like a real network answer. */
function sized(bytes: number, head = '{"a":"', tail = '"}'): Response {
  const filler = bytes - head.length - tail.length;
  let sent = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === 0) controller.enqueue(encoder.encode(head));
      const n = Math.min(65_536, filler - sent);
      if (n > 0) {
        controller.enqueue(new Uint8Array(n).fill(120));
        sent += n;
      }
      if (sent >= filler) {
        controller.enqueue(encoder.encode(tail));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/json" } });
}

test("http: answers larger than maxResponseBytes are refused, smaller ones read in full", async () => {
  const http = createHttp({
    retries: 0,
    fetch: async (input) => sized(Number(new URL(String(input)).searchParams.get("bytes"))),
  });
  const small = (await http.json("s", "https://x.test/?bytes=1000000")) as { a: string };
  assert.equal(small.a.length, 1_000_000 - 8);
  await assert.rejects(
    http.json("s", "https://x.test/?bytes=6000000"),
    (e: SourceError) =>
      e instanceof SourceError && e.code === "invalid-response" && /more than 5000000 bytes/.test(e.message),
  );
  const strict = createHttp({ retries: 0, maxResponseBytes: 100, fetch: async () => sized(101) });
  await assert.rejects(strict.json("s", "https://x.test/"), (e: SourceError) => e.code === "invalid-response");
  assert.throws(() => createHttp({ maxResponseBytes: 0 }), RangeError);
});

test("http: text() reads text with the same rules, asks for HTML and can refuse redirects", async () => {
  let init: RequestInit | undefined;
  const http = createHttp({
    retries: 0,
    fetch: async (_input, i) => {
      init = i;
      return new Response("<p>hej</p>", { headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(await http.text("s", "https://x.test/", { redirect: "error" }), "<p>hej</p>");
  assert.equal(init?.redirect, "error");
  assert.match(new Headers(init?.headers).get("accept") ?? "", /text\/html/);
  const empty = createHttp({ retries: 0, fetch: async () => new Response(null, { status: 200 }) });
  assert.equal(await empty.text("s", "https://x.test/"), "");
  const missing = createHttp({ retries: 0, fetch: async () => new Response("no", { status: 404 }) });
  assert.equal(await missing.text("s", "https://x.test/", { allowNotFound: true }), undefined);
});

test("free vehicle lookup: pages over 2 MB are refused without exposing the registration", async () => {
  const client = createFreeVehicleClient({ retries: 0, fetch: async () => sized(2_100_000, "<p>", "</p>") });
  await assert.rejects(
    client.lookup("ABC123"),
    (e: SourceError) =>
      e.code === "invalid-response" && !String(e.url).includes("ABC123") && !e.message.includes("ABC123"),
  );
});
