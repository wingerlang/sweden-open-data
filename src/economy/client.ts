/**
 * Economy client: consumer price indices from SCB, fetched once, cached in memory and – with a
 * {@link PersistentStore} – kept across restarts and served when SCB cannot be reached.
 *
 * @module
 */
import { type ClientOptions, type Context, createContext, storeGet, storeSet } from "../core/context.ts";
import { CPI_SOURCE, CPI_TABLES, type CpiIndex, type CpiSeries, isCpiIndex, parseScbMonthly, spliceSeries } from "./cpi.ts";

/** Options for {@link EconomyClient.cpi}. */
export interface CpiOptions {
  signal?: AbortSignal;
}

/** Economic statistics. */
export interface EconomyClient {
  /**
   * A complete monthly consumer price index (2020=100). SCB publishes once a month, so the series is cached
   * ({@link CacheTtl.cpi}, default 6 h). With a store, the last good series is returned (marked `stale`) when SCB fails.
   */
  cpi(index?: CpiIndex, options?: CpiOptions): Promise<CpiSeries>;
}

/** The SCB table/data URL for one content code, all months. */
export function scbDataUrl(base: string, table: string, content: string): string {
  return `${base.replace(/\/+$/, "")}/tables/${encodeURIComponent(table)}/data?lang=sv&outputFormat=json-stat2`
    + `&valueCodes[ContentsCode]=${encodeURIComponent(content)}&valueCodes[Tid]=*`;
}

const isSeries = (v: unknown, index: CpiIndex): v is CpiSeries =>
  !!v && typeof v === "object" && (v as CpiSeries).index === index && Array.isArray((v as CpiSeries).points)
  && (v as CpiSeries).points.length > 0 && typeof (v as CpiSeries).fetchedAt === "string";

/**
 * Creates an {@link EconomyClient}.
 *
 * @example What 10 000 kr from 1995 is worth today
 * ```ts
 * import { createEconomyClient, adjustForInflation } from "@wingerlang/sweden-open-data/economy";
 *
 * const economy = createEconomyClient();
 * const kpi = await economy.cpi("KPI");
 * console.log(adjustForInflation(kpi, 10_000, "1995-01").amount);
 * ```
 */
export function createEconomyClient(options: ClientOptions | Context = {}): EconomyClient {
  const ctx = createContext(options);
  return {
    cpi(index = "KPI", options = {}) {
      if (!isCpiIndex(index)) return Promise.reject(new RangeError(`Unknown index ${String(index)}`));
      const key = `cpi:${index}`;
      return ctx.cache.get(key, ctx.ttl.cpi, async () => {
        const stored = await storeGet(ctx.store, key);
        const kept = isSeries(stored, index) ? stored : undefined;
        if (kept && ctx.now() - Date.parse(kept.fetchedAt) < ctx.ttl.cpi) return { ...kept, stale: undefined };
        try {
          const def = CPI_TABLES[index];
          const parts = await Promise.all(def.parts.map(async (part) =>
            parseScbMonthly(await ctx.http.json("scb", scbDataUrl(ctx.endpoints.scb, part.table, part.content), { signal: options.signal }), part.content)));
          const points = spliceSeries(parts.map((p) => p.points));
          if (!points.length) throw new RangeError(`SCB returned no values for ${index}`);
          const updated = parts.map((p) => p.updated).filter((u): u is string => !!u).sort().at(-1);
          const series: CpiSeries = {
            index,
            label: def.label,
            base: "2020=100",
            points,
            ...(updated ? { updated } : {}),
            fetchedAt: new Date(ctx.now()).toISOString(),
            source: CPI_SOURCE.name,
            sourceUrl: CPI_SOURCE.url,
            tables: def.parts.map((p) => p.table),
          };
          await storeSet(ctx.store, key, series);
          return series;
        } catch (error) {
          if (kept && !options.signal?.aborted) return { ...kept, stale: true };
          throw error;
        }
      });
    },
  };
}
