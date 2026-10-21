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
