/**
 * Historical temperatures next to spot prices: was electricity dearer on the cold days of a week? A typical use of
 * `weather.history` – compare energy use or prices with the weather of a period.
 *
 *   node examples/weather-history.ts [from] [to]           # fake sources, default 2026-01-05 – 2026-01-11
 *   node examples/weather-history.ts 2026-01-05 2026-01-11 --live
 */
import { addDays, createClient, formatOre, swedishDate } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";

const live = process.argv.includes("--live");
const [from = "2026-01-05", to = "2026-01-11"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const se = createClient(live ? { userAgent: "sweden-open-data example" } : { fetch: createFakeSources().fetch });
const stockholm = { latitude: 59.33, longitude: 18.07 };

const [{ hours }, prices] = await Promise.all([
  se.weather.history(stockholm, from, to),
  se.spot.history("SE3", from, to),
]);

console.log(`Stockholm and SE3, ${from} – ${to}`);
for (let date = from; date <= to; date = addDays(date, 1)) {
  const temps = hours.filter((h) => swedishDate(h.at) === date).map((h) => h.celsius);
  const day = prices.days.find((d) => d.date === date);
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
  const temp = temps.length ? `${mean(temps).toFixed(1).padStart(5)} °C` : "    – °C";
  const price = day ? formatOre(mean(day.points.map((p) => p.sek))) : "–";
  console.log(`  ${date}  ${temp}  ${price}`);
}
if (prices.missing.length) console.log("missing price days:", prices.missing.map((m) => m.date).join(", "));
