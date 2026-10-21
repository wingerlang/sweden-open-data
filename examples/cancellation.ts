/**
 * Cancellation without side effects: two parts of an app ask for the same forecast at once and share one request.
 * When one of them gives up (the user navigated away), the other still gets its answer.
 *
 *   node examples/cancellation.ts           # against the built-in fake sources, no network
 *   node examples/cancellation.ts --live    # against Open-Meteo
 */
import { createClient, SourceError } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";

const live = process.argv.includes("--live");
const fake = createFakeSources();
fake.setFault("open-meteo", { delayMs: 300 }); // make the fake as slow as a real request, so there is time to cancel
const se = createClient(live ? { userAgent: "sweden-open-data example" } : { fetch: fake.fetch });
const stockholm = { latitude: 59.33, longitude: 18.07 };

const sidebar = new AbortController();
const widget = se.weather.forecast(stockholm, { signal: sidebar.signal });
const page = se.weather.forecast(stockholm); // the same request: shares the load above
setTimeout(() => sidebar.abort(), 20); // the sidebar is closed before the answer arrives

const [w, p] = await Promise.allSettled([widget, page]);
console.log(
  "sidebar:",
  w.status === "rejected" && w.reason instanceof SourceError ? `cancelled (${w.reason.code})` : w.status,
);
console.log("page:   ", p.status === "fulfilled" ? `${p.value.current.temperature} °C – unaffected` : p.reason);
console.log("requests:", se.stats().requests, "(one shared request)");
