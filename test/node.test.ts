import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore } from "../src/node.ts";
import { createSpotClient } from "../src/spot/mod.ts";
import { stockholmMidnight } from "../src/core/time.ts";
import { fakeFetch, hourlyDay, quick } from "./helpers.ts";

test("fileStore: one file per key, atomic writes, safe names, survives restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sod-"));
  try {
    const store = fileStore(dir);
    assert.equal(await store.get("spot:SE3:2026-01-01"), undefined);
    await store.set("spot:SE3:2026-01-01", "[1]");
    assert.equal(await fileStore(dir).get("spot:SE3:2026-01-01"), "[1]");
    assert.deepEqual(await readdir(join(dir, "spot", "SE3")), ["2026-01-01.json"], "no temporary files left");
    await store.set("../../etc:passwd", "x");
    assert.ok(
      (await readdir(dir)).every((name) => !name.startsWith("..")),
      "keys cannot escape the directory",
    );
    assert.equal(await store.get("../../etc:passwd"), "x");
    await store.set(":", "empty parts");
    assert.equal(await store.get(":"), "empty parts");

    await mkdir(join(dir, "dir.json"));
    await assert.rejects(Promise.resolve(store.get("dir")), "other errors than a missing file surface");

    let calls = 0;
    const fetch = fakeFetch(() => {
      calls++;
      return hourlyDay(stockholmMidnight("2024-06-01"), 24);
    });
    await createSpotClient({ fetch, store, ...quick }).day("SE2", "2024-06-01");
    await createSpotClient({ fetch, store: fileStore(dir), ...quick }).day("SE2", "2024-06-01");
    assert.equal(calls, 1, "the second process reads the file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fileStore: distinct files for similar keys, expiry, pruning, old temporary files and the old file format", async () => {
  const { utimes, writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "sod-"));
  try {
    let now = Date.parse("2026-10-21T12:00:00Z");
    const store = fileStore(dir, { now: () => now });
    await store.set("a/b", "slash");
    await store.set("a_b", "underscore");
    await store.set("a.b", "dot");
    assert.deepEqual(
      [await store.get("a/b"), await store.get("a_b"), await store.get("a.b")],
      ["slash", "underscore", "dot"],
    );

    await store.set("short", "x", { ttlMs: 1000 });
    await store.set("forever", "y");
    now += 1001;
    assert.equal(await store.get("short"), undefined, "expired");
    assert.equal(await store.get("forever"), "y");

    await store.set("later", "z", { ttlMs: 1000 });
    now += 1001;
    const stray = join(dir, "spot", "x.json.abc.tmp");
    await mkdir(join(dir, "spot"), { recursive: true });
    await writeFile(stray, "half");
    const old = new Date(now - 2 * 3_600_000);
    await utimes(stray, old, old);
    assert.equal(await store.prune(), 2, "the expired value and the old temporary file");
    assert.equal(await store.get("forever"), "y");

    // A file written by an older version holds the raw value.
    await mkdir(join(dir, "spot", "SE3"), { recursive: true });
    await writeFile(join(dir, "spot", "SE3", "2025-01-01.json"), "[1,2]");
    assert.equal(await store.get("spot:SE3:2025-01-01"), "[1,2]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memoryStore: values with ttlMs expire", async () => {
  const { memoryStore } = await import("../src/core/cache.ts");
  let now = 0;
  const store = memoryStore({ now: () => now });
  await store.set("k", "v", { ttlMs: 10 });
  await store.set("keep", "v");
  now = 11;
  assert.equal(await store.get("k"), undefined);
  assert.equal(await store.get("keep"), "v");
});

test("fileStore: values that are not JSON, other JSON, and pruning an empty or foreign directory", async () => {
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "sod-"));
  try {
    const store = fileStore(join(dir, "missing"));
    assert.equal(await store.prune(), 0, "a directory that does not exist yet");
    const real = fileStore(dir);
    await writeFile(join(dir, "plain.json"), "not json at all");
    await writeFile(join(dir, "other.json"), '{"a":1}');
    await writeFile(join(dir, "broken.json"), "{");
    assert.equal(await real.get("plain"), "not json at all");
    assert.equal(await real.get("other"), '{"a":1}');
    assert.equal(await real.prune(), 0, "files that are not ours are left alone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
