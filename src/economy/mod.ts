/**
 * Swedish economic statistics: consumer price indices (KPI, KPIF, KPIF-XE) from SCB and pure inflation arithmetic –
 * an amount in today's money, the inflation rate for any period, a salary compared with prices, real values of a series.
 *
 * ```ts
 * import { createEconomyClient, adjustForInflation, realChange } from "@wingerlang/sweden-open-data/economy";
 *
 * const kpi = await createEconomyClient().cpi("KPI");
 * adjustForInflation(kpi, 10_000, "2000-01").amount;
 * realChange(kpi, { amount: 32_000, month: "2018-01" }, { amount: 41_000, month: "2026-09" }).real;
 * ```
 *
 * @module
 */
export { createEconomyClient, scbDataUrl, type CpiOptions, type EconomyClient } from "./client.ts";
export {
  addMonths,
  adjustForInflation,
  annualAverage,
  averageAnnualInflation,
  CPI_INDICES,
  CPI_SOURCE,
  CPI_TABLES,
  cpiAt,
  cpiRange,
  deflate,
  inflationRate,
  inflationRates,
  isCpiIndex,
  latestCpi,
  parseScbMonthly,
  realChange,
  spliceSeries,
  toMonth,
  type CpiIndex,
  type CpiPoint,
  type CpiSeries,
  type CpiTablePart,
  type DatedAmount,
  type InflationAdjustment,
  type RealChange,
} from "./cpi.ts";
