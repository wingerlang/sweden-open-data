/**
 * Electricity spot prices per Swedish price area (SE1–SE4): fetching, parsing and analysis.
 *
 * ```ts
 * import { createSpotClient, summarizeSpotPrices, formatOre } from "@wingerlang/sweden-open-data/spot";
 *
 * const { today } = await createSpotClient().prices("SE3");
 * const summary = summarizeSpotPrices(today!.points);
 * console.log(`Now ${formatOre(summary!.current!.sek)}, cheapest 3 h from ${summary!.cheapest!.start}`);
 * ```
 *
 * @module
 */
export * from "./prices.ts";
export * from "./client.ts";
