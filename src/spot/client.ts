/**
 * Spot-price client backed by [elprisetjustnu.se](https://www.elprisetjustnu.se/elpris-api), which republishes
 * Nord Pool day-ahead prices for free.
 *
 * @module
 */
import { type ClientOptions, type Context, createContext, storeGet, storeSet } from "../core/context.ts";
import { addDays, isCalendarDate, swedishDate } from "../core/time.ts";
import {
  isCompleteSpotDay,
  parseElprisResponse,
  type SpotArea,
  type SpotDay,
  type SpotPoint,
  type SpotSummary,
  summarizeSpotPrices,
  toSpotArea,
  toSpotDay,
} from "./prices.ts";
import { stockholmMidnight } from "../core/time.ts";

/** Where the prices come from – show it next to the data. */
export const SPOT_SOURCE: { readonly name: string; readonly url: string } = Object.freeze({
  name: "Elpriset just nu.se",
  url: "https://www.elprisetjustnu.se",
});

/** Today's and (once published, around 13:00) tomorrow's prices. */
export interface SpotPrices {
  area: SpotArea;
  /** `null` only if the source has not published today, which in practice means it is down. */
  today: SpotDay | null;
  /** `null` until tomorrow's prices are published. */
  tomorrow: SpotDay | null;
  /** When the data was fetched (ISO 8601). */
  fetchedAt: string;
}

/** What a price widget shows: the price right now and summaries of today and tomorrow. */
export interface SpotOverview {
  area: SpotArea;
  /** The interval running now, or `null` if today's prices are unavailable. */
  current: SpotPoint | null;
  /** Summary of today from now on (cheapest window, level …), or `null`. */
  today: SpotSummary | null;
  /** Summary of tomorrow once published, else `null`. */
  tomorrow: SpotSummary | null;
  fetchedAt: string;
}

/** A range of historical days. Days the source could not deliver are listed in {@link SpotHistory.missing}. */
export interface SpotHistory {
  area: SpotArea;
  from: string;
  to: string;
  /** Complete days, in date order. Incomplete days are never included. */
  days: SpotDay[];
  /** Days that could not be fetched, with the reason. */
  missing: { date: string; reason: string }[];
}

/** Options for {@link SpotClient.history}. */
export interface HistoryOptions {
  /** Parallel requests. Default `2` – be kind to a free service. */
  concurrency?: number;
  /** Longest allowed range in days. Default `366`. */
  maxDays?: number;
  /** Cancels outstanding requests. */
  signal?: AbortSignal;
}

/** Spot prices per Swedish price area. */
export interface SpotClient {
  /**
   * Prices for one area and Swedish calendar day, or `null` when that day is not published (yet).
   * Complete past days are kept in the persistent store when one is configured.
   */
  day(area: SpotArea | string, date: string, options?: { signal?: AbortSignal }): Promise<SpotDay | null>;
  /** Today and tomorrow in one call – what a price widget needs. */
  prices(area: SpotArea | string, options?: { signal?: AbortSignal }): Promise<SpotPrices>;
  /**
   * The price now plus summaries of today and tomorrow – one call for a widget.
   *
   * @example
   * ```ts
   * const { current, today } = await spot.overview("SE3", { windowHours: 2 });
   * ```
   */
  overview(area: SpotArea | string, options?: { windowHours?: number; signal?: AbortSignal }): Promise<SpotOverview>;
  /** Every day from `from` to `to` (inclusive). */
  history(area: SpotArea | string, from: string, to: string, options?: HistoryOptions): Promise<SpotHistory>;
}

/**
 * Creates a {@link SpotClient}.
 *
 * @example
 * ```ts
 * const spot = createSpotClient();
 * const { today, tomorrow } = await spot.prices("SE3");
 * ```
 */
export function createSpotClient(options: ClientOptions | Context = {}): SpotClient {
  const ctx = createContext(options);

  async function fetchDay(area: SpotArea, date: string, signal?: AbortSignal): Promise<SpotDay | null> {
    const storeKey = `spot:${area}:${date}`;
    const past = date < swedishDate(ctx.now());
    if (past) {
      const stored = await storeGet(ctx.store, storeKey);
      if (Array.isArray(stored) && isCompleteSpotDay(stored as SpotPoint[], date)) return toSpotDay(area, date, stored as SpotPoint[]);
    }
    const [y, m, d] = date.split("-");
    const json = await ctx.http.json("elprisetjustnu", `${ctx.endpoints.spot}/${y}/${m}-${d}_${area}.json`, {
      allowNotFound: true,
      signal,
    });
    if (json === undefined) return null;
    const day = toSpotDay(area, date, parseElprisResponse(json));
    if (!day.points.length) return null;
    if (past && day.complete) await storeSet(ctx.store, storeKey, day.points);
    return day;
  }

  const day: SpotClient["day"] = async (areaInput, date, options = {}) => {
    const area = toSpotArea(areaInput);
    if (!isCalendarDate(date)) throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${String(date)}`);
    return ctx.cache.get(
      `spot:${area}:${date}`,
      (v: SpotDay | null) => (v ? ctx.ttl.spotDay : ctx.ttl.spotMissing),
      (signal) => fetchDay(area, date, signal),
      { signal: options.signal, source: "elprisetjustnu" },
    );
  };

  const client: SpotClient = {
    day,

    async prices(areaInput, options = {}) {
      const area = toSpotArea(areaInput);
      const now = ctx.now();
      const [today, tomorrow] = await Promise.all([
        day(area, swedishDate(now), options),
        // Tomorrow is optional: a failure there must not hide today's prices.
        day(area, swedishDate(now, 1), options).catch(() => null),
      ]);
      return { area, today, tomorrow, fetchedAt: new Date(now).toISOString() };
    },

    async overview(areaInput, options = {}) {
      const { area, today, tomorrow, fetchedAt } = await client.prices(areaInput, options);
      const now = ctx.now();
      const windowHours = options.windowHours ?? 3;
      const todaySummary = today ? summarizeSpotPrices(today.points, { now, windowHours }) : null;
      return {
        area,
        current: todaySummary?.current ?? null,
        today: todaySummary,
        tomorrow: tomorrow ? summarizeSpotPrices(tomorrow.points, { now: stockholmMidnight(tomorrow.date) - 1, windowHours }) : null,
        fetchedAt,
      };
    },

    async history(areaInput, from, to, options = {}) {
      const area = toSpotArea(areaInput);
      if (!isCalendarDate(from) || !isCalendarDate(to)) throw new RangeError("from and to must be dates (YYYY-MM-DD)");
      if (to < from) throw new RangeError("to must not be before from");
      const dates: string[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
      const maxDays = options.maxDays ?? 366;
      if (dates.length > maxDays) throw new RangeError(`At most ${maxDays} days per request`);
      const found = new Map<string, SpotDay>();
      const missing: SpotHistory["missing"] = [];
      let index = 0;
      const worker = async (): Promise<void> => {
        while (index < dates.length) {
          const date = dates[index++];
          try {
            const result = await day(area, date, { signal: options.signal });
            if (!result) missing.push({ date, reason: "not published" });
            else if (!result.complete) missing.push({ date, reason: "incomplete" });
            else found.set(date, result);
          } catch (error) {
            if (options.signal?.aborted) throw error;
            missing.push({ date, reason: error instanceof Error ? error.message : String(error) });
          }
        }
      };
      const workers = Math.max(1, Math.min(options.concurrency ?? 2, dates.length));
      await Promise.all(Array.from({ length: workers }, worker));
      return {
        area,
        from,
        to,
        days: dates.flatMap((date) => (found.has(date) ? [found.get(date) as SpotDay] : [])),
        missing: missing.sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
  };
  return client;
}
