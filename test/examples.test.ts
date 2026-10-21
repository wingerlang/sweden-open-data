import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

// The examples run with `node`; the Deno and Bun CI jobs run the library tests only.
const onNode = !("Deno" in globalThis) && !("Bun" in globalThis);

/** Each offline example and a line it must print. dashboard.ts talks to the real sources and is not run here. */
const EXAMPLES: Record<string, RegExp> = {
  "cancellation.ts": /page: .*unaffected[\s\S]*requests: 1 /,
  "weather-history.ts": /2026-01-05 +-?\d+\.\d °C +\d/,
  "air-quality.ts": /Above 30 grains\/m³: Björk/,
  "autocomplete.ts": /Drottninggatan 1 · 111 52 Stockholm[\s\S]*request\(s\) to Photon/,
  "persistent-store.ts": /after restart: +0 requests[\s\S]*prune removed: +1/,
  "investments.ts": /Demo Investment A[\s\S]*largest holdings/,
  "vehicle-lookup.ts": /ABC123 +EXEMPEL[\s\S]*inspect by +2027-04-30/,
  "reference-data.ts": /se:kth +Kungliga Tekniska högskolan[\s\S]*sport:ice-hockey/,
};

for (const [file, expected] of Object.entries(EXAMPLES)) {
  test(`example ${file} runs offline`, { skip: !onNode && "Node.js only" }, async () => {
    const path = fileURLToPath(new URL(`../examples/${file}`, import.meta.url));
    const output = await new Promise<string>((resolve, reject) =>
      execFile(process.execPath, [path], { timeout: 60_000 }, (error, stdout, stderr) =>
        error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout),
      ),
    );
    assert.match(output, expected);
  });
}
