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
      const lines = readFileSync(path, "utf8").split("\n");
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
