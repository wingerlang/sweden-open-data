/**
 * Spot prices on electricity: price areas, parsing and analysis. Everything here is pure – no network.
 *
 * Prices are Nord Pool day-ahead prices per Swedish price area, in SEK and EUR per kWh, **excluding** VAT,
 * grid fees, energy tax and the retailer's mark-up. Since 1 October 2025 the price is set per quarter hour;
 * older days have hourly prices. Every function here handles both.
 *
 * @module
 */
import { type Coordinates, assertCoordinates } from "../core/geo.ts";
import { SourceError } from "../core/errors.ts";
import { addDays, isCalendarDate, stockholmMidnight } from "../core/time.ts";

/** A Swedish electricity price area. */
export type SpotArea = "SE1" | "SE2" | "SE3" | "SE4";

/** A price area with a human-readable name. */
export interface SpotAreaInfo {
  /** `"SE1"` … `"SE4"`. */
  id: SpotArea;
  /** The city the area is named after. */
  name: string;
  /** `"SE3 · Stockholm"`. */
  label: string;
}

/** All four price areas, north to south. */
export const SPOT_AREAS: readonly SpotAreaInfo[] = Object.freeze([
  { id: "SE1", name: "Luleå", label: "SE1 · Luleå" },
  { id: "SE2", name: "Sundsvall", label: "SE2 · Sundsvall" },
  { id: "SE3", name: "Stockholm", label: "SE3 · Stockholm" },
  { id: "SE4", name: "Malmö", label: "SE4 · Malmö" },
]);

/** `true` for `"SE1"` … `"SE4"`. */
export function isSpotArea(value: unknown): value is SpotArea {
  return value === "SE1" || value === "SE2" || value === "SE3" || value === "SE4";
}

/**
 * Normalises user input such as `"se3"` or `" SE3 "` to a {@link SpotArea}.
 * @throws {RangeError} for anything that is not a price area.
 */
export function toSpotArea(value: unknown): SpotArea {
  const area = typeof value === "string" ? value.trim().toUpperCase() : value;
  if (!isSpotArea(area)) throw new RangeError(`Unknown price area: ${String(value)} (expected SE1–SE4)`);
  return area;
}

/**
 * A rough guess of the price area for a position. The real borders do not follow latitudes, so use this
 * only as a default the user can change.
 */
export function guessSpotArea(position: Coordinates): SpotArea {
  assertCoordinates(position, "position");
  const { latitude: lat, longitude: lon } = position;
  if (lat >= 65.4) return "SE1";
  if (lat >= 61.3) return "SE2";
  if (lat < 56.75 || (lat < 57.1 && lon < 16.5 && lon > 12.9)) return "SE4";
  return "SE3";
}

/** One price interval. Times are ISO 8601 strings. */
export interface SpotPoint {
  /** Start of the interval (inclusive). */
  start: string;
  /** End of the interval (exclusive). */
  end: string;
  /** Price in SEK per kWh, excluding VAT. Can be negative. */
  sek: number;
  /** Price in EUR per kWh, when the source provides it. */
  eur: number | null;
  /** Set when {@link normalizeSpotDay} corrected the source's end time; holds the original value. */
  sourceEnd?: string;
}

/** All prices for one area and Swedish calendar day. */
export interface SpotDay {
  area: SpotArea;
  /** Swedish calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Intervals in chronological order. */
  points: SpotPoint[];
  /** 15 for quarter-hour prices, 60 for hourly prices. */
  resolutionMinutes: number;
  /** `true` when the intervals cover the whole day without gaps or overlaps. */
  complete: boolean;
}

/**
 * Parses the elprisetjustnu.se response (`[{ SEK_per_kWh, EUR_per_kWh, time_start, time_end }]`).
 * Rows that are not valid prices are skipped; a response that is not a list is an error.
 *
 * @throws {SourceError} with code `"invalid-response"` when the payload is not a list.
 */
export function parseElprisResponse(json: unknown): SpotPoint[] {
  if (!Array.isArray(json)) {
    throw new SourceError("Unexpected response from elprisetjustnu.se", {
      code: "invalid-response",
      source: "elprisetjustnu",
    });
  }
  const out: SpotPoint[] = [];
  for (const row of json as Record<string, unknown>[]) {
    const raw = row?.SEK_per_kWh;
    if (raw === null || raw === undefined || raw === "") continue;
    const sek = Number(raw);
    const start = String(row.time_start ?? "");
    const end = String(row.time_end ?? "");
    if (!Number.isFinite(sek) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) continue;
    const eur = row.EUR_per_kWh == null ? NaN : Number(row.EUR_per_kWh);
    out.push({ start, end, sek, eur: Number.isFinite(eur) ? eur : null });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Corrects a known source quirk: on the autumn daylight-saving day, some historical responses give the first
 * 02:xx interval an end that is too late. The fix is applied only when the starts form a complete, evenly
 * spaced grid for the day. Prices are never filled in, averaged, duplicated or invented.
 */
export function normalizeSpotDay(points: SpotPoint[], date: string): SpotPoint[] {
  const sorted = points.slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!sorted.length) return sorted;
  const from = stockholmMidnight(date);
  const step = (stockholmMidnight(addDays(date, 1)) - from) / sorted.length;
  if (![900_000, 3_600_000].includes(step) || !sorted.every((p, i) => Date.parse(p.start) === from + i * step))
    return sorted;
  return sorted.map((p) =>
    Date.parse(p.end) === Date.parse(p.start) + step
      ? p
      : { ...p, end: new Date(Date.parse(p.start) + step).toISOString(), sourceEnd: p.end },
  );
}

/** `true` when the intervals cover the Swedish day `date` exactly, without gaps or overlaps. */
export function isCompleteSpotDay(points: SpotPoint[], date: string): boolean {
  if (!points.length || !isCalendarDate(date)) return false;
  const sorted = points.slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  let cursor = stockholmMidnight(date);
  for (const p of sorted) {
    if (!Number.isFinite(p.sek) || Date.parse(p.start) !== cursor || Date.parse(p.end) <= cursor) return false;
    cursor = Date.parse(p.end);
  }
  return cursor === stockholmMidnight(addDays(date, 1));
}

/** Builds a {@link SpotDay} from parsed points. */
export function toSpotDay(area: SpotArea, date: string, points: SpotPoint[]): SpotDay {
  const normalized = normalizeSpotDay(points, date);
  const first = normalized[0];
  const minutes = first ? Math.round((Date.parse(first.end) - Date.parse(first.start)) / 60_000) : 60;
  return { area, date, points: normalized, resolutionMinutes: minutes, complete: isCompleteSpotDay(normalized, date) };
}

const HOUR = 3_600_000;
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/** Hourly averages (quarter-hour prices are merged; hourly prices pass through unchanged). */
export function hourlyAverages(points: SpotPoint[]): SpotPoint[] {
  const groups = new Map<number, SpotPoint[]>();
  for (const p of points) {
    const hour = Math.floor(Date.parse(p.start) / HOUR);
    const group = groups.get(hour);
    if (group) group.push(p);
    else groups.set(hour, [p]);
  }
  return [...groups.values()].map((g) => ({
    start: g[0].start,
    end: g[g.length - 1].end,
    sek: mean(g.map((p) => p.sek)),
    eur: g.every((p) => p.eur != null) ? mean(g.map((p) => p.eur as number)) : null,
  }));
}

/** A contiguous span of time with its average price. */
export interface PriceWindow {
  start: string;
  end: string;
  /** Average price in SEK per kWh over the window. */
  average: number;
}

/** Options for the window functions. */
export interface WindowOptions {
  /** Ignore intervals that have ended before this instant (ms). Default: consider everything. */
  from?: number;
}

/**
 * The cheapest contiguous window of `hours` whole hours that has not already passed – for example when to run
 * the dishwasher or charge the car. Returns `null` when no complete window is left.
 *
 * @example
 * ```ts
 * const best = cheapestWindow(day.points, 3, { from: Date.now() });
 * if (best) console.log(`Cheapest 3 h: ${stockholmClock(best.start)}–${stockholmClock(best.end)}`);
 * ```
 */
export function cheapestWindow(points: SpotPoint[], hours: number, options: WindowOptions = {}): PriceWindow | null {
  if (!Number.isInteger(hours) || hours < 1) throw new RangeError("hours must be a positive integer");
  const from = options.from ?? -Infinity;
  const hourly = hourlyAverages(points).filter((p) => Date.parse(p.end) > from);
  let best: PriceWindow | null = null;
  for (let i = 0; i + hours <= hourly.length; i++) {
    const slice = hourly.slice(i, i + hours);
    const start = slice[0].start;
    const end = slice[slice.length - 1].end;
    if (Date.parse(end) - Date.parse(start) !== hours * HOUR) continue;
    const average = mean(slice.map((p) => p.sek));
    if (!best || average < best.average) best = { start, end, average };
  }
  return best;
}

/**
 * The `count` cheapest hours that have not passed, not necessarily contiguous, in chronological order –
 * for loads that can be split, such as a heat pump boost or a battery.
 */
export function cheapestHours(points: SpotPoint[], count: number, options: WindowOptions = {}): SpotPoint[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be a positive integer");
  const from = options.from ?? -Infinity;
  return hourlyAverages(points)
    .filter((p) => Date.parse(p.end) > from)
    .sort((a, b) => a.sek - b.sek || Date.parse(a.start) - Date.parse(b.start))
    .slice(0, count)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Where a price sits within the day's range. */
export type PriceLevel = "low" | "normal" | "high";

/**
 * Classifies a price against the day: the lower third of the day's range is `"low"`, the upper third `"high"`.
 * A flat day (less than 5 öre between min and max) is always `"normal"`.
 */
export function priceLevel(price: number, points: SpotPoint[]): PriceLevel {
  if (!points.length) return "normal";
  const prices = points.map((p) => p.sek);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min;
  if (spread < 0.05) return "normal";
  if (price <= min + spread / 3) return "low";
  if (price >= max - spread / 3) return "high";
  return "normal";
}

/** A summary of a day's prices. */
export interface SpotSummary {
  /** The interval that is running at `now`, if any. */
  current: SpotPoint | null;
  /** The interval after the current one (or the next one to start). */
  next: SpotPoint | null;
  min: SpotPoint;
  max: SpotPoint;
  /** Average price in SEK per kWh. */
  average: number;
  /** Level of the current price, or `null` when no interval is running. */
  level: PriceLevel | null;
  /** The cheapest window of `windowHours` that has not passed. */
  cheapest: PriceWindow | null;
}

/** Options for {@link summarizeSpotPrices}. */
export interface SummaryOptions {
  /** The instant to summarise for. Default `Date.now()`. */
  now?: number;
  /** Length of the cheapest window in hours. Default `3`. */
  windowHours?: number;
}

/** Current price, next, min, max, average, the current level and the cheapest window – in one call. */
export function summarizeSpotPrices(points: SpotPoint[], options: SummaryOptions = {}): SpotSummary | null {
  if (!points.length) return null;
  const now = options.now ?? Date.now();
  const current = points.find((p) => Date.parse(p.start) <= now && now < Date.parse(p.end)) ?? null;
  const after = current ? Date.parse(current.end) : now;
  const next = points.find((p) => Date.parse(p.start) >= after) ?? null;
  const min = points.reduce((a, p) => (p.sek < a.sek ? p : a));
  const max = points.reduce((a, p) => (p.sek > a.sek ? p : a));
  return {
    current,
    next,
    min,
    max,
    average: mean(points.map((p) => p.sek)),
    level: current ? priceLevel(current.sek, points) : null,
    cheapest: cheapestWindow(points, options.windowHours ?? 3, { from: now }),
  };
}

/** Which part of today a display should cover. */
export type SpotRange = "day" | "remaining" | "rolling";

/**
 * Picks the intervals to show: the whole day, the rest of today from the current hour, or a rolling 24 hours
 * from the current hour that continues into tomorrow as far as tomorrow is published.
 */
export function spotWindow(
  today: SpotPoint[],
  tomorrow: SpotPoint[] | null | undefined,
  range: SpotRange,
  now: number = Date.now(),
): SpotPoint[] {
  if (range === "day") return today;
  const from = Math.floor(now / HOUR) * HOUR;
  if (range === "remaining") return today.filter((p) => Date.parse(p.end) > from);
  const to = from + 24 * HOUR;
  return [...today, ...(tomorrow ?? [])].filter((p) => Date.parse(p.end) > from && Date.parse(p.start) < to);
}

/** Swedish VAT on electricity. */
export const VAT_RATE = 0.25;

/** Adds VAT to a price. */
export function withVat(sek: number, rate: number = VAT_RATE): number {
  return sek * (1 + rate);
}

/**
 * Formats SEK per kWh as öre per kWh, the way Swedes talk about electricity prices.
 *
 * @example
 * ```ts
 * formatOre(0.4567); // "46 öre"
 * formatOre(0.0456); // "4,6 öre"
 * ```
 */
export function formatOre(sek: number): string {
  const ore = sek * 100;
  return (
    (Math.abs(ore) < 10 ? ore.toFixed(1) : Math.round(ore).toString()).replace(".", ",").replace("-", "−") + " öre"
  );
}
