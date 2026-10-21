/**
 * UV, pollen and air quality for the next day, and a pollen notice above your own threshold. These values come from a
 * separate, opt-in source (Open-Meteo / CAMS); ordinary forecasts never call it.
 *
 *   node examples/air-quality.ts [lat] [lon] [threshold]    # fake sources
 *   node examples/air-quality.ts 55.6 13.0 30 --live
 */
import { createClient, ENVIRONMENT_SOURCE, POLLEN_SPECIES, pollenWarnings, type PollenSpecies } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";

const live = process.argv.includes("--live");
const [latitude = 55.6, longitude = 13.0, threshold = 30] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"))
  .map(Number);
const se = createClient(live ? { userAgent: "sweden-open-data example" } : { fetch: createFakeSources().fetch });

const forecast = await se.weather.environment({ latitude, longitude }, { days: 1 });
const max = (pick: (h: (typeof forecast.hours)[number]) => number | null): string => {
  const values = forecast.hours.map(pick).filter((v): v is number => v !== null);
  return values.length ? String(Math.max(...values)) : "–";
};
console.log(`Next 24 h at ${forecast.latitude}, ${forecast.longitude}`);
console.log(`  UV index max   ${max((h) => h.uvIndex)}`);
console.log(`  European AQI   ${max((h) => h.europeanAqi)}`);
console.log(`  PM2.5 max      ${max((h) => h.pm25)} µg/m³`);
for (const species of Object.keys(POLLEN_SPECIES) as PollenSpecies[]) {
  console.log(`  ${POLLEN_SPECIES[species].padEnd(13)}  ${max((h) => h.pollen[species])} grains/m³`);
}
const notices = pollenWarnings(forecast, threshold);
console.log(
  notices.length
    ? `Above ${threshold} grains/m³: ${notices.map((n) => n.label).join(", ")}`
    : "No pollen above your threshold.",
);
console.log(`Source: ${ENVIRONMENT_SOURCE.attribution}`);
