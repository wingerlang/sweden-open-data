/**
 * Economy client: consumer price indices from SCB, fetched once, cached in memory and – with a
 * {@link PersistentStore} – kept across restarts and served when SCB cannot be reached.
 *
 * @module
 */
import { createContext } from "../core/context.js";
import { cachedWithStore } from "../core/source.js";
import { createHousingClient } from "./housing.js";
import { createMortgageRateClient } from "./mortgage.js";
import { CPI_SOURCE, CPI_TABLES, isCpiIndex, parseScbMonthly, spliceSeries, } from "./cpi.js";
/** The SCB table/data URL for one content code, all months. */
export function scbDataUrl(base, table, content) {
    return (`${base.replace(/\/+$/, "")}/tables/${encodeURIComponent(table)}/data?lang=sv&outputFormat=json-stat2` +
        `&valueCodes[ContentsCode]=${encodeURIComponent(content)}&valueCodes[Tid]=*`);
}
const isSeries = (v, index) => !!v &&
    typeof v === "object" &&
    v.index === index &&
    Array.isArray(v.points) &&
    v.points.length > 0 &&
    typeof v.fetchedAt === "string";
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
export function createEconomyClient(options = {}) {
    const ctx = createContext(options);
    return {
        ...createHousingClient(ctx),
        ...createMortgageRateClient(ctx),
        cpi(index = "KPI", options = {}) {
            if (!isCpiIndex(index))
                return Promise.reject(new RangeError(`Unknown index ${String(index)}`));
            const key = `cpi:${index}`;
            return cachedWithStore(ctx, key, ctx.ttl.cpi, (v) => isSeries(v, index), async (signal) => {
                const def = CPI_TABLES[index];
                const parts = await Promise.all(def.parts.map(async (part) => parseScbMonthly(await ctx.http.json("scb", scbDataUrl(ctx.endpoints.scb, part.table, part.content), { signal }), part.content)));
                const points = spliceSeries(parts.map((p) => p.points));
                if (!points.length)
                    throw new RangeError(`SCB returned no values for ${index}`);
                const updated = parts
                    .map((p) => p.updated)
                    .filter((u) => !!u)
                    .sort()
                    .at(-1);
                return {
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
            }, { signal: options.signal, source: "scb" });
        },
    };
}
