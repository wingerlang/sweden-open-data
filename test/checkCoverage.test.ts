import { test } from "node:test";
import assert from "node:assert/strict";
import { belowLimits, parseLcov } from "../scripts/check-coverage.ts";

test("check-coverage: one row per file, and files below a limit are named", () => {
  const lcov = [
    "SF:/repo/src/a.ts",
    "FNF:4",
    "FNH:4",
    "LF:10",
    "LH:10",
    "BRF:10",
    "BRH:8",
    "end_of_record",
    "SF:/repo/src/b.ts",
    "LF:0",
    "LH:0",
    "end_of_record",
  ].join("\n");
  const rows = parseLcov(lcov, "/repo");
  assert.deepEqual(rows, [
    { file: "src/a.ts", lines: 100, branches: 80, functions: 100 },
    { file: "src/b.ts", lines: 100, branches: 100, functions: 100 },
  ]);
  assert.deepEqual(belowLimits(rows), ["src/a.ts: branches 80.00 % (limit 90 %)"]);
});
