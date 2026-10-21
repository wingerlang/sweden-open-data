/**
 * Pins every GitHub Action in `.github/workflows` to the commit its tag points to today (step 29 of
 * implementation.md): `actions/checkout@v4` becomes `actions/checkout@<40-character SHA> # v4`. A tag can be moved to
 * other code later; a commit cannot. Dependabot then proposes updates. Needs `git` and access to github.com.
 *
 * `node scripts/pin-actions.ts` – rewrites the workflow files in place and lists what it pinned.
 *
 * @module
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.github/workflows", import.meta.url));
const USES = /uses:\s*([\w.-]+\/[\w.-]+)@([\w./-]+)(?!\s*#)/g;

/** The commit a tag (or branch) of a GitHub repository points to. Annotated tags are resolved to their commit. */
function commitOf(repository: string, ref: string): string {
  const out = execFileSync(
    "git",
    ["ls-remote", `https://github.com/${repository}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`, `refs/heads/${ref}`],
    { encoding: "utf8" },
  );
  const lines = out.trim().split("\n").filter(Boolean);
  const peeled = lines.find((l) => l.endsWith("^{}")) ?? lines[0];
  const sha = peeled?.split(/\s+/)[0];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Could not resolve ${repository}@${ref}`);
  return sha;
}

const cache = new Map<string, string>();
for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const path = join(dir, name);
  const before = readFileSync(path, "utf8");
  const after = before.replace(USES, (match, repository: string, ref: string) => {
    if (/^[0-9a-f]{40}$/.test(ref)) return match;
    const key = `${repository}@${ref}`;
    if (!cache.has(key)) cache.set(key, commitOf(repository, ref));
    return `uses: ${repository}@${cache.get(key)} # ${ref}`;
  });
  if (after !== before) writeFileSync(path, after);
}
for (const [action, sha] of cache) console.log(`${action} → ${sha}`);
console.log(cache.size ? `pinned ${cache.size} action(s)` : "nothing to pin");
