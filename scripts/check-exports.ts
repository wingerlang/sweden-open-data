/**
 * Keeps the places a new source must be added to in sync (step 25 of implementation.md):
 *
 * - `package.json` and `jsr.json` export the same entry points, and every file they name exists;
 * - each npm entry point's compiled file matches its source file;
 * - every default endpoint belongs to a source that `/testing` knows, so it can be faked.
 *
 * `node scripts/check-exports.ts` – exit code 1 on any mismatch.
 *
 * @module
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_ENDPOINTS } from "../src/core/context.ts";
import { sourceOf } from "../src/testing.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Problems found in the export lists and endpoints of the project at `base`. */
export function checkExports(base: string = root): string[] {
  const problems: string[] = [];
  const pkg = JSON.parse(readFileSync(base + "package.json", "utf8")) as {
    exports: Record<string, { types: string; default: string }>;
  };
  const jsr = JSON.parse(readFileSync(base + "jsr.json", "utf8")) as { exports: Record<string, string> };
  const npmKeys = Object.keys(pkg.exports).sort();
  const jsrKeys = Object.keys(jsr.exports).sort();
  for (const key of npmKeys) if (!jsrKeys.includes(key)) problems.push(`jsr.json lacks the export "${key}"`);
  for (const key of jsrKeys) if (!npmKeys.includes(key)) problems.push(`package.json lacks the export "${key}"`);

  for (const [key, file] of Object.entries(jsr.exports)) {
    if (!existsSync(base + file)) problems.push(`jsr.json "${key}" points to a missing file ${file}`);
  }
  for (const [key, target] of Object.entries(pkg.exports)) {
    const source = jsr.exports[key];
    if (!source) continue;
    const compiled = source.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".js");
    if (target.default !== compiled) problems.push(`package.json "${key}" default should be ${compiled}`);
    const types = compiled.replace(/\.js$/, ".d.ts");
    if (target.types !== types && target.types !== source) {
      problems.push(`package.json "${key}" types should be ${types}`);
    }
  }

  for (const [name, url] of Object.entries(DEFAULT_ENDPOINTS)) {
    if (!sourceOf(url)) problems.push(`endpoint "${name}" (${url}) has no source in src/testing.ts sourceOf()`);
  }
  return problems;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const problems = checkExports();
  for (const p of problems) console.error(p);
  console.log(problems.length ? `${problems.length} problem(s)` : "exports: ok");
  process.exitCode = problems.length ? 1 : 0;
}
