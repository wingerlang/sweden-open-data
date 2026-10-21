# Examples

Each example runs offline against the fake sources in `/testing` and prints what it does. Add `--live` to use the real
sources (needs network). `npm run examples` runs them all offline; a test keeps them working.

| Example | Shows |
| --- | --- |
| [`dashboard.ts`](dashboard.ts) | Price now, cheapest hours, weather and alerts for one place (live) |
| [`cancellation.ts`](cancellation.ts) | One caller cancelling never cancels another caller sharing the same request |
| [`weather-history.ts`](weather-history.ts) | Historical temperatures next to spot prices for a week |
| [`air-quality.ts`](air-quality.ts) | UV, pollen and air quality, and pollen notices above your own threshold |
| [`autocomplete.ts`](autocomplete.ts) | Address autocomplete with a pause, cancellation and per-source limits |
| [`persistent-store.ts`](persistent-store.ts) | `fileStore`: data that survives restarts, expiry and `prune()` |
| [`investments.ts`](investments.ts) | Experimental: IBIndex price against NAV, and a company's largest holdings |
| [`vehicle-lookup.ts`](vehicle-lookup.ts) | Experimental: free vehicle lookup with a fallback link |
| [`reference-data.ts`](reference-data.ts) | Universities and sports for forms, offline |
