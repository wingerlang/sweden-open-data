/**
 * Load test against the fake sources (step 24 of implementation.md): 100 concurrent callers per method. Checks that
 * concurrent identical requests reach a source once, that a second wave is served from the cache, and that no source
 * gets more requests at a time than its limit. No network. `npm run load`
 *
 * @module
 */
import { createClient } from "../src/mod.ts";
import { createFakeSources, sourceOf } from "../src/testing.ts";
import { createInvestmentClient } from "../src/investments/mod.ts";
import { createFreeVehicleClient } from "../src/vehicles/free.ts";

const CALLERS = 100;
const here = { latitude: 59.33, longitude: 18.07 };

const fake = createFakeSources();
const inFlight = new Map<string, number>();
const most = new Map<string, number>();
const counting: typeof fetch = async (input, init) => {
  const source = sourceOf(new URL(input instanceof Request ? input.url : String(input))) ?? "other";
  inFlight.set(source, (inFlight.get(source) ?? 0) + 1);
  most.set(source, Math.max(most.get(source) ?? 0, inFlight.get(source) ?? 0));
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return await fake.fetch(input, init);
  } finally {
    inFlight.set(source, (inFlight.get(source) ?? 1) - 1);
  }
};
const se = createClient({ fetch: counting, retries: 0 });
const investments = createInvestmentClient({ fetch: counting, retries: 0 });
const vehicles = createFreeVehicleClient({ fetch: counting, retries: 0 });

const methods: Record<string, () => Promise<unknown>> = {
  "spot.prices": () => se.spot.prices("SE3"),
  "weather.forecast": () => se.weather.forecast(here),
  "weather.history": () => se.weather.history(here, "2026-01-01", "2026-01-07"),
  "weather.environment": () => se.weather.environment(here),
  "alerts.near": () => se.alerts.near([here]),
  "geo.region": () => se.geo.region(here),
  "geo.addresses": () => se.geo.addresses("Drottninggatan 1, Stockholm"),
  "geo.places": () => se.geo.places("Uppsala"),
  "economy.cpi": () => se.economy.cpi("KPI"),
  "investments.overview": () => investments.overview(),
  "vehicles/free.lookup": () => vehicles.lookup("ABC123"),
};

const failures: string[] = [];
for (const [name, call] of Object.entries(methods)) {
  const before = fake.calls.length;
  const results = await Promise.allSettled(Array.from({ length: CALLERS }, call));
  const rejected = results.filter((r) => r.status === "rejected");
  const firstWave = fake.calls.slice(before);
  const perUrl = new Map<string, number>();
  for (const url of firstWave) perUrl.set(url.href, (perUrl.get(url.href) ?? 0) + 1);
  const repeated = [...perUrl.values()].filter((n) => n > 1).length;
  const afterFirst = fake.calls.length;
  await Promise.allSettled(Array.from({ length: CALLERS }, call));
  const secondWave = fake.calls.length - afterFirst;
  console.log(
    `${name.padEnd(20)} ${String(firstWave.length).padStart(3)} requests for ${CALLERS} callers, ` +
      `${secondWave} on the second wave${rejected.length ? `, ${rejected.length} failed` : ""}`,
  );
  if (rejected.length) failures.push(`${name}: ${String((rejected[0] as PromiseRejectedResult).reason)}`);
  if (repeated) failures.push(`${name}: ${repeated} URL(s) requested more than once`);
  if (secondWave) failures.push(`${name}: the second wave was not served from the cache`);
}
const photon = most.get("photon") ?? 0;
console.log(`most requests in flight to Photon: ${photon} (limit 2)`);
if (photon > 2) failures.push(`Photon had ${photon} requests in flight`);

if (failures.length) {
  console.error("\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nload: ok");
}
