/**
 * Test helpers: a fake of every source, so you can test code that uses this package – and run the dev board –
 * without network access, plus fault injection to see how your code behaves when a source is slow or down.
 *
 * ```ts
 * import { createClient } from "@wingerlang/sweden-open-data";
 * import { createFakeSources } from "@wingerlang/sweden-open-data/testing";
 *
 * const fake = createFakeSources();
 * const se = createClient({ fetch: fake.fetch, retries: 0 });
 * await se.spot.prices("SE3");                 // realistic prices for today, no network
 *
 * fake.setFault("open-meteo", { status: 503 }); // now the weather source is down
 * ```
 *
 * The data is generated, plausible and deterministic for a given day. It is meant for tests and demos – never
 * show it as real data.
 *
 * @module
 */
import { addDays, stockholmDateTime, stockholmMidnight, swedishDate } from "./core/time.ts";
import { type Coordinates, distanceKm, fold } from "./core/geo.ts";

/** The sources, named as in a request event's `source`. */
export type SourceId =
  | "elprisetjustnu"
  | "open-meteo"
  | "open-meteo-geocoding"
  | "photon"
  | "krisinformation"
  | "smhi"
  | "biluppgifter"
  | "scb"
  | "open-meteo-archive"
  | "open-meteo-air-quality"
  | "ibindex"
  | "transportstyrelsen"
  | "yahoo"
  | "nasdaq"
  | "fred"
  | "mfn"
  | "handelsbanken";

/** All sources. */
export const SOURCE_IDS: readonly SourceId[] = Object.freeze([
  "elprisetjustnu",
  "open-meteo",
  "open-meteo-geocoding",
  "photon",
  "krisinformation",
  "smhi",
  "biluppgifter",
  "scb",
  "open-meteo-archive",
  "open-meteo-air-quality",
  "ibindex",
  "transportstyrelsen",
  "yahoo",
  "nasdaq",
  "fred",
  "mfn",
  "handelsbanken",
] as const);

/** Which source a URL belongs to, by host name; `undefined` for anything else. */
export function sourceOf(url: string | URL): SourceId | undefined {
  const host = new URL(String(url)).hostname;
  if (host.endsWith(".yahoo.com")) return "yahoo";
  if (host === "indexes.nasdaqomx.com") return "nasdaq";
  if (host === "fred.stlouisfed.org") return "fred";
  if (host === "mfn.se" || host === "feed.mfn.se") return "mfn";
  if (host.endsWith("elprisetjustnu.se")) return "elprisetjustnu";
  if (host === "geocoding-api.open-meteo.com") return "open-meteo-geocoding";
  if (host === "archive-api.open-meteo.com") return "open-meteo-archive";
  if (host === "air-quality-api.open-meteo.com") return "open-meteo-air-quality";
  if (host.endsWith("open-meteo.com")) return "open-meteo";
  if (host.includes("photon")) return "photon";
  if (host.endsWith("krisinformation.se")) return "krisinformation";
  if (host.endsWith("smhi.se")) return "smhi";
  if (host === "api.biluppgifter.se") return "biluppgifter";
  if (host.endsWith("scb.se")) return "scb";
  if (host === "ibindex.se") return "ibindex";
  if (host === "www.handelsbanken.se") return "handelsbanken";
  if (host.endsWith("transportstyrelsen.se")) return "transportstyrelsen";
  return undefined;
}

/** A simulated problem with a source. */
export interface Fault {
  /** Wait this long before answering. */
  delayMs?: number;
  /** Answer with this HTTP status (for example 503) instead of data. */
  status?: number;
  /** Seconds to send in `Retry-After` together with `status`. */
  retryAfter?: number;
  /** Never answer (until the request is aborted, for example by the client's timeout). */
  hang?: boolean;
  /** Fail as if the network were down. */
  offline?: boolean;
  /** Answer 200 with a body that is not JSON. */
  invalidJson?: boolean;
  /** Fail only this share of requests, 0–1. Default `1` (always). */
  rate?: number;
}

/** A `fetch` wrapper with per-source faults. */
export interface FaultyFetch {
  /** Use as the client's `fetch`. */
  readonly fetch: typeof fetch;
  /** Every requested URL, in order. */
  readonly calls: URL[];
  /** Sets (or with `null` clears) the fault for a source. */
  setFault(source: SourceId, fault: Fault | null): void;
  /** The current faults. */
  faults(): Partial<Record<SourceId, Fault>>;
  /** Clears all faults and the call log. */
  reset(): void;
}

const wait = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * Wraps any `fetch` (the real one, or the fake from {@link createFakeSources}) so that faults can be switched on per
 * source while the program runs.
 */
export function withFaults(inner: typeof fetch, random: () => number = Math.random): FaultyFetch {
  let faults: Partial<Record<SourceId, Fault>> = {};
  const calls: URL[] = [];
  const faulty = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    const source = sourceOf(url);
    const fault = source ? faults[source] : undefined;
    if (fault && random() < (fault.rate ?? 1)) {
      if (fault.delayMs) await wait(fault.delayMs, init?.signal);
      if (fault.hang) {
        await wait(2 ** 31 - 1, init?.signal);
      }
      if (fault.offline) throw new TypeError("fetch failed (simulated network error)");
      if (fault.status) {
        return new Response(`simulated ${fault.status}`, {
          status: fault.status,
          headers: fault.retryAfter === undefined ? {} : { "retry-after": String(fault.retryAfter) },
        });
      }
      if (fault.invalidJson) return new Response("<html>simulated maintenance page</html>", { status: 200 });
    }
    return inner(input, init);
  };
  return {
    fetch: faulty as typeof fetch,
    calls,
    setFault(source, fault) {
      if (fault) faults[source] = fault;
      else delete faults[source];
    },
    faults: () => ({ ...faults }),
    reset() {
      faults = {};
      calls.length = 0;
    },
  };
}

// --- Generated data -------------------------------------------------------------------------------------------

/** Deterministic pseudo-random numbers 0–1 from a string. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const AREA_LEVEL: Record<string, number> = { SE1: 0.25, SE2: 0.3, SE3: 0.75, SE4: 1.05 };

/**
 * A day of spot prices in the elprisetjustnu.se format: quarter-hour prices with a morning and an evening peak,
 * higher in the south. Deterministic per area and date; 23/25 intervals-per-hour days are handled.
 */
export function fakeSpotDay(area: string, date: string): Record<string, unknown>[] {
  const random = seeded(area + date);
  const level = (AREA_LEVEL[area] ?? 0.7) * (0.7 + random() * 0.6);
  const from = stockholmMidnight(date);
  const to = stockholmMidnight(addDays(date, 1));
  const out: Record<string, unknown>[] = [];
  for (let t = from; t < to; t += 900_000) {
    const hour = Number(stockholmDateTime(t).slice(11, 13)) + Number(stockholmDateTime(t).slice(14, 16)) / 60;
    const peaks = 0.55 * Math.exp(-((hour - 8) ** 2) / 4) + 0.75 * Math.exp(-((hour - 18.5) ** 2) / 5);
    const sek = Math.round(level * (0.45 + peaks + (random() - 0.5) * 0.12) * 100000) / 100000;
    const iso = (ms: number): string => {
      const local = stockholmDateTime(ms);
      const offset = Math.round((Date.parse(local + "Z") - ms) / 3_600_000);
      return `${local}+0${offset}:00`;
    };
    out.push({
      SEK_per_kWh: sek,
      EUR_per_kWh: Math.round((sek / 11.4) * 100000) / 100000,
      EXR: 11.4,
      time_start: iso(t),
      time_end: iso(t + 900_000),
    });
  }
  return out;
}

/** An Open-Meteo forecast response for a position: 7 days of hourly and daily data from the current hour. */
export function fakeForecast(position: Coordinates, now: number = Date.now()): Record<string, unknown> {
  const random = seeded(`${position.latitude.toFixed(1)},${position.longitude.toFixed(1)}:${swedishDate(now)}`);
  const base =
    22 -
    Math.abs(position.latitude - 45) * 0.6 +
    Math.sin(((Number(swedishDate(now).slice(5, 7)) - 4) / 12) * 2 * Math.PI) * 9;
  const local = (ms: number): string => stockholmDateTime(ms).slice(0, 16);
  const offset = Math.round((Date.parse(stockholmDateTime(now) + "Z") - now) / 3_600_000) * 3600;
  const hour0 = Math.floor(now / 3_600_000) * 3_600_000;
  const codes = [0, 1, 2, 3, 3, 61, 63, 80, 3, 2];
  const hours = Array.from({ length: 168 }, (_, i) => {
    const t = hour0 + i * 3_600_000;
    const h = Number(stockholmDateTime(t).slice(11, 13));
    const temperature =
      Math.round((base + 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + (random() - 0.5) * 2) * 10) / 10;
    const code = codes[Math.floor(random() * codes.length)];
    return { t, h, temperature, code, rain: code >= 61 ? Math.round(random() * 20) / 10 : 0 };
  });
  const days = Array.from({ length: 7 }, (_, d) => {
    const slice = hours.slice(d * 24, d * 24 + 24);
    const date = swedishDate(hour0, d);
    return {
      date,
      max: Math.max(...slice.map((x) => x.temperature)),
      min: Math.min(...slice.map((x) => x.temperature)),
      code: slice[12]?.code ?? 3,
      rain: Math.round(slice.reduce((a, x) => a + x.rain, 0) * 10) / 10,
      sunrise: local(stockholmMidnight(date) + 7 * 3_600_000),
      sunset: local(stockholmMidnight(date) + 17 * 3_600_000),
    };
  });
  const current = hours[0];
  return {
    latitude: position.latitude,
    longitude: position.longitude,
    timezone: "Europe/Stockholm",
    utc_offset_seconds: offset,
    current: {
      time: local(now),
      temperature_2m: current.temperature,
      apparent_temperature: Math.round((current.temperature - 2.5) * 10) / 10,
      relative_humidity_2m: 70,
      weather_code: current.code,
      wind_speed_10m: 4.2,
      wind_gusts_10m: 9.5,
      precipitation: current.rain,
      is_day: current.h >= 7 && current.h < 18 ? 1 : 0,
    },
    hourly: {
      time: hours.map((x) => local(x.t)),
      temperature_2m: hours.map((x) => x.temperature),
      weather_code: hours.map((x) => x.code),
      precipitation: hours.map((x) => x.rain),
      precipitation_probability: hours.map((x) => (x.rain ? 70 : 10)),
      wind_speed_10m: hours.map(() => 4),
      is_day: hours.map((x) => (x.h >= 7 && x.h < 18 ? 1 : 0)),
    },
    daily: {
      time: days.map((d) => d.date),
      weather_code: days.map((d) => d.code),
      temperature_2m_max: days.map((d) => d.max),
      temperature_2m_min: days.map((d) => d.min),
      precipitation_sum: days.map((d) => d.rain),
      precipitation_probability_max: days.map((d) => (d.rain ? 70 : 10)),
      sunrise: days.map((d) => d.sunrise),
      sunset: days.map((d) => d.sunset),
      wind_speed_10m_max: days.map(() => 7),
    },
  };
}

/** A small gazetteer used by the fake geocoders. */
export const FAKE_PLACES: readonly {
  name: string;
  county: string;
  municipality: string;
  latitude: number;
  longitude: number;
  postcode: string;
}[] = Object.freeze([
  {
    name: "Stockholm",
    county: "Stockholms län",
    municipality: "Stockholms kommun",
    latitude: 59.33,
    longitude: 18.07,
    postcode: "111 52",
  },
  {
    name: "Göteborg",
    county: "Västra Götalands län",
    municipality: "Göteborgs kommun",
    latitude: 57.71,
    longitude: 11.97,
    postcode: "411 03",
  },
  {
    name: "Malmö",
    county: "Skåne län",
    municipality: "Malmö kommun",
    latitude: 55.6,
    longitude: 13.0,
    postcode: "211 20",
  },
  {
    name: "Uppsala",
    county: "Uppsala län",
    municipality: "Uppsala kommun",
    latitude: 59.86,
    longitude: 17.64,
    postcode: "753 20",
  },
  {
    name: "Vinslöv",
    county: "Skåne län",
    municipality: "Hässleholms kommun",
    latitude: 56.1,
    longitude: 13.91,
    postcode: "288 31",
  },
  {
    name: "Åraslöv",
    county: "Skåne län",
    municipality: "Hässleholms kommun",
    latitude: 56.05,
    longitude: 14.02,
    postcode: "291 95",
  },
  {
    name: "Umeå",
    county: "Västerbottens län",
    municipality: "Umeå kommun",
    latitude: 63.83,
    longitude: 20.26,
    postcode: "903 26",
  },
  {
    name: "Kiruna",
    county: "Norrbottens län",
    municipality: "Kiruna kommun",
    latitude: 67.86,
    longitude: 20.23,
    postcode: "981 31",
  },
]);

const FAKE_STREETS: readonly { street: string; house: string; place: string }[] = [
  { street: "Drottninggatan", house: "1", place: "Stockholm" },
  { street: "Kungsgatan", house: "12", place: "Göteborg" },
  { street: "Stortorget", house: "3", place: "Malmö" },
  { street: "Storgatan", house: "5", place: "Umeå" },
];

const feature = (lon: number, lat: number, properties: Record<string, unknown>): Record<string, unknown> => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { countrycode: "SE", ...properties },
});

function photonSearch(q: string, layers: string[]): Record<string, unknown> {
  const query = fold(q);
  const words = query.match(/[a-z]{2,}/g) ?? [];
  const streets = layers.length
    ? []
    : FAKE_STREETS.filter((s) => words.some((w) => fold(s.street).startsWith(w))).map((s) => {
        const p = FAKE_PLACES.find((x) => x.name === s.place) as (typeof FAKE_PLACES)[number];
        return feature(p.longitude + 0.002, p.latitude + 0.001, {
          street: s.street,
          housenumber: s.house,
          city: p.name,
          postcode: p.postcode,
          name: s.street,
        });
      });
  const places = FAKE_PLACES.filter((p) =>
    words.some((w) => fold(p.name).startsWith(w) || fold(p.postcode).replace(/\s/g, "") === w),
  ).map((p) =>
    feature(p.longitude, p.latitude, {
      name: p.name,
      city: p.name === "Åraslöv" ? p.municipality : p.name,
      state: p.county,
      postcode: p.postcode,
    }),
  );
  return { type: "FeatureCollection", features: [...streets, ...places] };
}

function photonReverse(lat: number, lon: number): Record<string, unknown> {
  const here = { latitude: lat, longitude: lon };
  const nearest = [...FAKE_PLACES].sort((a, b) => distanceKm(here, a) - distanceKm(here, b))[0];
  if (distanceKm(here, nearest) > 150) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      feature(nearest.longitude, nearest.latitude, {
        name: nearest.name,
        city: nearest.name,
        county: nearest.municipality,
        state: nearest.county,
      }),
    ],
  };
}

/** VMA and news in the Krisinformation.se v3 format, published relative to `now`. */
export function fakeKrisinformation(feed: "vma" | "news", now: number = Date.now()): Record<string, unknown>[] {
  const ago = (hours: number): string => new Date(now - hours * 3_600_000).toISOString();
  if (feed === "vma") return [];
  return [
    {
      Identifier: "demo-1",
      Headline: "Exempel: Vattenläcka i Hässleholm",
      Preamble: "Demodata. Koka dricksvattnet tills vidare.",
      Published: ago(5),
      Area: [{ Type: "Municipality", Description: "Hässleholms kommun" }],
      Web: "https://www.krisinformation.se",
    },
    {
      Identifier: "demo-2",
      Headline: "Exempel: Störningar i mobilnätet",
      Preamble: "Demodata. Det kan vara svårt att ringa 112 i delar av landet.",
      Published: ago(30),
      Area: [{ Type: "Country", Description: "Sverige" }],
      Web: "https://www.krisinformation.se",
    },
    {
      Identifier: "demo-3",
      Headline: "Exempel: Skogsbrand nära Umeå",
      Preamble: "Demodata. Håll dörrar och fönster stängda.",
      Published: ago(50),
      Area: [{ Type: "County", Description: "Västerbottens län" }],
      Web: "https://www.krisinformation.se",
    },
  ];
}

/** SMHI warnings in the IBWW format: one yellow wind warning over north-eastern Skåne. */
export function fakeSmhiWarnings(now: number = Date.now()): Record<string, unknown>[] {
  const square = [
    [
      [13.4, 55.8],
      [14.6, 55.8],
      [14.6, 56.5],
      [13.4, 56.5],
      [13.4, 55.8],
    ],
  ];
  return [
    {
      id: 1,
      event: { sv: "Vind", en: "Wind" },
      warningAreas: [
        {
          id: 101,
          approximateStart: new Date(now - 2 * 3_600_000).toISOString(),
          approximateEnd: new Date(now + 20 * 3_600_000).toISOString(),
          published: new Date(now - 6 * 3_600_000).toISOString(),
          areaName: { sv: "Nordöstra Skåne" },
          warningLevel: { sv: "Gul", code: "YELLOW" },
          eventDescription: { sv: "Mycket hårda vindbyar" },
          affectedAreas: [{ sv: "Hässleholm" }, { sv: "Kristianstad" }],
          descriptions: [{ title: { sv: "Vad händer" }, text: { sv: "Demodata. Vindbyar upp till 25 m/s." } }],
          area: {
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: square } }],
          },
        },
      ],
    },
  ];
}

/**
 * Hourly temperatures in the Open-Meteo archive format (`timeformat=unixtime`) for `from`–`to`, with a daily cycle.
 * Demo data – never real observations.
 */
export function fakeWeatherArchive(position: Coordinates, from: string, to: string): Record<string, unknown> {
  const start = Date.parse(from + "T00:00:00Z") / 1000;
  const hours = Math.max(
    0,
    Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 3_600_000) + 24,
  );
  const base = 8 - (position.latitude - 55) * 1.2;
  const temperature = (t: number): number => {
    const day = t / 86_400;
    const season = -10 * Math.cos((2 * Math.PI * (day - 15)) / 365.25); // coldest in mid-January
    const weather = 4 * Math.sin(day * 1.7) + 2 * Math.sin(day * 0.6); // changes from day to day
    const daily = 3 * Math.sin((((t / 3600) % 24) - 9) * (Math.PI / 12));
    return Number((base + season + weather + daily).toFixed(1));
  };
  return {
    latitude: position.latitude,
    longitude: position.longitude,
    hourly: {
      time: Array.from({ length: hours }, (_, i) => start + i * 3600),
      temperature_2m: Array.from({ length: hours }, (_, i) => temperature(start + i * 3600)),
    },
  };
}

/**
 * An Open-Meteo / CAMS air-quality answer for the requested `hourly` variables, `days` days from the current hour.
 * Demo data – never a real forecast.
 */
export function fakeAirQuality(
  position: Coordinates,
  variables: string[],
  days: number,
  now: number = Date.now(),
): Record<string, unknown> {
  const start = Math.floor(now / 3_600_000) * 3600;
  const hours = Math.max(1, Math.min(4, days)) * 24;
  const series = (name: string, i: number): number => {
    const day = Math.sin(((i % 24) - 6) * (Math.PI / 12));
    if (name === "uv_index") return Math.max(0, Number((4 * day).toFixed(1)));
    if (name.endsWith("_pollen")) {
      const level =
        { alder: 5, birch: 60, grass: 25, mugwort: 3, olive: 0, ragweed: 1 }[name.replace("_pollen", "")] ?? 0;
      return Math.max(0, Math.round(level * (0.6 + 0.4 * day)));
    }
    if (name === "european_aqi") return 20 + (i % 7);
    return Number((5 + (i % 5) * 0.8).toFixed(1));
  };
  return {
    latitude: position.latitude,
    longitude: position.longitude,
    hourly: Object.fromEntries([
      ["time", Array.from({ length: hours }, (_, i) => start + i * 3600)],
      ...variables.map((name) => [name, Array.from({ length: hours }, (_, i) => series(name, i))]),
    ]),
  };
}

/**
 * IBIndex-format answers for one read endpoint (`companies/getCompanies`, `index/getProducts`, `company/…`), for two
 * invented companies. Demo data – never real prices or holdings.
 */
export function fakeIbindex(path: string, body: unknown, now: number = Date.now()): unknown {
  const companies = [
    { product: "DEMO A", productName: "Demo Investment A", marketWeight: 60 },
    { product: "DEMO B", productName: "Demo Investment B", marketWeight: 40 },
  ];
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  if (path.endsWith("companies/getCompanies")) return companies;
  if (path.endsWith("index/getProducts")) {
    return companies.map((c, i) => ({
      product: c.product,
      price: 200 + 50 * i,
      netAssetValue: 230 + 50 * i,
      netAssetValueCalculated: 225 + 50 * i,
      netAssetValueChangeDate: day - 7 * 86_400_000,
    }));
  }
  if (path.endsWith("company/getChartDataPrice")) {
    return Array.from({ length: 30 }, (_, i) => ({
      date: day - (29 - i) * 86_400_000,
      productPrice: 200 + i,
      netAssetValuePrice: 230 + i,
      netAssetValueCalculatedPrice: 228 + i,
    }));
  }
  if (path.endsWith("company/getHoldings")) {
    return [
      { holdingProduct: "X", holdingName: "Exempel Industri", holdingValue: 600, category: "LST" },
      { holdingProduct: "Y", holdingName: "Exempel Teknik", holdingValue: 400, category: "UNL" },
      { holdingProduct: "", holdingName: "Kassa", holdingValue: 50, category: "C&D" },
    ];
  }
  if (path.endsWith("company/getHoldingsDate")) return day - 30 * 86_400_000;
  if (path.endsWith("company/getNetAssetValue"))
    return { product: body, netAssetValueChangeDate: day - 7 * 86_400_000 };
  return undefined;
}

/**
 * A Transportstyrelsen-style vehicle page for a registration number, with labelled fields only. Explicitly synthetic –
 * never a real vehicle.
 */
export function fakeVehiclePage(registrationNumber: string = "ABC123"): string {
  const field = (label: string, value: string): string => `<p><strong>${label}</strong><br>${value}</p>`;
  return [
    "<html><body>",
    field("Registreringsnummer", registrationNumber),
    field("Fabrikat", "EXEMPEL"),
    field("Handelsbeteckning", "Testmodell"),
    field("Fordonsår", "2021"),
    field("Årsskatt", "1 234 kronor"),
    field("Mätarställning", "48 500 km"),
    field("Besiktas senast", "2027-04-30"),
    "</body></html>",
  ].join("");
}

/** Options for {@link createFakeSources}. */
export interface FakeSourcesOptions {
  /** Clock. Tomorrow's prices are "published" at 13:00 Swedish time. Default `Date.now`. */
  now?: () => number;
  /** Random numbers for {@link Fault.rate}. Default `Math.random`. */
  random?: () => number;
}

/**
 * A fake of every source behind one `fetch`, with fault injection. Unknown URLs answer 404.
 */
export function createFakeSources(options: FakeSourcesOptions = {}): FaultyFetch {
  const now = options.now ?? Date.now;
  const json = (body: unknown): Response => Response.json(body);
  const inner = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const p = url.searchParams;
    switch (sourceOf(url)) {
      case "yahoo": {
        const symbol = decodeURIComponent(url.pathname.split("/").at(-1) || "SYNTH.ST"),
          stamp = Math.floor(now() / 1000);
        if (url.pathname.endsWith("/search"))
          return json({
            quotes: [
              { symbol: "SYNTH.ST", longname: "Synthetic market fixture", exchange: "STO", quoteType: "EQUITY" },
            ],
          });
        if (url.pathname.includes("quoteSummary"))
          return json({
            quoteSummary: { result: [{ price: { symbol, currency: "SEK", regularMarketPrice: { raw: 100 } } }] },
          });
        return json({
          chart: {
            result: [
              {
                meta: { symbol, regularMarketPrice: 100, regularMarketTime: stamp, currency: "SEK" },
                timestamp: [stamp - 86400, stamp],
                indicators: { quote: [{ close: [99, 100] }], adjclose: [{ adjclose: [99, 100] }] },
                events: {},
              },
            ],
          },
        });
      }
      case "nasdaq": {
        const symbol = String(new URLSearchParams(String(init?.body)).get("id") || "OMXS30");
        return json([
          { FPSymbol: symbol, x: now() - 86400000, y: 99 },
          { FPSymbol: symbol, x: now(), y: 100 },
        ]);
      }
      case "fred":
        return new Response(
          `DATE,VALUE\n${new Date(now() - 2 * 86400000).toISOString().slice(0, 10)},99\n${new Date(now() - 86400000).toISOString().slice(0, 10)},100`,
          { headers: { "content-type": "text/csv" } },
        );
      case "mfn":
        return json({ items: [] });
      case "elprisetjustnu": {
        const m = url.pathname.match(/(\d{4})\/(\d{2})-(\d{2})_(SE[1-4])\.json$/);
        if (!m) break;
        const date = `${m[1]}-${m[2]}-${m[3]}`;
        const today = swedishDate(now());
        const published =
          date <= today || (date === swedishDate(now(), 1) && Number(stockholmDateTime(now()).slice(11, 13)) >= 13);
        return published ? json(fakeSpotDay(m[4], date)) : new Response("", { status: 404 });
      }
      case "open-meteo":
        return json(
          fakeForecast({ latitude: Number(p.get("latitude")), longitude: Number(p.get("longitude")) }, now()),
        );
      case "open-meteo-geocoding": {
        const name = fold(p.get("name") ?? "");
        const results = FAKE_PLACES.filter((x) => fold(x.name).startsWith(name)).map((x) => ({
          name: x.name,
          country_code: "SE",
          latitude: x.latitude,
          longitude: x.longitude,
          admin1: x.county,
        }));
        return json({ results });
      }
      case "photon":
        return url.pathname.endsWith("/reverse")
          ? json(photonReverse(Number(p.get("lat")), Number(p.get("lon"))))
          : json(photonSearch(p.get("q") ?? "", p.getAll("layer")));
      case "krisinformation":
        return json(fakeKrisinformation(url.pathname.endsWith("/vmas") ? "vma" : "news", now()));
      case "smhi":
        return json(fakeSmhiWarnings(now()));
      case "biluppgifter":
        return json(fakeVehicleResponse(decodeURIComponent(url.pathname.split("/").at(-1)!)));
      case "open-meteo-archive":
        return json(
          fakeWeatherArchive(
            { latitude: Number(p.get("latitude")), longitude: Number(p.get("longitude")) },
            p.get("start_date") ?? "",
            p.get("end_date") ?? "",
          ),
        );
      case "open-meteo-air-quality":
        return json(
          fakeAirQuality(
            { latitude: Number(p.get("latitude")), longitude: Number(p.get("longitude")) },
            (p.get("hourly") ?? "").split(",").filter(Boolean),
            Number(p.get("forecast_days") ?? 4),
            now(),
          ),
        );
      case "ibindex": {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        const answer = fakeIbindex(url.pathname.replace(/\.req$/, ""), body, now());
        if (answer !== undefined) return json(answer);
        break;
      }
      case "transportstyrelsen": {
        const plate = p.get("Registreringsnummer");
        if (plate) return new Response(fakeVehiclePage(plate), { headers: { "content-type": "text/html" } });
        break;
      }
      case "handelsbanken": {
        if (url.pathname.endsWith("/interestrates")) return json(fakeBankListRates());
        if (url.pathname.endsWith("/averagerates/")) return json(fakeBankAverageRates(now()));
        break;
      }
      case "scb": {
        const m = url.pathname.match(/\/tables\/(TAB\d+)\/data$/);
        const content = p.get("valueCodes[ContentsCode]");
        if (m && m[1] === "TAB5783") return json(fakeMortgageRates(now()));
        if (m && ["TAB1150", "TAB1148"].includes(m[1]))
          return json(fakeHousing(m[1], p.get("valueCodes[Region]") || p.get("valueCodes[Lan]") || "00"));
        if (m && content) return json(fakeScbMonthly(m[1], content, now()));
        break;
      }
    }
    return new Response("not found", { status: 404 });
  };
  return withFaults(inner as typeof fetch, options.random);
}

/** Explicitly synthetic Biluppgifter-format fixture. Never use as a real vehicle record. */
export function fakeVehicleResponse(registrationNumber: string = "ABC123"): Record<string, unknown> {
  return {
    data: {
      attributes: { regno: registrationNumber },
      basic: { data: { make: "Example Motors", model: "Test Tourer", model_year: 2022, vehicle_year: 2021 } },
      status: { data: { tax: 360, first_registered: "2022-01-15" } },
      inspection: {
        data: {
          meter: 48500,
          latest_inspection: "2026-02-01T00:00:00+01:00",
          inspection_valid_until: "2027-04-30T00:00:00+02:00",
        },
      },
    },
  };
}

/**
 * A synthetic SCB JSON-stat answer for a monthly price index: about 2 % a year, 2020 = 100, up to the month before
 * `now`. The KPI tables follow SCB's split at the base change (rebased 1980 figures until 2025, new figures after).
 * Demo data – never real statistics.
 */
export function fakeScbMonthly(table: string, content: string, now: number = Date.now()): Record<string, unknown> {
  const end = new Date(now),
    last = end.getUTCFullYear() * 12 + end.getUTCMonth() - 1;
  const first = table === "TAB6792" || table === "TAB6596" ? 1980 * 12 : 1987 * 12;
  const months = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
  const code = (t: number): string => `${Math.floor(t / 12)}M${String((t % 12) + 1).padStart(2, "0")}`;
  const value = (t: number): number | null => {
    const year = Math.floor(t / 12);
    if (table === "TAB6792" && year >= 2026) return null;
    if (table === "TAB6596" && year < 2026) return null;
    return Number((100 * 1.02 ** ((t - (2020 * 12 + 5.5)) / 12)).toFixed(2));
  };
  return {
    version: "2.0",
    class: "dataset",
    id: ["ContentsCode", "Tid"],
    size: [1, months.length],
    updated: new Date(now).toISOString(),
    dimension: {
      ContentsCode: { category: { index: { [content]: 0 }, label: { [content]: "Demodata" } } },
      Tid: { category: { index: Object.fromEntries(months.map((t, i) => [code(t), i])) } },
    },
    value: months.map(value),
  };
}

/** Synthetic house-price series used only by the fake transport and dev board. */
function fakeHousing(table: string, region: string): Record<string, unknown> {
  const annual = table === "TAB1148",
    dimension = annual ? "Lan" : "Region",
    content = annual ? "BO0501R5" : "BO0501K2",
    periods = annual ? ["2023", "2024", "2025"] : ["2025K1", "2025K2", "2025K3", "2025K4"];
  return {
    id: [dimension, "ContentsCode", "Tid"],
    size: [1, 1, periods.length],
    dimension: {
      [dimension]: { category: { index: { [region]: 0 } } },
      ContentsCode: { category: { index: { [content]: 0 } } },
      Tid: { category: { index: Object.fromEntries(periods.map((period, i) => [period, i])) } },
    },
    value: periods.map((_, i) => 100 + i * 5),
    note: ["Synthetic demo data, not statistics."],
  };
}

/** Synthetic household mortgage rates in SCB's JSON-stat layout; demo data, never statistics. */
export function fakeMortgageRates(now: number = Date.now()): Record<string, unknown> {
  const end = new Date(now),
    last = end.getUTCFullYear() * 12 + end.getUTCMonth() - 2,
    first = 2024 * 12,
    months = Array.from({ length: Math.max(1, last - first + 1) }, (_, i) => first + i),
    bindings = ["1.1.1", "1.1.2.1", "1.1.2.2.1", "1.1.2.2.2", "1.1.2.3"],
    code = (t: number): string => `${Math.floor(t / 12)}M${String((t % 12) + 1).padStart(2, "0")}`;
  return {
    id: ["Referenssektor", "Motpartssektor", "Avtal", "Rantebindningstid", "ContentsCode", "Tid"],
    size: [1, 1, 2, bindings.length, 1, months.length],
    updated: new Date(now).toISOString(),
    dimension: {
      Referenssektor: { category: { index: { "1": 0 } } },
      Motpartssektor: { category: { index: { "2c": 0 } } },
      Avtal: { category: { index: { "0100": 0, "0200": 1 } } },
      Rantebindningstid: { category: { index: Object.fromEntries(bindings.map((b, i) => [b, i])) } },
      ContentsCode: { category: { index: { "000004ZW": 0 } } },
      Tid: { category: { index: Object.fromEntries(months.map((t, i) => [code(t), i])) } },
    },
    value: [0, 1].flatMap((agreement) =>
      bindings.flatMap((_, b) => months.map((_, i) => Number((3 + agreement * 0.3 + b * 0.1 - i * 0.02).toFixed(4)))),
    ),
    note: ["Synthetic demo data, not statistics."],
  };
}

/** Synthetic list rates in the bank page's format; demo data. */
export function fakeBankListRates(): Record<string, unknown> {
  return {
    interestRates: [
      ["3", "3", 3.94],
      ["4", "1", 3.69],
      ["4", "3", 3.99],
      ["4", "5", 4.19],
    ].map(([periodBasisType, term, value]) => ({
      periodBasisType,
      term,
      rateValue: { value: String(value).replace(".", ","), valueRaw: value },
      effectiveRateValue: { valueRaw: Number(value) + 0.07 },
    })),
  };
}

/** Synthetic monthly average rates for the last three months; demo data. */
export function fakeBankAverageRates(now: number = Date.now()): Record<string, unknown> {
  const end = new Date(now);
  return {
    averageRatePeriods: [3, 2, 1].map((back, i) => {
      const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back, 1));
      return {
        period: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
        rates: [
          { periodBasisType: "3", term: "3", rateValue: { valueRaw: 2.6 + i * 0.01 } },
          { periodBasisType: "4", term: "1", rateValue: { valueRaw: 2.85 } },
        ],
      };
    }),
  };
}
