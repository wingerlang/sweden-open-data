/**
 * Coverage per file (step 26 of implementation.md). The overall average hid single files with low branch coverage, so
 * every file in `src/` must reach the limits on its own. Reads `coverage/lcov.info` from `npm run coverage`.
 *
 * `node scripts/check-coverage.ts [path/to/lcov.info]` – exit code 1 when a file is below a limit.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimum per file, in percent. */
export const LIMITS: Readonly<{ lines: number; branches: number; functions: number }> = Object.freeze({
  lines: 95,
  branches: 90,
  functions: 95,
});

/** Coverage of one file, in percent. */
export interface FileCoverage {
  file: string;
  lines: number;
  branches: number;
  functions: number;
}

/** Reads an lcov report into one row per source file. */
export function parseLcov(text: string, root: string = ""): FileCoverage[] {
  const rows: FileCoverage[] = [];
  let file = "";
  let counts: Record<string, number> = {};
  const pct = (hit: string, found: string): number =>
    counts[found] ? (100 * (counts[hit] ?? 0)) / counts[found] : 100;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      file = relative(root, line.slice(3)).replaceAll("\\", "/");
      counts = {};
    } else if (line === "end_of_record") {
      rows.push({ file, lines: pct("LH", "LF"), branches: pct("BRH", "BRF"), functions: pct("FNH", "FNF") });
    } else {
      const m = /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line);
      if (m) counts[m[1]] = Number(m[2]);
    }
  }
  return rows;
}

/** The files below a limit, as messages. */
export function belowLimits(rows: FileCoverage[]): string[] {
  return rows.flatMap((row) =>
    (["lines", "branches", "functions"] as const)
      .filter((kind) => row[kind] < LIMITS[kind])
      .map((kind) => `${row.file}: ${kind} ${row[kind].toFixed(2)} % (limit ${LIMITS[kind]} %)`),
  );
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const report = process.argv[2] ?? `${root}coverage/lcov.info`;
  const rows = parseLcov(readFileSync(report, "utf8"), root).filter((row) => row.file.startsWith("src/"));
  const problems = belowLimits(rows);
  for (const p of problems) console.error(p);
  console.log(problems.length ? `${problems.length} file limit(s) not met` : `coverage: ${rows.length} files ok`);
  process.exitCode = problems.length ? 1 : 0;
}
