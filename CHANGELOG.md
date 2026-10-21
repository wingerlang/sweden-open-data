# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org); until 1.0,
minor versions may contain breaking changes, which are always listed.

## 0.11.0 – unreleased

A clean-up after the code review in [docs/kodgranskning.md](docs/kodgranskning.md); the steps are in
[implementation.md](implementation.md).

Breaking:

- `createClient()` no longer has `investments`. Use `createInvestmentClient()` from `/investments`, which is now marked
  experimental: IBIndex offers no public API or agreement for the endpoints used.
- `createFreeVehicleClient`, `parseTransportstyrelsenVehicle` and `vehicleLookupLinks` moved from `/vehicles` (and the
  main entry point) to the new `/vehicles/free` entry point, marked experimental: the Transportstyrelsen page is not an
  API, no agreement covers automated reading, and registration numbers can be personal data. Both stay out of the main
  entry point until their terms are confirmed in writing.
- `MemoryCache.get(key, ttl, load, options)`: `load` receives an `AbortSignal`, and the caller's signal goes in
  `options.signal`. Only matters if you call the cache yourself.
- Endpoints must be `https:` (or `http:` for localhost); anything else throws a `RangeError`.
- npm archives point `types` at compiled `.d.ts` files in `dist/` instead of the `.ts` sources.

Fixed:

- Cancelling one request no longer cancels other callers waiting for the same data; the shared request stops only when
  every caller has cancelled. The vehicle clients no longer skip the cache when a signal is given.
- `spot.history` keeps past days in a cache of its own (`cache.archiveEntries`, default 400), so a long range no
  longer pushes forecasts and other current data out of the cache.
- One HTTP 400 from Photon no longer turns its country filter off for good; it is only dropped, for an hour, when the
  same request without it succeeds.
- A vehicle page value without digits is missing instead of 0.

Added:

- `se.weather.history()` on the main client, with `signal`; every investments method takes `{ signal }`.
- Per-source limits (`limits`, `DEFAULT_LIMITS`): Photon gets two requests at a time by default.
- `maxResponseBytes` (default 5 MB) for every source.
- `PersistentStore.set(key, value, { ttlMs })`; `fileStore` honours it, has `prune()`, encodes keys reversibly
  (`a/b` and `a_b` are different files) and removes temporary files left by a crash. Old files are still read.
- `Endpoints` and `CacheTtl` for the archive, IBIndex and the vehicle sources; `TRUSTED_ALERT_HOSTS`.
- Fakes for the Open-Meteo archive, air quality, IBIndex and Transportstyrelsen in `/testing`.

Security:

- The dev board listens on 127.0.0.1 only and rejects cross-origin, non-JSON, oversized and unknown requests.
- Alert links only go to krisinformation.se over `https://`.
- The vehicle clients always use their default addresses, so an API key or a registration number never goes to an
  overridden endpoint.
- TypeScript and `@types/node` are pinned as development dependencies with a lockfile; CI installs with `npm ci`.

Performance:

- Alert polygons are tested against a bounding box first (11× faster for 50 warnings × 20 places).
- An address search costs at most 3–4 Photon requests instead of up to 6.
- Times are parsed once before sorting.

Development:

- Prettier (`npm run fmt`), a dependency-free lint script (`npm run lint`), export checks (`npm run check:exports`),
  per-file coverage limits, an npm archive check (`npm run check:package`) and a load test (`npm run load`).
- Shared parsing helpers in `src/core/parse.ts` and source patterns in `src/core/source.ts` replace the copies.

## 0.10.1 – 2026-10-20

- Investments: a lightweight NAV overview for company lists (`overview()`, one request, cached 15 minutes) and readable
  holding category names. Old fields stay compatible; a failing source falls back to the last complete answer.

## 0.10.0 – 2026-10-20

- New `/investments` entry point: investment companies from IBIndex with reported and estimated NAV, discount and
  premium history and public holdings, with shared retries, request coalescing and a durable cache.

## 0.9.0 – 2026-10-20

- New **`/economy`** export and `se.economy`: consumer price indices KPI (from 1980), KPIF and KPIF-XE (from 1987) month by month from SCB's PxWebApi v2, 2020=100. KPI joins the 1980 figures rebased to 2020=100 with the official figures after SCB's base change in January 2026.
- Pure inflation arithmetic: `adjustForInflation`, `inflationRate(s)`, `averageAnnualInflation`, `realChange` (salary vs prices), `deflate`, `annualAverage`.
- Series are cached for 6 hours (`ttl.cpi`); with a `store` the last good series survives restarts and is returned with `stale: true` when SCB is down. New `scb` endpoint and source, fake SCB answers in `/testing` and a live contract test.

## 0.8.0 – 2026-10-19

- Add a dependency-free sports catalogue with immutable IDs, Swedish names, aliases, semantic emoji and bounded autocomplete. Public facts only; participation remains private.

## 0.7.0 – 2026-10-18

- Offline higher education reference catalogue: all 50 institutions listed by UKÄ, with stable IDs, official websites and aliases.
- Optional /education export and accent-insensitive autocomplete, including abbreviations and historical names. No personal education data, graph nodes or network calls are created. Source snapshot checked 2026-10-18.

## 0.6.0 – 2026-10-18

- Opt-in weather.environment(): hourly UV index, six pollen species and European AQI / PM2.5 / PM10 from Open-Meteo / CAMS, with explicit metric selection, rounded coordinates and shared cache/retries.
- Missing pollen coverage remains null. Caller-defined pollenWarnings() compares the next 24 hours with a configurable concentration threshold; it does not represent an official warning or a clinical risk category.

## 0.5.0 – 2026-10-17

- Historical hourly temperature client for address/spot-price comparisons: rounded coordinates, UTC epoch timestamps, bounded 31-day requests, cache and explicit missing values. Reanalysis is not a personal weather-station observation.

## 0.4.0 – 2026-10-17

- npm archives expose compiled JavaScript with source TypeScript types; JSR keeps source exports. Run npm run build before npm pack.

- Free, keyless public-page vehicle lookup from Transportstyrelsen, with bounded HTML reads, private memory cache and redacted hooks. No owner data. The public website is not a stable API contract.
- Validated direct lookup links for a user-opened tab and copy/paste fallback.
- Odometer values without an explicit distance unit are not assumed to be kilometres.

## 0.3.0 – 2026-10-17

- Optional **`/vehicles`**: authenticated Biluppgifter lookup with typed registry observations, explicit missing
  fields, documented kilometre units, model year vs vehicle year, and no invented inspection deadlines.
- Reuses HTTP retries/timeouts and bounded memory-only caching. Credentials are header-only, redirects are
  rejected, and plates/credentials are redacted from request/cache hooks and returned errors. No owner data.
- Offline vehicle fixtures, fault injection and an explicitly opt-in paid live contract test.
- Existing keyless clients are unchanged. Requires a provider agreement; this is an optional authenticated source,
  not an open vehicle register. Available through the `/vehicles` export in this release.

## 0.2.0 – 2026-10-14

Added – all backwards compatible:

- **Stale-if-error:** `cache.staleIfErrorMs` keeps serving the last good result while a source is down (and asks it
  again at most once a minute).
- **Retry-After:** honoured for 429/503 up to `maxRetryDelayMs`; longer waits are reported as `SourceError.retryAfterMs`.
- **Statistics:** `client.stats()` / `resetStats()` with per-source requests, failures, retries and timings plus cache
  hits, misses and stale answers; `onCacheEvent` hook.
- **`spot.overview(area)`:** the price now plus summaries of today and tomorrow in one call.
- **Alerts:** filter by `kinds` and `minLevel`, choose `feeds`; feed status now has an `id`.
- **Geo:** `limit` for address and place searches.
- **`/testing` entry point:** fakes of every source (`createFakeSources`), fault injection for any `fetch`
  (`withFaults`), and generators for the raw source formats.
- `createMemoryCache` is exported.
- **Dev board** (`npm run dev`) and weekly **live contract tests** (`npm run test:live`) – not part of the package.

## 0.1.0 – 2026-10-14

First release.

- **Spot prices** from elprisetjustnu.se: `prices`, `day`, `history` with a persistent store for complete past days;
  `summarizeSpotPrices`, `cheapestWindow`, `cheapestHours`, `priceLevel`, `spotWindow`, `hourlyAverages`, VAT and öre
  formatting. Quarter-hour and hourly days, 23/25-hour DST days, and the autumn-DST source quirk.
- **Weather** from Open-Meteo: normalised forecast with absolute times, WMO codes in Swedish and English, `forecastAt`.
- **Alerts**: Krisinformation.se VMA and news, SMHI impact-based warnings, matching to places by polygon, county,
  municipality, distance and (optionally) bordering counties.
- **Geo**: Swedish address search with a safe fallback for addresses missing from OpenStreetMap, place and
  point-of-interest search, county/municipality for a position.
- Shared client: in-memory single-flight cache, timeouts, retries with backoff, cancellation, `SourceError`,
  coordinate rounding, `onRequest` hook, `fileStore` for Node.js, Deno and Bun.
