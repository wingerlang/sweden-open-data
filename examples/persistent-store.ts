/**
 * A durable store: complete past days of spot prices are kept on disk for good, so a restarted server never fetches
 * them again; values with a lifetime expire, and prune() cleans up. Uses a temporary folder.
 *
 *   node examples/persistent-store.ts           # fake sources
 *   node examples/persistent-store.ts --live
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "../src/mod.ts";
import { fileStore } from "../src/node.ts";
import { createFakeSources } from "../src/testing.ts";

const live = process.argv.includes("--live");
const dir = await mkdtemp(join(tmpdir(), "sweden-open-data-"));
const network = live ? { userAgent: "sweden-open-data example" } : { fetch: createFakeSources().fetch };
try {
  const first = createClient({ ...network, store: fileStore(dir) });
  await first.spot.history("SE3", "2026-01-01", "2026-01-31");
  console.log("first process: ", first.stats().requests, "requests");

  const restarted = createClient({ ...network, store: fileStore(dir) }); // a new process, an empty memory cache
  await restarted.spot.history("SE3", "2026-01-01", "2026-01-31");
  console.log("after restart: ", restarted.stats().requests, "requests – read from disk");

  let now = Date.now();
  const store = fileStore(dir, { now: () => now });
  await store.set("session:a", JSON.stringify({ user: "a" }), { ttlMs: 60_000 });
  await store.set("session:b", JSON.stringify({ user: "b" }), { ttlMs: 60_000 });
  now += 61_000; // a minute later
  console.log("expired value: ", await store.get("session:a"), "(an expired value is never returned)");
  console.log("prune removed: ", await store.prune(), "expired file(s); the spot days stay");
} finally {
  await rm(dir, { recursive: true, force: true });
}
