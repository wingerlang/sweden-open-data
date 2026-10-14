/**
 * Dev board: a local page that exercises every part of the package against the real sources or the fakes in
 * `src/testing.ts`, with live request logging, cache statistics and fault injection.
 *
 *   npm run dev                  # http://localhost:5174, real sources
 *   npm run dev -- --fake        # generated data, no network
 *   npm run dev -- --port 8080
 *
 * Needs Node.js ≥ 22.18 (runs the TypeScript sources directly). Not part of the published package.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  type AlertFeedId,
  type AlertKind,
  type AlertLevel,
  type CacheEvent,
  createClient,
  describeWeather,
  type Forecast,
  type RequestEvent,
  SourceError,
  type SwedenOpenData,
} from "../src/mod.ts";
import { createFakeSources, type Fault, type FaultyFetch, SOURCE_IDS, type SourceId, withFaults } from "../src/testing.ts";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || Number(process.env.PORT) || 5174;
const here = dirname(fileURLToPath(import.meta.url));

interface Config {
  mode: "live" | "fake";
  timeoutMs: number;
  retries: number;
  staleIfErrorMs: number;
  cache: boolean;
  locale: "sv" | "en";
}
let config: Config = { mode: args.includes("--fake") ? "fake" : "live", timeoutMs: 8000, retries: 1, staleIfErrorMs: 0, cache: true, locale: "sv" };

type LogEntry =
  | ({ kind: "request"; at: string } & Omit<RequestEvent, "error"> & { error?: { code: string; message: string } })
  | ({ kind: "cache"; at: string } & CacheEvent);
const log: LogEntry[] = [];
const listeners = new Set<ServerResponse>();
function push(entry: LogEntry): void {
  log.push(entry);
  if (log.length > 300) log.shift();
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of listeners) res.write(data);
}

let faulty: FaultyFetch;
let se: SwedenOpenData;
function build(keepFaults = true): void {
  const faults = keepFaults && faulty ? faulty.faults() : {};
  faulty = config.mode === "fake" ? createFakeSources() : withFaults(globalThis.fetch);
  for (const [source, fault] of Object.entries(faults)) faulty.setFault(source as SourceId, fault as Fault);
  se = createClient({
    fetch: faulty.fetch,
    userAgent: "sweden-open-data dev board (https://github.com/wingerlang/sweden-open-data)",
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    locale: config.locale,
    cache: config.cache ? { staleIfErrorMs: config.staleIfErrorMs } : false,
    onRequest: (e) => {
      const { error, ...rest } = e;
      push({ kind: "request", at: new Date().toISOString(), ...rest, ...(error ? { error: { code: error.code, message: error.message } } : {}) });
    },
    onCacheEvent: (e) => push({ kind: "cache", at: new Date().toISOString(), ...e }),
  });
}
build(false);

const num = (v: string | null, fallback?: number): number | undefined => (v === null || v === "" ? fallback : Number(v));
const list = <T extends string>(v: string | null): T[] | undefined => (v ? (v.split(",").filter(Boolean) as T[]) : undefined);
const positions = (v: string | null): { latitude: number; longitude: number }[] =>
  (v ?? "").split(";").filter(Boolean).map((p) => {
    const [latitude, longitude] = p.split(",").map(Number);
    return { latitude, longitude };
  });

/** The calls the board can make. Each returns the result and the equivalent code, for copy and paste. */
const CALLS: Record<string, (q: URLSearchParams) => [Promise<unknown>, string]> = {
  "spot.overview": (q) => [se.spot.overview(q.get("area") ?? "SE3", { windowHours: num(q.get("windowHours"), 3) }), `await se.spot.overview(${JSON.stringify(q.get("area") ?? "SE3")}, { windowHours: ${num(q.get("windowHours"), 3)} })`],
  "spot.prices": (q) => [se.spot.prices(q.get("area") ?? "SE3"), `await se.spot.prices(${JSON.stringify(q.get("area") ?? "SE3")})`],
  "spot.history": (q) => [se.spot.history(q.get("area") ?? "SE3", q.get("from") ?? "", q.get("to") ?? ""), `await se.spot.history(${JSON.stringify(q.get("area"))}, ${JSON.stringify(q.get("from"))}, ${JSON.stringify(q.get("to"))})`],
  "weather.forecast": (q) => {
    const p = { latitude: Number(q.get("lat")), longitude: Number(q.get("lon")) };
    return [se.weather.forecast(p, { days: num(q.get("days"), 7) }), `await se.weather.forecast(${JSON.stringify(p)}, { days: ${num(q.get("days"), 7)} })`];
  },
  "alerts.near": (q) => {
    const places = positions(q.get("p"));
    const options = {
      days: num(q.get("days"), 7),
      neighbors: q.get("neighbors") === "1",
      kinds: list<AlertKind>(q.get("kinds")),
      minLevel: (q.get("minLevel") || undefined) as AlertLevel | undefined,
      feeds: list<AlertFeedId>(q.get("feeds")),
    };
    return [se.alerts.near(places, options), `await se.alerts.near(${JSON.stringify(places)}, ${JSON.stringify(options)})`];
  },
  "geo.addresses": (q) => {
    const options = { country: q.get("country") === "" ? null : q.get("country") ?? "SE", limit: num(q.get("limit")) };
    return [se.geo.addresses(q.get("q") ?? "", options), `await se.geo.addresses(${JSON.stringify(q.get("q"))}, ${JSON.stringify(options)})`];
  },
  "geo.places": (q) => {
    const options = { country: q.get("country") || null, pointsOfInterest: q.get("poi") === "1", limit: num(q.get("limit")) };
    return [se.geo.places(q.get("q") ?? "", options), `await se.geo.places(${JSON.stringify(q.get("q"))}, ${JSON.stringify(options)})`];
  },
  "geo.region": (q) => {
    const p = { latitude: Number(q.get("lat")), longitude: Number(q.get("lon")) };
    return [se.geo.region(p), `await se.geo.region(${JSON.stringify(p)})`];
  },
};

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof SourceError) {
    return { name: error.name, message: error.message, code: error.code, source: error.source, status: error.status, transient: error.transient, retryAfterMs: error.retryAfterMs };
  }
  return { name: (error as Error)?.name ?? "Error", message: (error as Error)?.message ?? String(error) };
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(await readFile(join(here, "board.html")));
    }
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ kind: "hello", log })}\n\n`);
      listeners.add(res);
      req.on("close", () => listeners.delete(res));
      return;
    }
    if (url.pathname === "/api/state") return json(res, 200, { config, faults: faulty.faults(), sources: SOURCE_IDS, stats: se.stats(), calls: Object.keys(CALLS) });
    if (url.pathname === "/api/config" && req.method === "POST") {
      const next = await body(req);
      config = { ...config, ...next } as Config;
      build();
      return json(res, 200, { config });
    }
    if (url.pathname === "/api/fault" && req.method === "POST") {
      const { source, fault } = await body(req) as { source: SourceId; fault: Fault | null };
      if (!SOURCE_IDS.includes(source)) return json(res, 400, { error: "unknown source" });
      faulty.setFault(source, fault);
      return json(res, 200, { faults: faulty.faults() });
    }
    if (url.pathname === "/api/cache/clear" && req.method === "POST") {
      se.clearCache();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/stats/reset" && req.method === "POST") {
      se.resetStats();
      log.length = 0;
      return json(res, 200, { ok: true });
    }
    const call = url.pathname.startsWith("/api/call/") ? CALLS[url.pathname.slice(10)] : undefined;
    if (call) {
      const started = performance.now();
      let code = "";
      try {
        const [promise, snippet] = call(url.searchParams);
        code = snippet;
        const result = await promise;
        // Extra data for display only, kept apart from the package's own result.
        const annotations = url.pathname.endsWith("weather.forecast")
          ? { labels: Object.fromEntries([(result as Forecast).current.code, ...(result as Forecast).days.map((d) => d.code)].map((c) => [c, describeWeather(c, config.locale).label])) }
          : undefined;
        return json(res, 200, { ok: true, ms: Math.round(performance.now() - started), code, result, annotations });
      } catch (error) {
        return json(res, 200, { ok: false, ms: Math.round(performance.now() - started), code, error: describeError(error) });
      }
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: String(error) });
  }
}).listen(port, () => {
  console.log(`sweden-open-data dev board: http://localhost:${port}  (${config.mode === "fake" ? "fake sources" : "live sources"})`);
});
