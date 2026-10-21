/**
 * Checks the npm archive the way a user meets it (step 28 of implementation.md): builds and packs the package,
 * installs it into an empty project with a plain strict TypeScript configuration, and type-checks and runs an import
 * of the main and the sub-path entry points. `node scripts/check-package.ts`
 *
 * @module
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "sod-package-"));
const run = (command: string, args: string[], cwd: string): string =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

try {
  run("npm", ["run", "build"], root);
  run("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], root);
  const archive = readdirSync(dir).find((name) => name.endsWith(".tgz"));
  if (!archive) throw new Error("npm pack produced no archive");
  const target = join(dir, "node_modules", "@wingerlang", "sweden-open-data");
  mkdirSync(target, { recursive: true });
  run("tar", ["-xzf", join(dir, archive), "-C", target, "--strip-components=1"], dir);
  mkdirSync(join(dir, "node_modules", "@types"), { recursive: true });
  symlinkSync(join(root, "node_modules", "@types", "node"), join(dir, "node_modules", "@types", "node"), "junction");
  symlinkSync(join(root, "node_modules", "undici-types"), join(dir, "node_modules", "undici-types"), "junction");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", type: "module", private: true }));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ["node"],
      },
      include: ["index.ts"],
    }),
  );
  writeFileSync(
    join(dir, "index.ts"),
    [
      'import { createClient, formatOre, type SpotDay } from "@wingerlang/sweden-open-data";',
      'import { fileStore } from "@wingerlang/sweden-open-data/node";',
      'import { createFakeSources } from "@wingerlang/sweden-open-data/testing";',
      'const se = createClient({ fetch: createFakeSources().fetch, store: fileStore("./cache") });',
      'const day: SpotDay | null = await se.spot.day("SE3", "2026-01-01");',
      "console.log(formatOre(day?.points[0]?.sek ?? 0));",
    ].join("\n"),
  );
  run(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "."], dir);
  writeFileSync(
    join(dir, "run.mjs"),
    'const m = await import("@wingerlang/sweden-open-data"); const n = await import("@wingerlang/sweden-open-data/node");\n' +
      'if (typeof m.createClient !== "function" || typeof n.fileStore !== "function") throw new Error("exports missing");\n',
  );
  run(process.execPath, ["run.mjs"], dir);
  console.log("package: ok (built, packed, type-checked and imported by a plain TypeScript project)");
} catch (error) {
  const e = error as { stdout?: string; stderr?: string; message: string };
  console.error(e.stdout || "", e.stderr || "", e.message);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
