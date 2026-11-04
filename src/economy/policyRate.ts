/** The Riksbank's policy rate (styrräntan), as the Riksbank publishes it in its open SWEA API. @module */
import { createContext, type ClientOptions, type Context } from "../core/context.ts";
import { cachedWithStore } from "../core/source.ts";
import { invalidResponse } from "../core/parse.ts";
import { isCalendarDate } from "../core/time.ts";

/** The policy rate from the date a decision took effect, in percent per year. Negative rates are valid. */
export interface PolicyRatePoint {
  /** Calendar date, `YYYY-MM-DD`, from which the rate applied. */
  readonly date: string;
  readonly ratePct: number;
}
/** The policy rate over time, one point per change (plus the latest observation), oldest first. */
export interface PolicyRateSeries {
  readonly points: readonly PolicyRatePoint[];
  readonly source: string;
  readonly sourceUrl: string;
  /** Riksbank series id. */
  readonly seriesId: string;
  readonly fetchedAt: string;
  /** `true` when the Riksbank could not be reached and the last good copy from the store was returned. */
  readonly stale?: boolean;
}
/** Official source for the policy rate. */
export const POLICY_RATE_SOURCE: { readonly name: string; readonly url: string; readonly license: string } = {
  name: "Riksbanken · styrränta",
  url: "https://www.riksbank.se/sv/statistik/sok-rantor--valutakurser/",
  license: "Open data from the Riksbank; credit Sveriges riksbank as the source.",
};
/** Riksbank series id of the effective policy rate. */
const SERIES_ID = "SECBREPOEFF";
/** First date requested; the series starts in 1994 but earlier dates are harmless. */
const FROM = "1985-01-01";

/**
 * Validates the Riksbank's observation list (`[{ date, value }]`) and reduces it to the dates where the rate changed,
 * plus the latest observation, so the series stays small. Throws an `invalid-response` error for anything else.
 */
export function parsePolicyRate(raw: unknown): PolicyRatePoint[] {
  const fail = (message: string): never => {
    throw invalidResponse("riksbank", message);
  };
  if (!Array.isArray(raw) || !raw.length) return fail("The Riksbank returned no policy-rate observations");
  if (raw.length > 30000) return fail("The Riksbank returned too many policy-rate observations");
  const points = raw.map((row: unknown): PolicyRatePoint => {
    const r = row as { date?: unknown; value?: unknown } | null;
    if (!r || !isCalendarDate(r.date)) return fail("Invalid policy-rate date");
    if (typeof r.value !== "number" || !Number.isFinite(r.value) || r.value < -20 || r.value > 100)
      return fail("Invalid policy rate");
    return { date: r.date, ratePct: r.value };
  });
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points.filter((p, i) => i === 0 || i === points.length - 1 || p.ratePct !== points[i - 1].ratePct);
}

/** The policy rate that applied on `date` (`YYYY-MM-DD`), or `undefined` before the first observation. */
export function policyRateAt(series: Pick<PolicyRateSeries, "points">, date: string): number | undefined {
  let found: number | undefined;
  for (const p of series.points) {
    if (p.date > date) break;
    found = p.ratePct;
  }
  return found;
}

/** The Riksbank policy rate. */
export interface PolicyRateClient {
  /**
   * The whole policy-rate history. Cached like other monthly statistics ({@link CacheTtl.cpi}); with a store the last
   * good series is returned (marked `stale`) when the Riksbank cannot be reached.
   */
  policyRate(options?: { signal?: AbortSignal }): Promise<PolicyRateSeries>;
}
/** Reads the policy rate from the Riksbank's open SWEA API; durably cached with last-good fallback. */
export function createPolicyRateClient(options: ClientOptions | Context = {}): PolicyRateClient {
  const ctx = createContext(options);
  return {
    policyRate(options = {}) {
      return cachedWithStore<PolicyRateSeries>(
        ctx,
        "policy-rate:v1",
        ctx.ttl.cpi,
        (v): v is PolicyRateSeries =>
          !!v &&
          typeof v === "object" &&
          Array.isArray((v as PolicyRateSeries).points) &&
          (v as PolicyRateSeries).points.length > 0 &&
          typeof (v as PolicyRateSeries).fetchedAt === "string",
        async (signal) => {
          const to = new Date(ctx.now()).toISOString().slice(0, 10);
          const url = `${ctx.endpoints.riksbank.replace(/\/+$/, "")}/Observations/${SERIES_ID}/${FROM}/${to}`;
          return {
            points: parsePolicyRate(await ctx.http.json("riksbank", url, { signal })),
            source: POLICY_RATE_SOURCE.name,
            sourceUrl: POLICY_RATE_SOURCE.url,
            seriesId: SERIES_ID,
            fetchedAt: new Date(ctx.now()).toISOString(),
          };
        },
        { signal: options.signal, source: "riksbank" },
      );
    },
  };
}
