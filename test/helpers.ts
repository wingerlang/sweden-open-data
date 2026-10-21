/** Test helpers: a scripted `fetch` and source-format fixtures. */

/** A scripted `fetch`. The handler returns a `Response`, a value to send as JSON, or throws. */
export function fakeFetch(handler: (url: URL, init?: RequestInit) => unknown): typeof fetch & { calls: URL[] } {
  const calls: URL[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    init?.signal?.throwIfAborted();
    const result = await handler(url, init);
    return result instanceof Response ? result : Response.json(result);
  };
  return Object.assign(fn as typeof fetch, { calls });
}

/** Options that make clients deterministic and fast in tests. */
export const quick = { retries: 0, retryDelayMs: 0 } as const;

/** One day of quarter-hour prices as elprisetjustnu.se returns them (local time with offset). */
export function elprisDay(
  date = "2026-10-12",
  price = (i: number): number => 0.3 + 0.5 * Math.sin((i / 96) * Math.PI),
): unknown[] {
  return Array.from({ length: 96 }, (_, i) => {
    const start = new Date(`${date}T00:00:00+02:00`).getTime() + i * 900_000;
    const iso = (t: number): string => new Date(t + 7_200_000).toISOString().replace("Z", "+02:00").replace(".000", "");
    return {
      SEK_per_kWh: Number(price(i).toFixed(5)),
      EUR_per_kWh: Number((price(i) / 11.2).toFixed(5)),
      EXR: 11.2,
      time_start: iso(start),
      time_end: iso(start + 900_000),
    };
  });
}

/** Hourly prices covering a whole Swedish day (23, 24 or 25 hours), as UTC ISO strings. */
export function hourlyDay(from: number, hours: number, price = (i: number): number => (i % 2 ? 1 : -0.5)): unknown[] {
  return Array.from({ length: hours }, (_, i) => ({
    time_start: new Date(from + i * 3_600_000).toISOString(),
    time_end: new Date(from + (i + 1) * 3_600_000).toISOString(),
    SEK_per_kWh: price(i),
    EUR_per_kWh: 0.1,
  }));
}

/** An Open-Meteo forecast response for Stockholm. */
export function openMeteoResponse(): Record<string, unknown> {
  const hours = 48;
  return {
    latitude: 59.33,
    longitude: 18.06,
    timezone: "Europe/Stockholm",
    utc_offset_seconds: 7200,
    current: {
      time: "2026-10-12T14:00",
      temperature_2m: 9.4,
      apparent_temperature: 6.8,
      relative_humidity_2m: 71,
      weather_code: 61,
      wind_speed_10m: 4.2,
      wind_gusts_10m: 9.1,
      precipitation: 0.3,
      is_day: 1,
    },
    hourly: {
      time: Array.from(
        { length: hours },
        (_, i) =>
          `2026-10-${String(12 + Math.floor((i + 12) / 24)).padStart(2, "0")}T${String((i + 12) % 24).padStart(2, "0")}:00`,
      ),
      temperature_2m: Array.from({ length: hours }, (_, i) => (i === 5 ? null : 8 + Math.sin(i / 4) * 3)),
      weather_code: Array(hours).fill(3),
      precipitation: Array(hours).fill(0),
      precipitation_probability: Array(hours).fill(20),
      wind_speed_10m: Array(hours).fill(3),
      is_day: Array.from({ length: hours }, (_, i) => ((i + 12) % 24 > 6 && (i + 12) % 24 < 18 ? 1 : 0)),
    },
    daily: {
      time: ["2026-10-12", "2026-10-13", "2026-10-14"],
      weather_code: [61, 3, 0],
      temperature_2m_max: [11, 12, null],
      temperature_2m_min: [6, 5, 4],
      precipitation_sum: [2.1, 0, 0],
      precipitation_probability_max: [80, 10, 0],
      sunrise: ["2026-10-12T07:18", "2026-10-13T07:20", null],
      sunset: ["2026-10-12T17:56", "2026-10-13T17:53", "2026-10-14T17:50"],
      wind_speed_10m_max: [7, 5, 3],
    },
  };
}

/** Krisinformation.se news items in the API v3 format. */
export const KRIS_NEWS: unknown[] = [
  {
    Identifier: "a1",
    Headline: "Brand i Hässleholm",
    Preamble: "<p>Stäng fönster.</p>",
    Published: "2026-10-12T08:00:00Z",
    Area: [{ Type: "Municipality", Description: "Hässleholms kommun" }],
    Web: "https://www.krisinformation.se/nyheter/a1",
    Event: "News",
  },
  {
    Identifier: "a2",
    Headline: "Vattenläcka i Umeå",
    Preamble: "Koka vattnet.",
    Published: "2026-10-11T08:00:00Z",
    Area: [{ Type: "County", Description: "Västerbottens län" }],
    Web: "https://www.krisinformation.se/nyheter/a2",
  },
  {
    Identifier: "a3",
    Headline: "Gammal nyhet",
    Published: "2026-09-01T08:00:00Z",
    Area: [{ Type: "County", Description: "Skåne län" }],
  },
  {
    Identifier: "a4",
    Headline: "Elbrist i hela landet",
    Published: "2026-10-12T07:00:00Z",
    Area: [{ Type: "Country", Description: "Sverige" }],
    Web: "javascript:alert(1)",
  },
  {
    Identifier: "a5",
    Headline: "Utsläpp vid Kristianstad",
    Published: "2026-10-12T09:00:00Z",
    Area: [{ Type: "Other", Description: "Kristianstad", Coordinate: "56.03,14.15" }],
  },
];

/** A square polygon around a point, `[lon, lat]` rings. */
export const square = (lon: number, lat: number, d = 0.5): number[][][] => [
  [
    [lon - d, lat - d],
    [lon + d, lat - d],
    [lon + d, lat + d],
    [lon - d, lat + d],
    [lon - d, lat - d],
  ],
];

/** SMHI warnings in the IBWW format. */
export const SMHI_WARNINGS: unknown[] = [
  {
    id: 1,
    event: { sv: "Vind", code: "WIND" },
    warningAreas: [
      {
        id: 11,
        approximateStart: "2026-10-12T06:00:00Z",
        approximateEnd: "2026-10-13T06:00:00Z",
        published: "2026-10-11T12:00:00Z",
        areaName: { sv: "Nordöstra Skåne" },
        warningLevel: { sv: "Gul", code: "YELLOW" },
        eventDescription: { sv: "Mycket hårda vindbyar" },
        affectedAreas: [{ id: 1293, sv: "Hässleholm" }, { sv: "Skåne län" }, { sv: "Osby kommun" }],
        descriptions: [{ title: { sv: "Vad händer" }, text: { sv: "Vindbyar upp till 25 m/s." } }],
        area: {
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: square(14, 56.1) } }],
        },
      },
      {
        id: 12,
        approximateEnd: "2026-10-11T06:00:00Z",
        warningLevel: { code: "ORANGE" },
        eventDescription: { sv: "Gammal" },
      },
      {
        id: 13,
        approximateEnd: "2026-10-13T06:00:00Z",
        warningLevel: { code: "ORANGE" },
        eventDescription: { sv: "Snöfall" },
        areaName: { sv: "Lappland" },
        area: { type: "GeometryCollection", geometries: [{ type: "MultiPolygon", coordinates: [square(18, 67)] }] },
      },
      { id: 14, warningLevel: "message", eventDescription: { sv: "Info" } },
      { warningLevel: { code: "RED" }, eventDescription: { sv: "Utan id" } },
    ],
  },
  { id: 2 },
];

/** A Photon feature. */
export function photonFeature(lon: number, lat: number, properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties };
}
