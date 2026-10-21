/**
 * Micro benchmark for matching alerts to places (step 21 of implementation.md): 50 SMHI warnings with detailed
 * polygons against 20 places. `node scripts/bench-alerts.ts`
 *
 * @module
 */
import { type Alert, relevantAlerts } from "../src/alerts/alerts.ts";
import { inPolygon, type Polygon } from "../src/core/geo.ts";

/** A circle-like polygon with `n` corners around a centre. */
const ring = (lon: number, lat: number, r: number, n = 400): Polygon => [
  Array.from({ length: n + 1 }, (_, i) => [
    lon + r * Math.cos((2 * Math.PI * i) / n),
    lat + r * Math.sin((2 * Math.PI * i) / n),
  ]),
];
const now = Date.parse("2026-10-21T12:00:00Z");
const alerts: Alert[] = Array.from({ length: 50 }, (_, i) => ({
  id: `smhi:${i}`,
  source: "SMHI",
  kind: "warning",
  level: "yellow",
  title: "Gul varning",
  summary: "",
  url: "https://www.smhi.se",
  published: new Date(now - 3_600_000).toISOString(),
  areas: [],
  polygons: [ring(12 + (i % 10) * 1.2, 56 + Math.floor(i / 10) * 2.5, 0.4)],
}));
const places = Array.from({ length: 20 }, (_, i) => ({ latitude: 55.5 + i * 0.6, longitude: 13 + (i % 5) }));

const time = (run: () => void, rounds = 50): number => {
  const start = performance.now();
  for (let i = 0; i < rounds; i++) run();
  return (performance.now() - start) / rounds;
};
const withBox = time(() => relevantAlerts(alerts, places, { now }));
const without = time(() => {
  for (const a of alerts) for (const p of places) a.polygons?.some((poly) => inPolygon(p, poly));
});
console.log(`with bounding boxes: ${withBox.toFixed(2)} ms · polygon test only: ${without.toFixed(2)} ms`);
console.log(`speed-up ×${(without / withBox).toFixed(1)}`);
