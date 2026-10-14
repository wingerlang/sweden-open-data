import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type AddressSuggestion,
  approximateAddress,
  COUNTIES,
  createGeoClient,
  matchesAddressQuery,
  nearestCounty,
  neighboringCounties,
  parseAddressQuery,
  parseOpenMeteoPlaces,
  parsePhotonAddresses,
  parsePhotonPlaces,
  regionKey,
} from "../src/geo/mod.ts";
import { SourceError } from "../src/core/errors.ts";
import { fakeFetch, photonFeature, quick } from "./helpers.ts";

const araslov = photonFeature(14.2, 56.1, { name: "Åraslöv", housenumber: "1105", city: "Kristianstad", postcode: "291 95", countrycode: "SE" });
const json = (features: unknown[]): unknown => ({ features });

test("parsing Swedish address queries, with or without commas and postal code", () => {
  assert.deepEqual(parseAddressQuery("Åraslöv 1105, 28890 Vinslöv"), { street: "Åraslöv", house: "1105", postalCode: "288 90", city: "Vinslöv", address: "Åraslöv 1105" });
  assert.deepEqual(parseAddressQuery("åraslöv 1105 288 90 vinslöv"), { street: "åraslöv", house: "1105", postalCode: "288 90", city: "vinslöv", address: "åraslöv 1105" });
  assert.deepEqual(parseAddressQuery("Storgatan 12B, Lund"), { street: "Storgatan", house: "12B", postalCode: "", city: "Lund", address: "Storgatan 12B" });
  assert.deepEqual(parseAddressQuery("Storgatan 12345"), { street: "Storgatan", house: "12345", postalCode: "", city: "", address: "Storgatan 12345" });
  assert.equal(parseAddressQuery("Vinslöv").house, "");
  assert.equal(parseAddressQuery("  Kungsgatan   4 a ,  Göteborg ").house, "4A");
});

test("Photon results: real house, postcode and country; invalid coordinates and duplicates dropped", () => {
  const results = parsePhotonAddresses(json([araslov, araslov, photonFeature(14, 100, { name: "x", countrycode: "SE" }), photonFeature(14, 56, { name: "x", countrycode: "Sweden" }), photonFeature(14, 56, { countrycode: "SE" }), { geometry: { type: "Polygon" }, properties: {} }, null]));
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { label: "Åraslöv 1105 · 291 95 Kristianstad · SE", address: "Åraslöv 1105", city: "Kristianstad", postalCode: "291 95", countryCode: "SE", latitude: 56.1, longitude: 14.2, precision: "address" });
  const village = parsePhotonAddresses(json([photonFeature(14, 56, { name: "Åraslöv", countrycode: "se" })]))[0];
  assert.equal(village.address, "");
  assert.equal(village.precision, "city");
  assert.deepEqual(parsePhotonAddresses({}), []);
  assert.equal(parsePhotonAddresses(json(Array.from({ length: 20 }, (_, i) => photonFeature(14, 56, { name: "P" + i, countrycode: "SE" })))).length, 12);
});

test("matching: a nearby street or another house number is never the address", () => {
  const exact = parsePhotonAddresses(json([araslov]))[0];
  assert.ok(matchesAddressQuery(exact, "Åraslöv 1105, Vinslöv"));
  assert.ok(!matchesAddressQuery({ ...exact, address: "Åraslöv 1106" }, "Åraslöv 1105"));
  assert.ok(!matchesAddressQuery({ ...exact, address: "Åraslövsvägen 1105" }, "Åraslöv 1105"));
  assert.ok(matchesAddressQuery({ ...exact, address: "", precision: "city" }, "Åraslöv 1105"), "a locality matches by name");
  assert.ok(matchesAddressQuery(exact, "Åraslöv"));
});

test("approximate address: your text, the village's position, nothing invented", () => {
  const village: AddressSuggestion = { label: "Åraslöv · Hässleholms kommun · SE", address: "", city: "Hässleholms kommun", postalCode: "291 95", countryCode: "SE", latitude: 56.05, longitude: 14.02, precision: "city" };
  const a = approximateAddress("åraslöv 1105, vinslöv", village)!;
  assert.deepEqual([a.address, a.city, a.postalCode, a.near, a.approximate, a.precision], ["Åraslöv 1105", "Vinslöv", "", "Åraslöv", true, "city"]);
  assert.equal(a.label, "Åraslöv 1105 · Vinslöv · SE");
  assert.equal(approximateAddress("Åraslöv 1105", village)!.postalCode, "291 95", "the village's own postcode when the town matches");
  assert.equal(approximateAddress("Åraslöv", village), null);
  const fromAddress = approximateAddress("Byvägen 3", { ...village, address: "Byvägen 7" })!;
  assert.equal(fromAddress.near, "Byvägen");
});

test("places from Photon and Open-Meteo, validated", () => {
  assert.deepEqual(parsePhotonPlaces(json([photonFeature(3.5, 44.2, { name: "Reserve Example", countrycode: "fr", state: "Occitanie", city: "Reserve Example" })])), [{ name: "Reserve Example", region: "Occitanie", countryCode: "FR", latitude: 44.2, longitude: 3.5, source: "OpenStreetMap / Photon" }]);
  assert.deepEqual(parsePhotonPlaces(json([photonFeature(2, 100, { name: "Invalid", countrycode: "fr" }), photonFeature(2, 40, { countrycode: "fr" }), { properties: { name: "x", countrycode: "FR" } }])), []);
  assert.deepEqual(parsePhotonPlaces(null), []);
  assert.deepEqual(parseOpenMeteoPlaces({ results: [{ name: "Rom", country_code: "IT", latitude: 41.9, longitude: 12.5, admin1: "Lazio" }, { name: "Fel", country_code: "IT", latitude: 99, longitude: 12 }, { name: "Utan region", country_code: "IT", latitude: 41, longitude: 12 }] }).map((p) => [p.name, p.region]), [["Rom", "Lazio"], ["Utan region", ""]]);
  assert.deepEqual(parseOpenMeteoPlaces({}), []);
});

test("regions: name keys, nearest county, neighbours", () => {
  assert.equal(COUNTIES.length, 21);
  assert.equal(regionKey("Hässleholms kommun"), regionKey("Hässleholm"));
  assert.equal(regionKey("Västra Götalands län"), regionKey("Västra Götaland"));
  assert.equal(nearestCounty({ latitude: 56.1, longitude: 13.91 }), "Skåne län");
  assert.equal(nearestCounty({ latitude: 63.83, longitude: 20.26 }), "Västerbottens län");
  assert.deepEqual(neighboringCounties("Skåne län").sort(), ["Blekinge", "Halland", "Kronoberg"]);
  assert.deepEqual(neighboringCounties("Gotlands län"), []);
});

test("address search: exact hits first; country filter; input validation", async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.origin, "https://photon.komoot.io");
    assert.equal(url.searchParams.get("countrycode"), "SE");
    assert.equal(url.searchParams.get("limit"), "15");
    return json([araslov, photonFeature(23, 38, { name: "Arachova", housenumber: "1", street: "Odos", countrycode: "GR" })]);
  });
  const geo = createGeoClient({ fetch, ...quick });
  const r = await geo.addresses("Åraslöv 1105");
  assert.equal(r.length, 1);
  assert.equal(r[0].precision, "address");
  await assert.rejects(geo.addresses("a"), RangeError);
  await assert.rejects(geo.addresses("x".repeat(201)), RangeError);
  await assert.rejects(geo.addresses("abc\u0007"), RangeError);
  await assert.rejects(geo.addresses("Åraslöv", { country: "Sweden" }), RangeError);

  const anywhere = fakeFetch((url) => {
    assert.equal(url.searchParams.get("countrycode"), null);
    assert.equal(url.searchParams.get("limit"), "8");
    return json([photonFeature(23, 38, { name: "Odos", housenumber: "1", street: "Odos", countrycode: "GR" })]);
  });
  assert.equal((await createGeoClient({ fetch: anywhere, ...quick }).addresses("Odos 1", { country: null }))[0].countryCode, "GR");
});

test("address search: a rural address missing from the map is offered as typed, at the village near the town", async () => {
  const queries: string[] = [];
  const fetch = fakeFetch((url) => {
    const q = url.searchParams.get("q")!;
    queries.push(q + (url.searchParams.has("lat") ? " @near" : "") + (url.searchParams.has("layer") ? " [localities]" : ""));
    if (q === "Vinslöv") return json([photonFeature(13.91, 56.1, { name: "Vinslöv", city: "Vinslöv", postcode: "288 31", countrycode: "SE" })]);
    if (q === "Åraslöv") {
      return json([
        photonFeature(14.02, 56.05, { name: "Åraslöv", city: "Hässleholms kommun", countrycode: "SE" }),
        photonFeature(16.5, 59.6, { name: "Åraslöv", city: "Västerås", countrycode: "SE" }),
      ]);
    }
    return json([]);
  });
  const r = await createGeoClient({ fetch, ...quick }).addresses("Åraslöv 1105, 28890 Vinslöv");
  assert.ok(queries.includes("Åraslöv 1105 Vinslöv") && queries.includes("Åraslöv 1105 288 90") && queries.includes("Åraslöv @near [localities]") && queries.includes("Vinslöv [localities]"));
  const typed = r[0];
  assert.deepEqual([typed.address, typed.postalCode, typed.city, typed.approximate, typed.near, typed.longitude], ["Åraslöv 1105", "288 90", "Vinslöv", true, "Åraslöv", 14.02]);
  assert.ok(r.every((p) => p.city !== "Västerås"), "the namesake far away is ignored");
});

test("address search: never a similarly named street; falls back to the town or the postal code", async () => {
  const fetch = fakeFetch((url) => {
    const q = url.searchParams.get("q")!;
    if (q === "Vinslöv") return json([photonFeature(13.91, 56.1, { name: "Vinslöv", city: "Vinslöv", countrycode: "SE" })]);
    return json([photonFeature(13.9, 56.1, { name: "Åraslövsvägen", city: "Vinslöv", postcode: "288 31", countrycode: "SE" })]);
  });
  const r = await createGeoClient({ fetch, ...quick }).addresses("Åraslöv 1105, Vinslöv");
  assert.ok(r.every((p) => !/vägen/.test(p.label)));
  assert.deepEqual([r[0].address, r[0].near, r[0].city], ["Åraslöv 1105", "Vinslöv", "Vinslöv"]);
  assert.deepEqual([r[1].address, r[1].city], ["", "Vinslöv"]);

  const byPostcode = fakeFetch((url) => {
    const q = url.searchParams.get("q")!;
    if (q === "288 90") return json([photonFeature(13.92, 56.11, { name: "Vinslöv", city: "Vinslöv", postcode: "28890", countrycode: "SE" }), photonFeature(13, 55, { name: "Annat", city: "Annat", postcode: "211 11", countrycode: "SE" })]);
    return json([]);
  });
  const p = await createGeoClient({ fetch: byPostcode, ...quick }).addresses("Okändväg 5, 288 90");
  assert.deepEqual([p[0].address, p[0].approximate, p[0].postalCode], ["Okändväg 5", true, "288 90"]);
  assert.equal(p.length, 2);

  const unrelated = fakeFetch(() => json([photonFeature(13, 55.6, { name: "Annat ställe", city: "Malmö", countrycode: "SE" })]));
  assert.deepEqual(await createGeoClient({ fetch: unrelated, ...quick }).addresses("Åraslöv"), []);
  const named = fakeFetch((url) => (url.searchParams.has("layer") ? json([]) : json([photonFeature(14, 56, { name: "Åraslöv", countrycode: "SE" })])));
  assert.equal((await createGeoClient({ fetch: named, ...quick }).addresses("Åraslöv"))[0].city, "Åraslöv", "a matching locality as a last resort");
});

test("address search: shared and cached lookups, errors surface, Photon without countrycode support", async () => {
  let fail = false;
  const fetch = fakeFetch(() => (fail ? new Response("", { status: 503 }) : json([araslov])));
  const geo = createGeoClient({ fetch, ...quick });
  const [a, b] = await Promise.all([geo.addresses("Åraslöv 1105"), geo.addresses("åraslöv 1105")]);
  assert.deepEqual(a, b);
  assert.equal(fetch.calls.length, 1);
  fail = true;
  await assert.rejects(geo.addresses("Åraslöv gata"), (e: SourceError) => e.status === 503);
  fail = false;
  assert.equal((await geo.addresses("Other street")).length, 0);

  const seen: string[] = [];
  const old = fakeFetch((url) => {
    seen.push(url.search);
    return url.searchParams.has("countrycode") ? new Response("unknown parameter", { status: 400 }) : json([araslov]);
  });
  const legacy = createGeoClient({ fetch: old, ...quick });
  assert.equal((await legacy.addresses("Åraslöv 1105"))[0].precision, "address");
  await legacy.addresses("Åraslöv 1106");
  assert.equal(seen.filter((s) => s.includes("countrycode")).length, 1, "the filter is dropped once, then remembered");
  const broken = fakeFetch(() => new Response("bad", { status: 400 }));
  await assert.rejects(createGeoClient({ fetch: broken, ...quick }).addresses("Åraslöv 1105", { country: null }), (e: SourceError) => e.status === 400);
  const aborted = createGeoClient({ fetch: fakeFetch(() => json([])), ...quick });
  await assert.rejects(aborted.addresses("Åraslöv 1105, Vinslöv", { signal: AbortSignal.abort() }));
});

test("place search: cities first, points of interest on request or as a fallback, cached", async () => {
  const fetch = fakeFetch((url) => {
    if (url.hostname === "geocoding-api.open-meteo.com") {
      assert.equal(url.searchParams.get("language"), "sv");
      return url.searchParams.get("name") === "Rome" ? { results: [{ name: "Rom", country_code: "IT", latitude: 41.9, longitude: 12.5, admin1: "Lazio" }] } : { results: [] };
    }
    return json([photonFeature(3.5, 44.2, { name: "Reserve Example", countrycode: "fr", state: "Occitanie" }), photonFeature(12.5, 41.9, { name: "Rom", countrycode: "IT" })]);
  });
  const geo = createGeoClient({ fetch, ...quick });
  const rome = await geo.places("Rome", { country: "it" });
  assert.deepEqual(rome.map((p) => p.name), ["Rom"]);
  assert.equal(fetch.calls[0].searchParams.get("countryCode"), "IT");
  await geo.places("Rome", { country: "IT" });
  assert.equal(fetch.calls.length, 1);
  const poi = await geo.places("Reserve Example");
  assert.equal(poi[0].countryCode, "FR");
  assert.equal(fetch.calls.length, 3, "no city found: points of interest are searched");
  const both = await geo.places("Rome", { pointsOfInterest: true });
  assert.deepEqual(both.map((p) => p.name), ["Rom", "Reserve Example"], "duplicates across sources removed");
  await assert.rejects(geo.places("x"), RangeError);

  const poiDown = fakeFetch((url) => (url.hostname === "geocoding-api.open-meteo.com" ? { results: [{ name: "Rom", country_code: "IT", latitude: 41.9, longitude: 12.5 }] } : new Response("", { status: 500 })));
  assert.equal((await createGeoClient({ fetch: poiDown, ...quick }).places("Rome", { pointsOfInterest: true })).length, 1, "points of interest are a bonus");
  await assert.rejects(createGeoClient({ fetch: poiDown, ...quick }).places("Rome", { pointsOfInterest: true, signal: AbortSignal.abort() }));
});

test("region: county, municipality and locality; nearest-county fallback; rounding", async () => {
  let mode = "ok";
  const fetch = fakeFetch(() => {
    if (mode === "down") throw new TypeError("offline");
    if (mode === "abroad") return { features: [{ properties: { state: "Hovedstaden", city: "Copenhagen" } }] };
    if (mode === "municipality") return { features: [{ properties: { county: "Osby kommun" } }] };
    return { features: [{ properties: { state: "Skåne län", county: "Hässleholms kommun", village: "Vinslöv" } }] };
  });
  const geo = createGeoClient({ fetch, ...quick });
  assert.deepEqual(await geo.region({ latitude: 56.10123, longitude: 13.91456 }), { latitude: 56.1, longitude: 13.91, county: "Skåne län", municipality: "Hässleholms kommun", locality: "Vinslöv" });
  assert.equal(fetch.calls[0].searchParams.get("lat"), "56.1");
  mode = "down";
  assert.deepEqual(await geo.region({ latitude: 63.83, longitude: 20.26 }), { latitude: 63.83, longitude: 20.26, county: "Västerbottens län", guessed: true });
  mode = "abroad";
  assert.equal((await geo.region({ latitude: 55.68, longitude: 12.57 })).guessed, true);
  mode = "municipality";
  const osby = await geo.region({ latitude: 56.38, longitude: 14 });
  assert.deepEqual([osby.guessed, osby.municipality, osby.county], [true, "Osby kommun", nearestCounty(osby)], "municipality kept, county guessed");
  await assert.rejects(geo.region({ latitude: 91, longitude: 0 }), RangeError);
  mode = "ok";
  await assert.rejects(geo.region({ latitude: 57, longitude: 15 }, { signal: AbortSignal.abort() }));
});
