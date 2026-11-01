import { test, type TestContext } from "node:test";
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

/** Starts the board on fake sources and returns its base URL. The process is stopped when the test ends. */
async function startBoard(t: TestContext): Promise<string> {
  const port = await freePort();
  const script = fileURLToPath(new URL("../dev/server.ts", import.meta.url));
  const child = spawn(process.execPath, [script, "--fake", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (String(chunk).includes("dev board")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`dev server exited with ${code}`)));
  });
  return `http://127.0.0.1:${port}`;
}

test(
  "dev board: only this computer, only same-origin JSON, bounded and validated bodies",
  { skip: !onNode && "Node.js only" },
  async (t) => {
    const base = await startBoard(t);
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
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      config: { retries: number };
      faults: Record<string, unknown>;
    };
    assert.equal(state.config.retries, 0);
    assert.deepEqual(state.faults.smhi, { status: 503 });
  },
);

test(
  "dev board: settings that would break the clients are rejected and leave the configuration unchanged",
  { skip: !onNode && "Node.js only" },
  async (t) => {
    const base = await startBoard(t);
    const post = (body: unknown): Promise<Response> =>
      fetch(`${base}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const config = async (): Promise<Record<string, unknown>> =>
      ((await (await fetch(`${base}/api/state`)).json()) as { config: Record<string, unknown> }).config;
    const before = await config();

    for (const bad of [{ timeoutMs: 0 }, { timeoutMs: 99 }, { timeoutMs: 120_001 }, { retries: 11 }, { retries: -1 }]) {
      assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
    }
    assert.deepEqual(await config(), before);
    assert.equal((await post({ timeoutMs: 100, retries: 10 })).status, 200);
  },
);

test(
  "dev board: serves the page and every call answers on the fake sources",
  { skip: !onNode && "Node.js only" },
  async (t) => {
    const base = await startBoard(t);

    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await page.text(), /<title>sweden-open-data · dev board<\/title>/);

    // One set of parameters per call. A new call without an entry here fails the test on purpose.
    const place = "lat=59.33&lon=18.07";
    const params: Record<string, string> = {
      "spot.overview": "area=SE3",
      "spot.prices": "area=SE3",
      "spot.history": "area=SE3&from=2026-10-18&to=2026-10-24",
      "weather.forecast": `${place}&days=7`,
      "weather.history": `${place}&from=2026-10-12&to=2026-10-14`,
      "weather.environment": `${place}&days=1`,
      "alerts.near": "p=59.33,18.07",
      "geo.addresses": "q=Vinsl%C3%B6v",
      "geo.places": "q=Kiruna",
      "geo.region": place,
      "economy.housing": "region=00",
      "economy.mortgage": "",
      "economy.cpi": "index=KPI&amount=10000&from=2000-01",
      "investments.overview": "",
      "investments.company": "",
      "vehicles.free": "plate=ABC123",
      "education.search": "q=tekniska",
      "sports.search": "q=brott",
    };
    const state = (await (await fetch(`${base}/api/state`)).json()) as { calls: string[] };
    assert.deepEqual([...state.calls].sort(), Object.keys(params).sort());

    type Answer = {
      ok: boolean;
      code: string;
      error?: unknown;
      result?: Record<string, unknown>;
      annotations?: { labels: Record<string, string>; icons: Record<string, string> };
    };
    const answers = new Map<string, Answer>();
    for (const call of state.calls) {
      const answer = (await (await fetch(`${base}/api/call/${call}?${params[call]}`)).json()) as Answer;
      assert.equal(answer.ok, true, `${call}: ${JSON.stringify(answer.error)}`);
      assert.ok(answer.code.length > 0, `${call} has no code snippet`);
      answers.set(call, answer);
    }

    // Extra data the page draws from: inflation history for the chart, weather icons next to the labels.
    const recent = answers.get("economy.cpi")?.result?.recent as unknown[];
    assert.ok(Array.isArray(recent) && recent.length > 0 && recent.length <= 60);
    const { labels, icons } = answers.get("weather.forecast")?.annotations ?? { labels: {}, icons: {} };
    assert.ok(Object.keys(icons).length > 0);
    assert.deepEqual(Object.keys(icons).sort(), Object.keys(labels).sort());

    // Clearing the cache works for every client and the page keeps being served afterwards.
    const clear = await fetch(`${base}/api/cache/clear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(clear.status, 200);
    const again = (await (await fetch(`${base}/api/call/investments.overview`)).json()) as Answer;
    assert.equal(again.ok, true);
  },
);
