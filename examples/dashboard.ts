/**
 * A tiny terminal dashboard: price now, cheapest hours, weather and alerts for one place.
 *
 *   node examples/dashboard.ts 59.33 18.07
 */
import {
  createClient,
  describeWeather,
  formatOre,
  formatTemperature,
  guessSpotArea,
  stockholmClock,
  summarizeSpotPrices,
  withVat,
} from "../src/mod.ts";

const [latitude = 59.33, longitude = 18.07] = process.argv.slice(2).map(Number);
const place = { latitude, longitude };
const se = createClient({ userAgent: "sweden-open-data-example/0.1 (https://github.com/wingerlang/sweden-open-data)" });

const area = guessSpotArea(place);
const [prices, forecast, region, nearby] = await Promise.all([
  se.spot.prices(area),
  se.weather.forecast(place),
  se.geo.region(place),
  se.alerts.near([place], { days: 3 }),
]);

console.log(`${region.locality ?? region.municipality ?? region.county} (${area})`);
const summary = prices.today && summarizeSpotPrices(prices.today.points);
if (summary?.current) {
  console.log(`  El nu      ${formatOre(withVat(summary.current.sek))} inkl. moms (${summary.level})`);
  if (summary.cheapest)
    console.log(`  Billigast  ${stockholmClock(summary.cheapest.start)}–${stockholmClock(summary.cheapest.end)}`);
}
console.log(
  `  Väder      ${formatTemperature(forecast.current.temperature)} ${describeWeather(forecast.current.code).label}`,
);
for (const alert of nearby.alerts.slice(0, 5)) console.log(`  ⚠ ${alert.title}`);
if (!nearby.alerts.length) console.log("  Inga varningar eller VMA.");
