# sweden-open-data

[![JSR](https://jsr.io/badges/@wingerlang/sweden-open-data)](https://jsr.io/@wingerlang/sweden-open-data)
[![JSR score](https://jsr.io/badges/@wingerlang/sweden-open-data/score)](https://jsr.io/@wingerlang/sweden-open-data)
[![CI](https://github.com/wingerlang/sweden-open-data/actions/workflows/ci.yml/badge.svg)](https://github.com/wingerlang/sweden-open-data/actions/workflows/ci.yml)

Swedish open data in one small, typed, dependency-free package:

| Area | What you get | Source |
|---|---|---|
| **Electricity** | Spot prices per price area (SE1–SE4), today, tomorrow and history; summaries, cheapest windows, price levels | [elprisetjustnu.se](https://www.elprisetjustnu.se) (Nord Pool day-ahead) |
| **Weather** | Current conditions, 7-day hourly and daily forecast, weather codes in Swedish and English | [Open-Meteo](https://open-meteo.com) |
| **Alerts** | VMA, news from authorities and SMHI weather warnings that concern *your* places | [Krisinformation.se](https://www.krisinformation.se), [SMHI](https://www.smhi.se) |
| **Geo** | Address search that handles Swedish rural addresses, place search, county and municipality for a position | [Photon](https://photon.komoot.io) (OpenStreetMap), Open-Meteo geocoding |

No API keys. (Free does not always mean free for any use – see [Data and attribution](#data-and-attribution).) Works in Node.js, Deno, Bun and the browser (where the source allows CORS – see [Runtimes](#runtimes)).

The client takes care of what production code needs: caching with sensible lifetimes, sharing of concurrent identical
requests, timeouts, retries with backoff for transient failures, cancellation, typed errors, and rounding of positions
to about 1 km before they leave your system.

```ts
import { createClient } from "@wingerlang/sweden-open-data";

const se = createClient();

const { today, tomorrow } = await se.spot.prices("SE3");
const forecast = await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
const { alerts } = await se.alerts.near([{ latitude: 59.33, longitude: 18.07 }]);
const [address] = await se.geo.addresses("Åraslöv 1105, 28890 Vinslöv");
```

## Install

```sh
npx jsr add @wingerlang/sweden-open-data     # Node.js (npm, pnpm and yarn work too)
deno add jsr:@wingerlang/sweden-open-data    # Deno
bunx jsr add @wingerlang/sweden-open-data    # Bun
```

## Electricity spot prices

```ts
import { createSpotClient, summarizeSpotPrices, formatOre, withVat, stockholmClock } from "@wingerlang/sweden-open-data";

const spot = createSpotClient();
const { today, tomorrow } = await spot.prices("SE3");   // tomorrow is null until published (~13:00)

const s = summarizeSpotPrices(today!.points);
console.log(`Now ${formatOre(withVat(s!.current!.sek))} incl. VAT (${s!.level})`);
console.log(`Cheapest 3 h: ${stockholmClock(s!.cheapest!.start)}–${stockholmClock(s!.cheapest!.end)}`);
```

| Function | Purpose |
|---|---|
| `spot.prices(area)` | Today and tomorrow in one call |
| `spot.day(area, date)` | One Swedish calendar day, or `null` if not published |
| `spot.history(area, from, to)` | A range of days; days that could not be fetched are listed in `missing` |
| `summarizeSpotPrices(points, { now, windowHours })` | Current, next, min, max, average, level and cheapest window |
| `cheapestWindow(points, hours, { from })` | Cheapest contiguous window – when to run the dishwasher |
| `cheapestHours(points, count, { from })` | Cheapest hours, not necessarily contiguous – when to charge a battery |
| `priceLevel(price, points)` | `"low"`, `"normal"` or `"high"` relative to the day |
| `spotWindow(today, tomorrow, "day" \| "remaining" \| "rolling")` | The points a chart should show |
| `hourlyAverages(points)` | Quarter-hour prices merged to hours |
| `guessSpotArea(position)`, `SPOT_AREAS`, `toSpotArea("se3")` | Price areas |
| `withVat(sek)`, `formatOre(sek)` | 25 % VAT and "46 öre" formatting |

Prices are SEK and EUR per kWh **excluding** VAT, grid fees, energy tax and mark-up. Since 1 October 2025 prices are
set per quarter hour; every function handles both quarter-hour and hourly days, including 23- and 25-hour days at
daylight-saving changes. A known source quirk on the autumn DST day is corrected (`normalizeSpotDay`) without ever
inventing a price.

Complete past days never change. Give the client a `store` and they are kept across restarts:

```ts
import { fileStore } from "@wingerlang/sweden-open-data/node";
const spot = createSpotClient({ store: fileStore("./.cache/prices") });
```

## Weather

```ts
import { createWeatherClient, describeWeather, formatTemperature } from "@wingerlang/sweden-open-data";

const { current, hours, days } = await createWeatherClient().forecast({ latitude: 59.33, longitude: 18.07 });
console.log(formatTemperature(current.temperature), describeWeather(current.code).label);       // "9° Lätt regn"
console.log(describeWeather(current.code, "en"));                                               // { label: "Light rain", icon: "rain" }
```

All times are absolute (UTC ISO strings). `forecastAt(forecast, now)` re-bases a saved forecast on a later moment and
returns `null` rather than presenting stale data as current – useful for offline caches.

## Alerts: VMA, crisis information and warnings

```ts
import { createAlertsClient } from "@wingerlang/sweden-open-data";

const { places, alerts, sources } = await createAlertsClient().near(
  [{ latitude: 56.1, longitude: 13.91 }, { latitude: 59.33, longitude: 18.07 }],
  { days: 7, neighbors: true },
);
for (const a of alerts) console.log(a.kind, a.level, a.title, "→ places", a.places);
```

An alert is included when it is national, or when it touches a place: inside an SMHI warning polygon, in the same
county or municipality, or within 40 km of a point the authority gave. `neighbors: true` also includes alerts for
bordering counties. Results are sorted VMA first, then warnings by severity, then newest. Each feed fails on its own –
`sources` tells you which ones answered.

The pure functions (`parseKrisinformation`, `parseSmhiWarnings`, `relevantAlerts`, `freshAlerts`, `alertPlaces`) work
on data you already have.

## Geo: addresses, places and regions

```ts
import { createGeoClient } from "@wingerlang/sweden-open-data";

const geo = createGeoClient();
await geo.addresses("Åraslöv 1105, 28890 Vinslöv");
// [{ address: "Åraslöv 1105", city: "Vinslöv", postalCode: "288 90", approximate: true, near: "Åraslöv", … }, …]

await geo.places("Kebnekaise", { pointsOfInterest: true });
await geo.region({ latitude: 56.1, longitude: 13.91 });
// { county: "Skåne län", municipality: "Hässleholms kommun", locality: "Vinslöv", … }
```

Many Swedish rural addresses are missing from OpenStreetMap. Instead of returning a wrong address – another house
number or a similarly named street – the search offers *the address as you typed it*, positioned at the village or town
it found nearby, and marks it `approximate: true`. Nothing is invented.

## Options

```ts
const se = createClient({
  userAgent: "my-app/1.0 (https://example.com)",  // be a good citizen towards free services
  timeoutMs: 8000,           // per attempt (default 10000)
  retries: 2,                // extra attempts for timeouts, network errors, 429 and 5xx (default 1)
  retryDelayMs: 500,         // doubled per retry (default 500)
  cache: { maxEntries: 1000, ttl: { weather: 10 * 60_000 } },   // or false
  store: fileStore("./.cache"),                 // durable storage for immutable data
  endpoints: { weather: "https://my-mirror/v1/forecast" },
  coordinatePrecision: 2,    // decimals sent to sources (default 2 ≈ 1 km)
  locale: "en",              // generated texts such as warning titles (default "sv")
  fetch: myFetch,            // proxies, instrumentation, tests
  onRequest: (e) => log(e.source, e.status, e.ms, e.attempt),
});
```

Default cache lifetimes (`DEFAULT_TTL`): published spot day 12 h, unpublished day 15 min, weather 20 min, alert feeds
5 min, region 30 days, searches 1 h. Failures are never cached.

Every method also accepts `{ signal }` to cancel.

## Errors

* Invalid arguments – an unknown price area, coordinates outside the globe, `2026-02-30` – reject with a `RangeError`
  before any request is made.
* Everything that goes wrong at a source rejects with a `SourceError` with a `code` (`"timeout"`, `"network"`,
  `"http"`, `"rate-limited"`, `"invalid-response"`, `"aborted"`), the `source`, the HTTP `status` and `transient`, which
  tells you whether trying again later makes sense.

```ts
try {
  await se.weather.forecast(position);
} catch (error) {
  if (error instanceof SourceError && error.transient) return showStaleData();
  throw error;
}
```

## Entry points

| Import | Contents |
|---|---|
| `@wingerlang/sweden-open-data` | Everything, plus `createClient` |
| `@wingerlang/sweden-open-data/spot` | Spot prices |
| `@wingerlang/sweden-open-data/weather` | Weather |
| `@wingerlang/sweden-open-data/alerts` | Alerts |
| `@wingerlang/sweden-open-data/geo` | Geocoding and regions |
| `@wingerlang/sweden-open-data/node` | `fileStore` (needs a file system) |

## Runtimes

Node.js ≥ 20, Deno, Bun and modern browsers. The package uses only web-standard APIs (`fetch`, `URL`, `AbortController`,
`Intl`), except the `/node` entry point. In browsers, Open-Meteo and Photon allow cross-origin requests; for the other
sources, call the package from your server and pass the results on.

## Data and attribution

The data belongs to its publishers. Show the source next to it – the `*_SOURCE` constants have names and links.

| Source | Licence and terms (check them yourself before you ship) |
|---|---|
| Open-Meteo (weather, geocoding) | Data under CC BY 4.0. The free API is for **non-commercial use** (under 10 000 calls a day); commercial use needs a paid plan or your own instance. [Terms](https://open-meteo.com/en/terms) |
| OpenStreetMap via Photon | Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). The public Photon instance is for fair use; self-host for heavy traffic. |
| Krisinformation.se | [Terms of use for the API](https://www.krisinformation.se/globalassets/om-krisinformation.se/oppen-data/anvandarvillkor-for-krisinformations-api.pdf): no availability guarantee, cache responses, avoid unnecessary calls. |
| SMHI | [CC BY 4.0 (Erkännande 4.0 SE)](https://www.smhi.se/data/om-smhis-data/villkor-for-anvandning). Warnings may be used commercially but must **not be altered** and SMHI must be credited – the parser keeps SMHI's texts as they are and only adds the level ("Gul varning: …"). |
| elprisetjustnu.se | Free public API republishing Nord Pool day-ahead prices; see the site for terms and credit it. |

## På svenska

Elpriser, väder, VMA och varningar samt adressökning för svenska förhållanden – utan nycklar och utan beroenden.
Dokumentationen är på engelska, men allt som visas för användare (väderbeskrivningar, varningsrubriker) finns på svenska
som standard.

## Development

```sh
npm test            # node --test (Node ≥ 22.18 runs the TypeScript sources directly)
npm run smoke       # live requests against every source: node examples/dashboard.ts [lat] [lon]
npm run coverage    # with coverage thresholds
npm run typecheck   # strict, isolatedDeclarations (= JSR "no slow types")
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are published to JSR from GitHub Actions with provenance.

## License

[MIT](LICENSE) © Johannes Winger-Lang
