/**
 * Swedish counties (län) and municipalities (kommuner): name matching, approximate centres and which counties
 * share a border. Pure data and functions.
 *
 * @module
 */
import { type Coordinates, distanceKm, fold } from "../core/geo.ts";

/** A position with the administrative areas it belongs to. */
export interface Region extends Coordinates {
  /** County, for example `"Skåne län"`. */
  county?: string;
  /** Municipality, for example `"Hässleholms kommun"`. */
  municipality?: string;
  /** Town or village, for example `"Vinslöv"`. */
  locality?: string;
  /** `true` when the county is a nearest-centre guess because reverse geocoding was unavailable. */
  guessed?: boolean;
}

/** A county with an approximate centre. */
export interface County extends Coordinates {
  name: string;
}

/** All 21 counties with approximate centres (for fallbacks, not for precise lookups). */
export const COUNTIES: readonly County[] = Object.freeze(
  (
    [
      ["Stockholms län", 59.4, 18.2],
      ["Uppsala län", 60.0, 17.6],
      ["Södermanlands län", 59.1, 16.6],
      ["Östergötlands län", 58.3, 15.6],
      ["Jönköpings län", 57.5, 14.4],
      ["Kronobergs län", 56.8, 14.5],
      ["Kalmar län", 57.2, 16.2],
      ["Gotlands län", 57.5, 18.5],
      ["Blekinge län", 56.3, 15.3],
      ["Skåne län", 55.9, 13.6],
      ["Hallands län", 56.9, 12.7],
      ["Västra Götalands län", 58.2, 12.6],
      ["Värmlands län", 59.8, 13.2],
      ["Örebro län", 59.4, 15.0],
      ["Västmanlands län", 59.8, 16.2],
      ["Dalarnas län", 61.0, 14.6],
      ["Gävleborgs län", 61.5, 16.2],
      ["Västernorrlands län", 63.0, 17.3],
      ["Jämtlands län", 63.2, 14.0],
      ["Västerbottens län", 64.8, 18.5],
      ["Norrbottens län", 66.8, 20.5],
    ] as const
  ).map(([name, latitude, longitude]) => Object.freeze({ name, latitude, longitude })),
);

/**
 * A comparison key for county and municipality names, so that different spellings of the same area match.
 *
 * @example
 * ```ts
 * regionKey("Hässleholms kommun") === regionKey("Hässleholm");         // true
 * regionKey("Västra Götalands län") === regionKey("Västra Götaland");  // true
 * ```
 */
export function regionKey(name: string): string {
  return fold(name)
    .replace(/\b(lan|kommun|county|municipality)\b/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");
}

/** The county whose centre is nearest – a fallback when reverse geocoding is unavailable. */
export function nearestCounty(position: Coordinates): string {
  let best = COUNTIES[0];
  let distance = Infinity;
  for (const county of COUNTIES) {
    const d = distanceKm(position, county);
    if (d < distance) {
      distance = d;
      best = county;
    }
  }
  return best.name;
}

// Source: SCB, https://www.scb.se/contentassets/1e02934987424259b730c5e9a82f7e74/lanskarta.pdf
const BORDERS: readonly (readonly [string, string])[] = [
  ["Stockholm", "Uppsala"],
  ["Stockholm", "Södermanland"],
  ["Uppsala", "Södermanland"],
  ["Uppsala", "Västmanland"],
  ["Uppsala", "Dalarna"],
  ["Uppsala", "Gävleborg"],
  ["Södermanland", "Västmanland"],
  ["Södermanland", "Örebro"],
  ["Södermanland", "Östergötland"],
  ["Östergötland", "Örebro"],
  ["Östergötland", "Västra Götaland"],
  ["Östergötland", "Jönköping"],
  ["Östergötland", "Kalmar"],
  ["Jönköping", "Västra Götaland"],
  ["Jönköping", "Halland"],
  ["Jönköping", "Kronoberg"],
  ["Jönköping", "Kalmar"],
  ["Kronoberg", "Halland"],
  ["Kronoberg", "Skåne"],
  ["Kronoberg", "Blekinge"],
  ["Kronoberg", "Kalmar"],
  ["Kalmar", "Blekinge"],
  ["Blekinge", "Skåne"],
  ["Skåne", "Halland"],
  ["Halland", "Västra Götaland"],
  ["Västra Götaland", "Värmland"],
  ["Västra Götaland", "Örebro"],
  ["Värmland", "Örebro"],
  ["Värmland", "Dalarna"],
  ["Örebro", "Västmanland"],
  ["Örebro", "Dalarna"],
  ["Västmanland", "Dalarna"],
  ["Dalarna", "Gävleborg"],
  ["Dalarna", "Jämtland"],
  ["Gävleborg", "Jämtland"],
  ["Gävleborg", "Västernorrland"],
  ["Jämtland", "Västernorrland"],
  ["Jämtland", "Västerbotten"],
  ["Västernorrland", "Västerbotten"],
  ["Västerbotten", "Norrbotten"],
];

/** Counties that share a land border with `county` (short names, for example `["Kronoberg", "Blekinge", "Halland"]`). */
export function neighboringCounties(county: string): string[] {
  const key = regionKey(county);
  return BORDERS.flatMap(([a, b]) => (regionKey(a) === key ? [b] : regionKey(b) === key ? [a] : []));
}
