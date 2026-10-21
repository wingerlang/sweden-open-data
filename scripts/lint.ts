/**
 * Project lint rules that a formatter cannot enforce. No dependencies: `node scripts/lint.ts`.
 *
 * Each rule names the step in implementation.md that introduced it. Exit code 1 when any rule fails.
 *
 * @module
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CODE_DIRS = ["src", "test", "live", "dev", "examples", "scripts"];
const MAX_LINE = 120;

/** Every `.ts` file under `dir`, recursively. */
function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

interface Problem {
  file: string;
  line: number;
  rule: string;
  message: string;
}

/**
 * A line that may be long: a comment, a line holding a URL, or one that is only long because of a single string
 * (a test name, a message) – the formatter cannot break those.
 */
const mayBeLong = (text: string): boolean => {
  const t = text.trim();
  if (/^(\/\/|\/\*|\*)/.test(t) || /https?:\/\//.test(t)) return true;
  const longest = Math.max(
    0,
    ...(text.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g) ?? []).map((m) => m.length),
  );
  return text.length - longest <= MAX_LINE;
};

export function lint(base: string = root): Problem[] {
  const problems: Problem[] = [];
  for (const dir of CODE_DIRS) {
    let list: string[];
    try {
      list = files(join(base, dir));
    } catch {
      continue;
    }
    for (const path of list) {
      const file = relative(base, path).replaceAll("\\", "/");
      const source = readFileSync(path, "utf8");
      const lines = source.split("\n");
      if (file.startsWith("src/")) {
        // Step 13: every module starts with its documentation, before any import.
        if (!/^\/\*\*[\s\S]*?@module[\s\S]*?\*\//.test(source)) {
          problems.push({
            file,
            line: 1,
            rule: "module-doc",
            message: "start the file with a /** … @module */ comment",
          });
        }
        // Step 14: shared helpers live in core/parse.ts and core/time.ts, so data is judged the same way everywhere.
        if (!["src/core/parse.ts", "src/core/time.ts"].includes(file)) {
          lines.forEach((text, i) => {
            const copy = /normalize\("NFK?D"\)/.test(text)
              ? "fold() from core/parse.ts"
              : /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(text)
                ? "isoDay() / isCalendarDate()"
                : !file.startsWith("src/core/") &&
                    /code: "invalid-response"/.test(text) &&
                    !/url:/.test(text + (lines[i + 1] ?? ""))
                  ? "invalidResponse() from core/parse.ts"
                  : undefined;
            if (copy) problems.push({ file, line: i + 1, rule: "shared-helper", message: `use ${copy}` });
          });
        }
        // Step 16: API addresses live in DEFAULT_ENDPOINTS (core/context.ts), so they can be overridden and faked.
        if (file !== "src/core/context.ts") {
          lines.forEach((text, i) => {
            if (/new URL\(\s*["'`]https?:/.test(text)) {
              problems.push({ file, line: i + 1, rule: "endpoint", message: "use ctx.endpoints / DEFAULT_ENDPOINTS" });
            }
          });
        }
        // Step 17: untrusted data is `unknown` and read through core/parse.ts, never `any`.
        lines.forEach((text, i) => {
          if (!/^\s*(\*|\/\/)/.test(text) && /(?::|<|\bas)\s*any\b|\bany\[\]|deno-lint-ignore/.test(text)) {
            problems.push({
              file,
              line: i + 1,
              rule: "no-any",
              message: "use unknown and the helpers in core/parse.ts",
            });
          }
        });
        // Step 13: everything exported is documented.
        lines.forEach((text, i) => {
          const exported = /^export (?:async )?(?:function|const|interface|type|class) (\w+)/.exec(text);
          if (exported && !/\*\/\s*$/.test(lines[i - 1] ?? "")) {
            problems.push({ file, line: i + 1, rule: "export-doc", message: `document ${exported[1]} with /** … */` });
          }
        });
      }
      lines.forEach((text, i) => {
        // Step 11–12: readable lines. The formatter keeps code within 120 characters; this catches the rest.
        if (text.length > MAX_LINE && !mayBeLong(text)) {
          problems.push({
            file,
            line: i + 1,
            rule: "max-line",
            message: `${text.length} characters (max ${MAX_LINE})`,
          });
        }
      });
    }
  }
  return problems;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const problems = lint();
  for (const p of problems) console.error(`${p.file}:${p.line}  ${p.rule}  ${p.message}`);
  console.log(problems.length ? `${problems.length} problem(s)` : "lint: ok");
  process.exitCode = problems.length ? 1 : 0;
}
