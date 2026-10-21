import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkExports } from "../scripts/check-exports.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("check-exports: the project is consistent, and a missing jsr.json export is caught", async () => {
  assert.deepEqual(checkExports(), []);
  const dir = (await mkdtemp(join(tmpdir(), "sod-exports-"))) + "/";
  try {
    await symlink(join(root, "src"), join(dir, "src"), "junction");
    await writeFile(dir + "package.json", await readFile(root + "package.json", "utf8"));
    const jsr = JSON.parse(await readFile(root + "jsr.json", "utf8"));
    delete jsr.exports["./economy"];
    await writeFile(dir + "jsr.json", JSON.stringify(jsr));
    assert.deepEqual(checkExports(dir), ['jsr.json lacks the export "./economy"']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
