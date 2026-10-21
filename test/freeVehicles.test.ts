import { test } from "node:test";
import assert from "node:assert/strict";
import { createFreeVehicleClient, parseTransportstyrelsenVehicle, vehicleLookupLinks } from "../src/vehicles/free.ts";
const fixture =
  "<p><strong>Registreringsnummer</strong><br>ABC123</p><p><strong><a>Fabrikat</a></strong><br>EXEMPEL</p><p><strong>Handelsbeteckning</strong><br>Tourer</p><p><strong>Årsskatt</strong><br>0 kronor</p><p><strong>Besiktas senast</strong><br>2027-04-30</p><p><strong>Mätarställning</strong><br>12345</p><p>Ägare PRIVATE OWNER</p>";
test("free page parser preserves zero, excludes owners, checks registration and does not guess odometer units", () => {
  const v = parseTransportstyrelsenVehicle(fixture, "abc 123", "2026-10-17");
  assert.equal(v.make, "EXEMPEL");
  assert.equal(v.annualTaxKr, 0);
  assert.equal(v.mileageKm, undefined);
  assert.equal(v.nextInspectionDeadline, "2027-04-30");
  assert.doesNotMatch(JSON.stringify(v), /PRIVATE/);
  assert.throws(() => parseTransportstyrelsenVehicle(fixture, "ZZZ999", "2026-10-17"));
  assert.throws(() => parseTransportstyrelsenVehicle("<html>captcha</html>", "ABC123", "2026-10-17"));
  assert.equal(
    parseTransportstyrelsenVehicle(fixture.replace("12345", "12345 km"), "ABC123", "2026-10-17").mileageKm,
    12345,
  );
  assert.match(vehicleLookupLinks("abc 123").transportstyrelsen, /Registreringsnummer=ABC123$/);
  assert.throws(() => vehicleLookupLinks("../owner"));
});
test("free lookup needs no API key, caches concurrent requests, and redacts registration in hooks", async () => {
  let calls = 0;
  const logs: unknown[] = [];
  const client = createFreeVehicleClient({
    retries: 0,
    fetch: async (_url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      assert.equal(init?.redirect, "error");
      return new Response(fixture);
    },
    onRequest: (e) => logs.push(e),
    onCacheEvent: (e) => logs.push(e),
  });
  const [a, b] = await Promise.all([client.lookup("ABC123"), client.lookup("abc 123")]);
  assert.equal(calls, 1);
  assert.equal(a?.source, "transportstyrelsen");
  assert.deepEqual(a, b);
  assert.doesNotMatch(JSON.stringify(logs), /ABC123/);
  client.clearCache();
  await client.lookup("ABC123");
  assert.equal(calls, 2);
});

test("free page parser: HTML entities, Swedish mil, missing values, and errors without the registration", async () => {
  const page = [
    "<p><strong>Registreringsnummer</strong><br>ABC123</p>",
    "<p><strong>Fabrikat</strong><br>K&ouml;ping &amp; S&#246;ner &#x41;B &lt;3&gt; &quot;x&quot; &nbsp;&Aring;&Auml;&Ouml;&aring;&auml;&#0;</p>",
    "<p><strong>Mätarställning</strong><br>4 850 mil</p>",
    "<p><strong>Årsskatt</strong><br>uppgift saknas</p>",
    "<p><strong>Fordonsår</strong><br>1700</p>",
  ].join("");
  const v = parseTransportstyrelsenVehicle(page, "ABC123", "2026-10-21");
  assert.equal(v.make, 'Köping & Söner AB <3> "x" ÅÄÖåä');
  assert.equal(v.mileageKm, 48_500);
  assert.equal(v.annualTaxKr, undefined, "no digits: missing, never 0");
  assert.equal(v.modelYear, undefined);
  assert.throws(
    () => parseTransportstyrelsenVehicle("<p><strong>Registreringsnummer</strong><br>ABC123</p>", "ABC123", "x"),
    /no observations/,
  );
  assert.throws(() => parseTransportstyrelsenVehicle("x".repeat(2_000_001), "ABC123", "x"), RangeError);

  const failing = createFreeVehicleClient({
    retries: 0,
    fetch: async () => new Response("<html>captcha</html>", { status: 200 }),
  });
  await assert.rejects(failing.lookup("ABC123"), (e: Error) => !e.message.includes("ABC123"));
  const missing = createFreeVehicleClient({ retries: 0, fetch: async () => new Response("", { status: 404 }) });
  assert.equal(await missing.lookup("ABC123"), null);
  assert.equal(missing.stats().requests, 1);
  missing.resetStats();
  assert.equal(missing.stats().requests, 0);
});
