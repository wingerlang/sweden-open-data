import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

/** A port that is free right now. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

// The board is started with `node dev/server.ts`; the Deno and Bun CI jobs run the library tests only.
const onNode = !("Deno" in globalThis) && !("Bun" in globalThis);

test("dev board: only this computer, only same-origin JSON, bounded and validated bodies", { skip: !onNode && "Node.js only" }, async (t) => {
  const port = await freePort();
  const script = fileURLToPath(new URL("../dev/server.ts", import.meta.url));
  const child = spawn(process.execPath, [script, "--fake", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (String(chunk).includes("dev board")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`dev server exited with ${code}`)));
  });

  const base = `http://127.0.0.1:${port}`;
  const post = (path: string, body: string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  assert.equal((await post("/api/config", JSON.stringify({ retries: 0 }), { origin: base })).status, 200);
  assert.equal((await post("/api/config", "{}", { origin: "https://example.com" })).status, 403);
  assert.equal((await post("/api/config", "{}", { "content-type": "text/plain" })).status, 415);
  assert.equal((await post("/api/config", JSON.stringify({ mode: "evil" }))).status, 400);
  assert.equal((await post("/api/config", JSON.stringify({ __proto__x: 1 }))).status, 400);
  assert.equal((await post("/api/config", "x".repeat(70 * 1024))).status, 413);
  assert.equal((await post("/api/fault", JSON.stringify({ source: "smhi", fault: { status: "503" } }))).status, 400);
  assert.equal((await post("/api/fault", JSON.stringify({ source: "smhi", fault: { status: 503 } }))).status, 200);
  const state = await (await fetch(`${base}/api/state`)).json() as { config: { retries: number }; faults: Record<string, unknown> };
  assert.equal(state.config.retries, 0);
  assert.deepEqual(state.faults.smhi, { status: 503 });
});
