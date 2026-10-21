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
| **Inflation** | Consumer price indices KPI, KPIF and KPIF-XE month by month; amounts in today's money, inflation rates, salary vs prices, real values | [SCB](https://www.scb.se/kpi) (Statistikdatabasen) |

The core sources need no API keys. The optional [vehicle lookup](#vehicle-lookup-optional-authenticated-source) requires a server-side Biluppgifter key. (Free does not always mean free for any use – see [Data and attribution](#data-and-attribution).) Works in Node.js, Deno, Bun and the browser (where the source allows CORS – see [Runtimes](#runtimes)).

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
const kpi = await se.economy.cpi("KPI");
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
| `spot.overview(area, { windowHours })` | The price now plus summaries of today and tomorrow – what a widget needs |
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

### Historical temperatures

```ts
const { hours } = await se.weather.history({ latitude: 59.33, longitude: 18.07 }, "2026-01-01", "2026-01-31");
// [{ at: 1767225600000, celsius: -2.5 }, …] – hourly, 1–31 days per request, cached 6 h
```

ERA5 reanalysis from the [Open-Meteo archive](https://open-meteo.com/en/docs/historical-weather-api): a model of the
past, not a station reading at the address. Also available on its own as `createWeatherHistoryClient()`.

### Optional UV, pollen and air quality

Ordinary forecasts make no additional requests. Opt in to environmental data separately:

```ts
import { createWeatherClient, pollenWarnings } from "@wingerlang/sweden-open-data";
const weather = createWeatherClient();
const environment = await weather.environment({ latitude: 59.33, longitude: 18.07 }, {
  metrics: ["uv", "pollen", "airQuality"], days: 4,
});
const warnings = pollenWarnings(environment, 20); // caller's own grains/m³ threshold, next 24 h
```

Hourly values include UV index, alder/birch/grass/mugwort/olive/ragweed pollen (grains/m³), European AQI,
PM2.5 and PM10 (µg/m³). Missing values remain null, including seasonal or geographic pollen gaps.
These are model forecasts, not monitoring-station observations or official alerts. Pollen forecasts cover Europe
and up to four days. Preserve fetchedAt and show the source attribution carried by the response.
The endpoint is configurable with endpoints.airQuality. Requests reuse rounding, cache, retries and cancellation.
Source and usage terms: [Open-Meteo Air Quality / CAMS](https://open-meteo.com/en/docs/air-quality-api).

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

Narrow it down when you only want what matters:

```ts
await alerts.near(places, { kinds: ["vma", "warning"], minLevel: "orange" }); // VMA and orange/red warnings only
await alerts.near(places, { feeds: ["smhi"] });                                // only ask SMHI
```

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

Both searches take `{ limit }`, and `addresses` takes `{ country }` (default `"SE"`, `null` for anywhere).

Many Swedish rural addresses are missing from OpenStreetMap. Instead of returning a wrong address – another house
number or a similarly named street – the search offers *the address as you typed it*, positioned at the village or town
it found nearby, and marks it `approximate: true`. Nothing is invented.

## Inflation: consumer price indices from SCB

```ts
import { createEconomyClient, adjustForInflation, realChange, inflationRate, latestCpi } from "@wingerlang/sweden-open-data/economy";

const economy = createEconomyClient();
const kpi = await economy.cpi("KPI");                    // every month since 1980, 2020=100

adjustForInflation(kpi, 10_000, "2000-01").amount;       // 10 000 kr from January 2000 in today's money
inflationRate(kpi, latestCpi(kpi)!.month);               // the latest annual (12-month) rate, 0.031 = 3.1 %
realChange(kpi, { amount: 32_000, month: "2018-01" }, { amount: 41_000, month: "2026-09" }).real; // did the salary keep up?
```

| Function | Purpose |
|---|---|
| `economy.cpi(index)` | `"KPI"` (from 1980), `"KPIF"` or `"KPIF-XE"` (from 1987), monthly, 2020=100 |
| `adjustForInflation(series, amount, from, to?)` | An amount in the prices of another month (default: the newest) |
| `inflationRate(series, month, months = 12)` / `inflationRates(series)` | Inflation over a period; the annual rate for every month |
| `averageAnnualInflation(series, from, to)` | Geometric average per year |
| `realChange(series, earlier, later)` | Nominal and real change of an amount, and what keeps its purchasing power |
| `deflate(series, values, to?)` | A nominal series (balance, price, index) in real terms |
| `annualAverage`, `cpiAt`, `latestCpi`, `cpiRange`, `toMonth`, `addMonths` | Helpers |

KPI is SCB's official ("fastställda") series. SCB changed the reference year from 1980 to 2020 in January 2026; the
client joins the 1980 figures rebased to 2020=100 (until December 2025) with the new official figures, so there is no
break. SCB publishes once a month: series are cached for 6 hours, and with a `store` the last good series is kept
across restarts and returned (with `stale: true`) when SCB cannot be reached. All functions are pure and run in the
browser on a series your server fetched.

## Options

```ts
const se = createClient({
  userAgent: "my-app/1.0 (https://example.com)",  // be a good citizen towards free services
  timeoutMs: 8000,           // per attempt (default 10000)
  retries: 2,                // extra attempts for timeouts, network errors, 429 and 5xx (default 1)
  retryDelayMs: 500,         // doubled per retry (default 500)
  maxRetryDelayMs: 10_000,   // a longer Retry-After from a source is reported, not slept through
  maxResponseBytes: 5_000_000, // larger answers are refused as invalid-response (default 5 MB)
  cache: {                   // or false
    maxEntries: 1000,
    archiveEntries: 400,     // past days kept by spot.history, in a cache of their own (default 400)
    ttl: { weather: 10 * 60_000 },
    staleIfErrorMs: 6 * 3_600_000,  // keep serving the last good result for 6 h if a source goes down
  },
  store: fileStore("./.cache"),                 // durable storage for immutable data
  endpoints: { weather: "https://my-mirror/v1/forecast" },
  coordinatePrecision: 2,    // decimals sent to sources (default 2 ≈ 1 km)
  locale: "en",              // generated texts such as warning titles (default "sv")
  fetch: myFetch,            // proxies, instrumentation, tests
  onRequest: (e) => log(e.source, e.status, e.ms, e.attempt),
  onCacheEvent: (e) => log(e.type, e.key),        // hit, miss or stale
});
```

Default cache lifetimes (`DEFAULT_TTL`): published spot day 12 h, unpublished day 15 min, weather 20 min, alert feeds
5 min, region 30 days, searches 1 h. Failures are never cached.

Every method also accepts `{ signal }` to cancel. Concurrent identical requests share one load; cancelling only ends
your own wait, and the load is aborted when every caller waiting for it has cancelled.

### Staying up when a source is down

With `cache.staleIfErrorMs`, an expired result is served again when refreshing it fails, for as long as you allow. The
failing source is then asked at most once a minute. Every result that changes over time carries `fetchedAt`, so you
can show "updated 2 h ago" instead of an error. A `429` or `503` with a `Retry-After` is honoured when it is short and
reported (`error.retryAfterMs`) when it is longer than `maxRetryDelayMs`.

### Health and metrics

```ts
se.stats();
// { requests: 42, failures: 1, cache: { hits: 30, misses: 12, stale: 0 },
//   sources: { "open-meteo": { requests: 5, failures: 0, retries: 0, averageMs: 210, lastStatus: 200, … }, … } }
se.resetStats();
```

`onRequest` sees every attempt (with status, duration, attempt number and error), `onCacheEvent` every cache
decision – enough for logging, Prometheus counters or OpenTelemetry spans.

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
| `@wingerlang/sweden-open-data` | Everything except the experimental sources, plus `createClient` |
| `@wingerlang/sweden-open-data/spot` | Spot prices |
| `@wingerlang/sweden-open-data/weather` | Weather |
| `@wingerlang/sweden-open-data/alerts` | Alerts |
| `@wingerlang/sweden-open-data/geo` | Geocoding and regions |
| `@wingerlang/sweden-open-data/economy` | Consumer price indices and inflation arithmetic |
| `@wingerlang/sweden-open-data/node` | `fileStore` (needs a file system) |
| `@wingerlang/sweden-open-data/testing` | Fakes of every source and fault injection, for your own tests |
| `@wingerlang/sweden-open-data/vehicles` | Authenticated vehicle lookup (Biluppgifter, needs an API key) |
| `@wingerlang/sweden-open-data/vehicles/free` | **Experimental:** Transportstyrelsen public-page lookup |
| `@wingerlang/sweden-open-data/investments` | **Experimental:** IBIndex investment companies |

## Testing your code

You should not need the network – or this package's internals – to test code that uses it:

```ts
import { createClient } from "@wingerlang/sweden-open-data";
import { createFakeSources } from "@wingerlang/sweden-open-data/testing";

const fake = createFakeSources({ now: () => Date.parse("2026-10-14T10:00:00+02:00") });
const se = createClient({ fetch: fake.fetch, now: () => Date.parse("2026-10-14T10:00:00+02:00"), retries: 0 });

await se.spot.overview("SE3");             // realistic, deterministic prices; tomorrow appears after 13:00
fake.setFault("smhi", { status: 503 });    // …or { offline }, { hang }, { delayMs }, { invalidJson }, { rate: 0.5 }
fake.calls;                                 // every URL that was requested
```

`withFaults(fetch)` adds the same fault switches to any `fetch` – including the real one – and `fakeSpotDay`,
`fakeForecast`, `fakeKrisinformation` and `fakeSmhiWarnings` give you the raw source formats. The generated data is for
tests and demos only.

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
| SCB | Open data, free to use including commercially ([CC0](https://www.scb.se/vara-tjanster/oppna-data/)). Credit SCB as the source. |

## På svenska

Elpriser, väder, VMA och varningar, adressökning och KPI/inflation för svenska förhållanden – utan nycklar och utan beroenden.
Dokumentationen är på engelska, men allt som visas för användare (väderbeskrivningar, varningsrubriker) finns på svenska
som standard.

## Development

```sh
npm run dev         # the dev board: http://localhost:5174 (add -- --fake for generated data, no network)
npm test            # node --test (Node ≥ 22.18 runs the TypeScript sources directly)
npm run coverage    # with coverage thresholds
npm run typecheck   # strict, isolatedDeclarations (= JSR "no slow types")
npm run test:live   # contract tests against the real sources (also run weekly in CI)
npm run smoke       # a small terminal dashboard: node examples/dashboard.ts [lat] [lon]
```

The **dev board** runs every call of the package from a browser page – spot prices with a chart, weather, alerts,
address and place search, regions and history – against the real sources or the fakes. It shows the equivalent code
and the raw result for each call, a live log of every request and cache decision, per-source statistics, and lets you
switch faults on per source (slow, hang, offline, 503, 429 with Retry-After, invalid JSON, flaky) while you change the
timeout, retries and stale-if-error, so you can watch the client cope. *Run all* is a one-click smoke test.

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are published to JSR from GitHub Actions with provenance.

## License

[MIT](LICENSE) © Johannes Winger-Lang

## Vehicle lookup (optional authenticated source)

```ts
import {createVehicleClient} from "@wingerlang/sweden-open-data/vehicles";
const vehicles = createVehicleClient({apiKey: process.env.BILUPPGIFTER_API_KEY!, userAgent: "my-server/1.0"});
const vehicle = await vehicles.lookup("ABC123"); // null on HTTP 404, SourceError for provider failures
```

**Server-side only.** Unlike the open sources this requires your own paid/provider agreement and API key.
[Provider contract](https://apidocs.biluppgifter.se/): Biluppgifter v1 `basic,status,inspection` packages.
`modelYear` prefers `model_year`; `vehicleYear` is a separate observation. Tax is SEK/year. `mileageKm` is the last
recorded inspection odometer in kilometres, not live mileage. Source and `fetchedAt` accompany every result.
Missing values stay undefined; owner, address, VIN and finance fields are excluded. No deadline is guessed.

Instantiate once per credential scope. Positive answers live in a bounded private memory cache for 6h (override
`ttlMs`); 404 answers for at most 5 minutes. No disk cache or public client's cache is used. `cache: false` disables
reuse; concurrent identical requests still share a load. A caller's cancellation signal only
ends that caller's wait; the shared lookup is aborted when every waiting caller has cancelled. `clearCache()`, `stats()` and `resetStats()` are available.
Request/cache hooks and returned SourceErrors redact plates and credentials; your custom `fetch` can see the
actual request, so do not log URLs or headers there. Authenticated redirects are rejected.

Offline: use `createFakeSources()` from `/testing` with a dummy key; `fakeVehicleResponse()` exposes the source
fixture. It is explicitly synthetic. A paid live test is **skipped by default**: only set both
`BILUPPGIFTER_API_KEY` and `VEHICLE_LIVE_TEST_REGISTRATION` for a registration you may query, then run
`node --test live/vehicles.test.ts`. The library never queries a default registration.

This module is currently unreleased. Existing installations of 0.2.0 keep working; release a new minor version
before switching consumers to the new export. No changes to users' personal vehicles, sharing or reminders are
performed by the library; those belong to the consuming application.

### Free vehicle lookup (experimental)

> **Experimental.** Transportstyrelsen publishes this page for people, not as an API, and no agreement covers automated reading. Registration numbers can be personal data under GDPR. Until the terms are confirmed in writing it lives in its own entry point,
> `@wingerlang/sweden-open-data/vehicles/free`, and is not exported from the main package or `/vehicles`.

`createFreeVehicleClient()` from `/vehicles/free` reads Transportstyrelsen’s public HTML without an API key. It is best-effort, not an official API contract; no access challenge is bypassed. `vehicleLookupLinks(registrationNumber)` provides direct links for an ordinary browser tab if automatic reading fails. The parser retains labelled vehicle observations only and never assumes an odometer unit when none is displayed. For a contracted API, the optional `createVehicleClient({apiKey})` remains available.

## Higher education reference catalogue

The optional `@wingerlang/sweden-open-data/education` export provides `getSwedishInstitutions()`, `searchSwedishInstitutions(query, limit)` and `SWEDISH_INSTITUTIONS_SOURCE`. It contains the 50 institutions listed by [UKÄ](https://www.uka.se/sa-fungerar-hogskolan/universitet-och-hogskolor/lista-over-universitet-hogskolor-och-enskilda-utbildningsanordnare), checked 2026-10-18. Names, websites and classifications follow that snapshot; aliases support abbreviations such as KTH and historical names such as MDH.

This is a dated, immutable reference snapshot with stable IDs, not a live accreditation lookup. It makes no network calls and contains no students, relationships, private notes or graph nodes. Refresh the snapshot and review the source deliberately when publishing a new package version.

```ts
import {searchSwedishInstitutions} from "@wingerlang/sweden-open-data/education";
const suggestions = searchSwedishInstitutions("kth");
```

## Sport reference catalogue

The /sports export provides getSports(), findSport() and searchSports(): stable sport IDs, Swedish names, English/common aliases, categories and semantic emoji. This is a curated vocabulary of common sports and exercise, not an exhaustive RF membership list. Names may be entered freely by consumers. Person IDs, membership, club affiliations, dates, notes and training histories never belong in this public catalogue.

### Investment companies (IBIndex, experimental)

> **Experimental.** IBIndex offers no public API or agreement for these endpoints; availability and data terms are decided by IBIndex. Until the terms are confirmed in writing it is only available from
> `@wingerlang/sweden-open-data/investments` and is not part of `createClient()`.

The optional `/investments` entry point provides `createInvestmentClient()`. Call `companies()` for stable IBIndex products and `company("INVE B")` for dated reported/estimated NAV, discount history and underlying holdings. A positive discount is below NAV; a negative discount is a premium. Holdings weights exclude the cash/debt categories, matching IBIndex's denominator. Missing NAV remains null.

Responses share a six-hour cache and can persist in the existing store. Failed refreshes retain the last complete result marked stale. This is an unofficial adapter to public IBIndex read endpoints; availability and third-party data terms are determined by IBIndex, not this package's MIT source-code license. Always show source and dates. Reports are handled by the application's existing company-report source. No private portfolio inputs are accepted.
