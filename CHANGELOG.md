# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org); until 1.0,
minor versions may contain breaking changes, which are always listed.

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
