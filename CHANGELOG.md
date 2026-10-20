# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org); until 1.0,
minor versions may contain breaking changes, which are always listed.

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
