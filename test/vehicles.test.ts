import { test } from "node:test";
import assert from "node:assert/strict";
import { createVehicleClient, normalizeVehicleRegistration, parseBiluppgifterVehicle } from "../src/vehicles/mod.ts";
import { createFakeSources, fakeVehicleResponse, sourceOf } from "../src/testing.ts";
import { SourceError } from "../src/core/errors.ts";
import { fakeFetch, quick } from "./helpers.ts";
const at = "2026-10-16T12:00:00.000Z";
const opts = { apiKey: "test-only", ...quick, now: () => Date.parse(at) };
test("plate validation happens locally, before any paid lookup", async () => {
  assert.equal(normalizeVehicleRegistration("abc 123"), "ABC123");
  assert.equal(normalizeVehicleRegistration("ABC-12A"), "ABC12A");
  for (const plate of ["bad", "A".repeat(17), "ABC123/owner", null as any, 123 as any])
    assert.throws(() => normalizeVehicleRegistration(plate), RangeError);
  const fetch = fakeFetch(() => {
    throw Error("must not run");
  });
  const client = createVehicleClient({ ...opts, fetch });
  await assert.rejects(client.lookup("bad"), RangeError);
  assert.equal(fetch.calls.length, 0);
  for (const apiKey of ["", null as any, "x\nsecret"])
    assert.throws(() => createVehicleClient({ ...opts, apiKey }), RangeError);
  assert.throws(() => createVehicleClient(undefined as any), RangeError);
  for (const ttlMs of [-1, NaN, Infinity]) assert.throws(() => createVehicleClient({ ...opts, ttlMs }), RangeError);
});
test("documented packages keep zero, distinguish years, preserve date-only deadline and exclude owner data", () => {
  const raw = fakeVehicleResponse("ABC123") as any;
  raw.data.basic.data.model_year = 2023;
  raw.data.basic.data.vehicle_year = 2022;
  raw.data.status.data.tax = 0;
  raw.data.inspection.data.meter = 0;
  raw.data.owner = { data: { name: "PRIVATE OWNER" } };
  raw.data.attributes.vin = "PRIVATE VIN";
  const v = parseBiluppgifterVehicle(raw, "abc 123", at);
  assert.equal(v.registrationNumber, "ABC123");
  assert.equal(v.modelYear, 2023);
  assert.equal(v.vehicleYear, 2022);
  assert.equal(v.annualTaxKr, 0);
  assert.equal(v.mileageKm, 0);
  assert.equal(v.nextInspectionDeadline, "2027-04-30");
  assert.equal(v.source, "biluppgifter");
  assert.equal(v.fetchedAt, at);
  assert.ok(!JSON.stringify(v).includes("PRIVATE"));
  delete raw.data.basic.data.model_year;
  assert.equal(parseBiluppgifterVehicle(raw, "ABC123", at).modelYear, 2022);
});
test("missing, malformed or mismatched observations are never replaced by invented values", () => {
  for (const payload of [
    null,
    [],
    { data: [] },
    { data: {} },
    { data: { basic: { data: { make: 42 } }, status: { data: { tax: -1 } } } },
  ])
    assert.throws(() => parseBiluppgifterVehicle(payload, "ABC123", at), SourceError);
  const raw: any = {
    data: {
      basic: { data: { make: " Example ", model: " ", model_year: 2022.5, vehicle_year: "no" } },
      status: { data: { tax: true, first_registered: "2026-02-31" } },
      inspection: { data: { meter: " ", latest_inspection: "yesterday", inspection_valid_until: "2026-99-31" } },
    },
  };
  const v = parseBiluppgifterVehicle(raw, "ABC123", at);
  assert.equal(v.make, "Example");
  assert.equal(v.model, undefined);
  assert.equal(v.modelYear, undefined);
  assert.equal(v.annualTaxKr, undefined);
  assert.equal(v.mileageKm, undefined);
  assert.equal(v.firstRegistered, undefined);
  assert.equal(v.lastInspectionDate, undefined);
  assert.equal(v.nextInspectionDeadline, undefined);
  raw.data.attributes = { regno: "XYZ123" };
  assert.throws(() => parseBiluppgifterVehicle(raw, "ABC123", at), SourceError);
  for (const y of [1800, 2500]) {
    raw.data.attributes = {};
    raw.data.basic.data.model_year = y;
    assert.equal(parseBiluppgifterVehicle(raw, "ABC123", at).modelYear, undefined);
  }
});
test("numeric strings and inspection-only observations are supported without make/model", () => {
  const v = parseBiluppgifterVehicle(
    {
      data: {
        status: { data: { tax: "360", first_registered: "2020-01-15" } },
        inspection: {
          data: {
            meter: "48500",
            latest_inspection: "2026-02-01T00:00:00+01:00",
            inspection_valid_until: "2027-04-30T00:00:00+02:00",
          },
        },
      },
    },
    "ABC123",
    at,
  );
  assert.equal(v.mileageKm, 48500);
  assert.equal(v.annualTaxKr, 360);
  assert.equal(v.firstRegistered, "2020-01-15");
  assert.equal(v.lastInspectionDate, "2026-02-01");
  assert.equal(v.nextInspectionDeadline, "2027-04-30");
});
test("lookup authenticates in a header, rejects redirects, limits packages and shares memory-only requests", async () => {
  let now = Date.parse(at);
  const requests: RequestInit[] = [],
    events: unknown[] = [],
    cacheEvents: unknown[] = [];
  const fetch = fakeFetch((url, init) => {
    assert.equal(url.hostname, "api.biluppgifter.se");
    assert.equal(url.searchParams.get("include"), "basic,status,inspection");
    assert.equal(url.searchParams.get("api_token"), null);
    requests.push(init!);
    return fakeVehicleResponse("ABC123");
  });
  const client = createVehicleClient({
    ...opts,
    fetch,
    now: () => now,
    ttlMs: 100,
    onRequest: (e) => events.push(e),
    onCacheEvent: (e) => cacheEvents.push(e),
  });
  const [a, b] = await Promise.all([client.lookup("abc 123"), client.lookup("ABC123")]);
  assert.deepEqual(a, b);
  assert.equal(fetch.calls.length, 1);
  assert.equal(new Headers(requests[0].headers).get("Authorization"), "Bearer test-only");
  assert.equal(requests[0].redirect, "error");
  await client.lookup("ABC123");
  assert.equal(fetch.calls.length, 1);
  now += 101;
  await client.lookup("ABC123");
  assert.equal(fetch.calls.length, 2);
  client.clearCache();
  await client.lookup("ABC123");
  assert.equal(fetch.calls.length, 3);
  assert.equal(client.stats().requests, 3);
  assert.ok(client.stats().cache.hits > 0);
  client.resetStats();
  assert.equal(client.stats().requests, 0);
  assert.ok(!JSON.stringify([events, cacheEvents]).includes("ABC123"));
  assert.ok(!JSON.stringify([events, cacheEvents]).includes("test-only"));
});
test("404 is explicit null and has a short negative cache; provider failures are not cached", async () => {
  let now = 0;
  const fetch = fakeFetch(() => new Response("", { status: 404 })),
    client = createVehicleClient({ ...opts, fetch, now: () => now });
  assert.equal(await client.lookup("ABC123"), null);
  await client.lookup("ABC123");
  assert.equal(fetch.calls.length, 1);
  now = 300001;
  await client.lookup("ABC123");
  assert.equal(fetch.calls.length, 2);
  let count = 0;
  const fail = fakeFetch(() => {
      count++;
      return new Response("", { status: count === 1 ? 429 : 503, headers: { "retry-after": "60" } });
    }),
    failed = createVehicleClient({ ...opts, fetch: fail });
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      failed.lookup("ABC123"),
      (e: SourceError) => e.retryAfterMs === 60000 && !JSON.stringify(e).includes("ABC123") && e.cause === undefined,
    );
  assert.equal(count, 2);
});
test("provider faults, invalid JSON and parsing failures have typed redacted errors", async () => {
  const events: unknown[] = [];
  for (const handler of [
    () => new Response("", { status: 401 }),
    () => new Response("bad"),
    () => ({ data: {} }),
    () => {
      throw Error("ABC123 test-only private cause");
    },
  ]) {
    const client = createVehicleClient({ ...opts, fetch: fakeFetch(handler), onRequest: (e) => events.push(e) });
    await assert.rejects(
      client.lookup("ABC123"),
      (e: SourceError) =>
        e instanceof SourceError &&
        !JSON.stringify(e).includes("ABC123") &&
        !JSON.stringify(e).includes("test-only") &&
        e.cause === undefined,
    );
  }
  assert.ok(!JSON.stringify(events).includes("ABC123"));
  assert.ok(!JSON.stringify(events).includes("test-only"));
});
test("separate credentials have separate caches and cancellation never poisons a shared lookup", async () => {
  const fake = createFakeSources();
  assert.equal(sourceOf("https://api.biluppgifter.se/api/v1/vehicle/regno/ABC123"), "biluppgifter");
  const a = createVehicleClient({ ...opts, fetch: fake.fetch }),
    b = createVehicleClient({ ...opts, apiKey: "other-test-only", fetch: fake.fetch });
  await a.lookup("ABC123");
  await b.lookup("ABC123");
  assert.equal(fake.calls.length, 2);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(a.lookup("ABC123", { signal: abort.signal }));
  assert.equal(fake.calls.length, 2);
  // A caller with its own signal now shares the cache instead of bypassing it (step 7 of implementation.md).
  const signal = new AbortController().signal;
  await a.lookup("ABC123", { signal });
  assert.equal(fake.calls.length, 2);
  fake.setFault("biluppgifter", { status: 503 });
  a.clearCache();
  await assert.rejects(a.lookup("ABC123"), SourceError);
  fake.setFault("biluppgifter", null);
  assert.ok(await a.lookup("ABC123"));
});
test("cache=false disables reuse; network retries still use common retry policy", async () => {
  let calls = 0;
  const fetch = fakeFetch(() => (++calls === 1 ? new Response("", { status: 503 }) : fakeVehicleResponse("ABC123")));
  const client = createVehicleClient({ ...opts, fetch, retries: 1, cache: false });
  assert.ok(await client.lookup("ABC123"));
  assert.equal(calls, 2);
  await client.lookup("ABC123");
  assert.equal(calls, 3);
});
