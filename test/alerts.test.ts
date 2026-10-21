import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertPlaces,
  createAlertsClient,
  freshAlerts,
  parseKrisinformation,
  parsePoint,
  parseSmhiWarnings,
  relevantAlerts,
} from "../src/alerts/mod.ts";
import { SourceError } from "../src/core/errors.ts";
import { fakeFetch, KRIS_NEWS, quick, SMHI_WARNINGS, square } from "./helpers.ts";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const vinslov = { latitude: 56.1, longitude: 13.91, county: "Skåne län", municipality: "Hässleholms kommun" };
const umea = { latitude: 63.83, longitude: 20.26, county: "Västerbottens län", municipality: "Umeå kommun" };
const vxo = { latitude: 56.88, longitude: 14.81, county: "Kronobergs län" };

test("Krisinformation: defensive parsing, safe links, VMA detection", () => {
  const k = parseKrisinformation(KRIS_NEWS, "news");
  assert.equal(k.length, 5);
  assert.equal(k[0].summary, "Stäng fönster.");
  assert.equal(k[0].areas[0].type, "municipality");
  assert.equal(k[1].areas[0].type, "county");
  assert.equal(k[3].areas[0].type, "country");
  assert.equal(k[3].url, "https://www.krisinformation.se", "unsafe link replaced");
  assert.deepEqual(k[4].areas[0].point, { latitude: 56.03, longitude: 14.15 });
  assert.equal(k[4].areas[0].type, "other");
  assert.equal(parseKrisinformation({ nope: 1 }, "news").length, 0);
  assert.equal(parseKrisinformation({ items: "x" }, "news").length, 0);
  assert.equal(parseKrisinformation([{ Headline: "no id" }], "news").length, 0);
  assert.equal(
    parseKrisinformation({ Entries: [{ Id: "e", Title: "Wrapped", Area: { Name: "Hela landet" } }] }, "news")[0]
      .areas[0].type,
    "country",
  );
  const v = parseKrisinformation(
    [
      {
        Identifier: "v1",
        Headline: "VMA: Gå inomhus",
        Area: [{ Type: "County", Description: "Skåne län" }, { Description: "" }],
      },
    ],
    "vma",
  );
  assert.equal(v[0].kind, "vma");
  assert.equal(v[0].level, "red");
  assert.equal(v[0].areas.length, 1);
  assert.equal(parseKrisinformation([{ Identifier: "n", Headline: "x", Event: "Alert" }], "news")[0].kind, "vma");
  const named = parseKrisinformation(
    [
      {
        Identifier: "m",
        Headline: "x",
        Area: [{ Description: "Malmö kommun" }, { Description: "Hallands län" }, { Description: "Oklart" }],
      },
    ],
    "news",
  )[0];
  assert.deepEqual(
    named.areas.map((a) => a.type),
    ["municipality", "county", "other"],
  );
  const old = parseKrisinformation(
    [{ Identifier: "old", Headline: "Old", Published: "2026-04-01", Updated: "2026-10-13" }],
    "news",
  );
  assert.equal(old[0].published, "2026-04-01T00:00:00.000Z", "publication date wins over Updated");
  assert.equal(
    parseKrisinformation([{ Identifier: "u", Headline: "x", Updated: "2026-10-13" }], "news")[0].published,
    "2026-10-13T00:00:00.000Z",
  );
});

test("points in every shape sources use", () => {
  assert.deepEqual(parsePoint("56.1,14.0"), { latitude: 56.1, longitude: 14 });
  assert.deepEqual(parsePoint("14.0 56.1"), { latitude: 56.1, longitude: 14 });
  assert.deepEqual(parsePoint("POINT (14.0 56.1)"), { latitude: 56.1, longitude: 14 });
  assert.deepEqual(parsePoint({ lat: 56, lon: 14 }), { latitude: 56, longitude: 14 });
  assert.deepEqual(parsePoint({ Latitude: 56, Longitude: 14 }), { latitude: 56, longitude: 14 });
  assert.equal(parsePoint("56"), undefined);
  assert.equal(parsePoint("500 600"), undefined);
  assert.equal(parsePoint(undefined), undefined);
  assert.equal(parsePoint({ lat: "x" }), undefined);
});

test("SMHI: one alert per area, expired skipped, polygons from every GeoJSON shape, localised titles", () => {
  const w = parseSmhiWarnings(SMHI_WARNINGS, { now: NOW });
  assert.deepEqual(
    w.map((a) => a.id),
    ["smhi:11", "smhi:13", "smhi:14"],
  );
  assert.equal(w[0].level, "yellow");
  assert.equal(w[0].title, "Gul varning: Mycket hårda vindbyar – Nordöstra Skåne");
  assert.equal(w[0].summary, "Vindbyar upp till 25 m/s.");
  assert.deepEqual(
    w[0].areas.map((a) => a.type),
    ["other", "county", "municipality"],
  );
  assert.equal(w[0].start, "2026-10-12T06:00:00.000Z");
  assert.equal(w[1].polygons?.length, 1, "MultiPolygon inside a GeometryCollection");
  assert.equal(w[2].level, "message");
  assert.equal(w[2].title, "Meddelande: Info");
  assert.equal(w[2].summary, "");
  assert.equal(
    parseSmhiWarnings(SMHI_WARNINGS, { now: NOW, locale: "en" })[0].title,
    "Yellow warning: Mycket hårda vindbyar – Nordöstra Skåne",
  );
  assert.equal(parseSmhiWarnings("broken").length, 0);
  assert.equal(
    parseSmhiWarnings(
      [
        {
          id: 1,
          warningAreas: [
            {
              id: 2,
              eventDescription: "Regn",
              area: { type: "Feature", geometry: { type: "Polygon", coordinates: square(1, 1) } },
            },
          ],
        },
      ],
      { now: NOW },
    )[0].level,
    "yellow",
    "no level given",
  );
  assert.equal(
    parseSmhiWarnings(
      [
        {
          id: 1,
          warningAreas: [{ id: 2, eventDescription: "x", warningLevel: { code: "PURPLE" }, area: { type: "Point" } }],
        },
      ],
      { now: NOW },
    )[0].level,
    "message",
  );
});

test("relevance: places, national alerts, neighbouring counties and ordering", () => {
  const vma = parseKrisinformation(
    [
      {
        Identifier: "v1",
        Headline: "VMA Skåne",
        Area: [{ Type: "County", Description: "Skåne län" }],
        Published: "2026-10-12T09:30:00Z",
      },
    ],
    "vma",
  );
  const items = [
    ...parseKrisinformation(KRIS_NEWS, "news"),
    ...parseSmhiWarnings(SMHI_WARNINGS, { now: NOW }),
    ...vma,
    ...vma,
  ];
  const r = relevantAlerts(items, [vinslov], { now: NOW });
  assert.deepEqual(
    r.map((i) => i.id),
    ["kris:v1", "smhi:11", "kris:a5", "kris:a1", "kris:a4"],
    "duplicates removed, VMA and warnings first",
  );
  const national = r.find((i) => i.id === "kris:a4")!;
  assert.equal(national.national, true);
  assert.deepEqual(national.areas, ["Sverige"]);
  assert.ok(!("polygons" in r[1]));
  const both = relevantAlerts(items, [vinslov, umea], { now: NOW });
  assert.deepEqual(both.find((i) => i.id === "kris:a2")!.places, [1]);
  assert.deepEqual(both.find((i) => i.id === "kris:a1")!.places, [0]);
  assert.deepEqual(both.find((i) => i.id === "kris:a4")!.places, [0, 1]);
  assert.equal(
    relevantAlerts(items, [vinslov], { now: NOW, days: 60 }).some((i) => i.id === "kris:a3"),
    false,
    "days is capped at 30",
  );

  const skane = parseKrisinformation(
    [
      {
        Identifier: "s",
        Headline: "Skåne",
        Published: "2026-10-12T08:00:00Z",
        Area: [{ Type: "County", Description: "Skåne län" }],
      },
    ],
    "news",
  );
  assert.equal(relevantAlerts(skane, [vxo], { now: NOW }).length, 0);
  assert.equal(relevantAlerts(skane, [vxo], { now: NOW, neighbors: true }).length, 1, "Skåne borders Kronoberg");
  assert.equal(
    relevantAlerts(skane, [{ latitude: 59, longitude: 18 }], { now: NOW, neighbors: true }).length,
    0,
    "no county known",
  );

  const other = parseKrisinformation(
    [
      {
        Identifier: "o",
        Headline: "x",
        Published: "2026-10-12T08:00:00Z",
        Area: [{ Type: "Other", Description: "Hässleholm" }],
      },
    ],
    "news",
  )[0];
  assert.deepEqual(alertPlaces(other, [vinslov]).places, [0], "an 'other' area matching the municipality");
  const near = parseKrisinformation(KRIS_NEWS, "news")[4];
  assert.deepEqual(alertPlaces(near, [vinslov], { radiusKm: 5 }).places, [], "outside a smaller radius");

  const ended = [{ ...skane[0], id: "e", end: "2026-10-11T00:00:00Z" }];
  assert.equal(relevantAlerts(ended, [vinslov], { now: NOW }).length, 0);
  const noDate = [{ ...skane[0], id: "nd", published: "" }];
  assert.equal(relevantAlerts(noDate, [vinslov], { now: NOW }).length, 0);
  const emptyMessage = parseSmhiWarnings(
    [
      {
        id: 9,
        warningAreas: [
          { id: 99, warningLevel: { code: "MESSAGE" }, eventDescription: "x", published: "2026-10-12T08:00:00Z" },
        ],
      },
    ],
    { now: NOW },
  );
  assert.equal(relevantAlerts(emptyMessage, [vinslov], { now: NOW }).length, 0, "an SMHI message without any area");
});

test("freshness: old publications never resurface, upcoming warnings stay", () => {
  const now = Date.parse("2026-10-13T12:00Z");
  const recent = [
    { published: "2026-10-12" },
    { published: "2026-10-04" },
    { published: "2026-10-12", end: "2026-10-12T23:00Z" },
  ];
  assert.equal(freshAlerts(recent, { now }).length, 1);
  assert.equal(freshAlerts(recent, { days: 14, now }).length, 2);
  assert.equal(freshAlerts([{ start: "2026-10-15T12:00Z", end: "2026-10-16T12:00Z" }], { now }).length, 1);
  assert.equal(
    freshAlerts([{ published: "2026-10-20" }], { now }).length,
    0,
    "a publication date in the future is not trusted",
  );
  assert.equal(freshAlerts([{}], { now }).length, 0);
  assert.equal(freshAlerts([{ published: new Date().toISOString() }]).length, 1);
  assert.equal(freshAlerts(recent, { days: NaN, now }).length, 1);
});

test("client: feeds fail independently, regions are looked up once, inputs validated", async () => {
  const fetch = fakeFetch((url) => {
    if (url.pathname.endsWith("/vmas")) return new Response("down", { status: 500 });
    if (url.pathname.endsWith("/news")) return KRIS_NEWS;
    if (url.pathname.endsWith("warning.json")) return SMHI_WARNINGS;
    if (url.pathname.endsWith("/reverse"))
      return { features: [{ properties: { state: "Skåne län", county: "Hässleholms kommun", city: "Vinslöv" } }] };
    return new Response("", { status: 404 });
  });
  const client = createAlertsClient({ fetch, now: () => NOW, ...quick });
  const r = await client.near([{ latitude: 56.1, longitude: 13.91 }]);
  assert.deepEqual(r.places, [
    { latitude: 56.1, longitude: 13.91, county: "Skåne län", municipality: "Hässleholms kommun", locality: "Vinslöv" },
  ]);
  assert.deepEqual(
    r.alerts.map((i) => i.id),
    ["smhi:11", "kris:a5", "kris:a1", "kris:a4"],
  );
  assert.deepEqual(
    r.sources.map((s) => s.ok),
    [false, true, true],
  );
  await client.near([{ latitude: 56.1, longitude: 13.91 }]);
  await client.near([vinslov]);
  assert.equal(fetch.calls.filter((c) => c.pathname.endsWith("/reverse")).length, 1);
  assert.equal(fetch.calls.filter((c) => c.pathname.endsWith("warning.json")).length, 1, "feeds are cached");
  await assert.rejects(client.near([]), RangeError);
  await assert.rejects(client.near([{ latitude: 100, longitude: 0 }]), RangeError);
  await assert.rejects(client.near(Array(21).fill(vinslov)), RangeError);
  const feed = await client.feed();
  assert.equal(feed.alerts.length, 8);

  const english = createAlertsClient({ fetch, now: () => NOW, locale: "en", ...quick });
  assert.match((await english.near([vinslov])).alerts[0].title, /^Yellow warning/);
});

test("client: every feed down is an error", async () => {
  const down = createAlertsClient({ fetch: fakeFetch(() => new Response("", { status: 503 })), ...quick });
  await assert.rejects(down.feed(), (e: SourceError) => e instanceof SourceError && e.status === 503);
  const odd = createAlertsClient({ fetch: fakeFetch(() => Promise.reject("not an error")), ...quick });
  await assert.rejects(odd.feed(), SourceError);
});
