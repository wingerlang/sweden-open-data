/**
 * Swedish economic statistics: consumer price indices (KPI, KPIF, KPIF-XE) from SCB and pure inflation arithmetic –
 * an amount in today's money, the inflation rate for any period, a salary compared with prices, real values of a series.
 * Regional house prices and official average household mortgage rates (new and outstanding loans per fixed-rate
 * band). Experimental: one bank's published list rates and monthly averages (`createBankRateClient`).
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
export {
  createHousingClient,
  parseHousing,
  isHousingRegion,
  HOUSING_SOURCE,
  HOUSING_REGIONS,
  type HousingFrequency,
  type HousingPoint,
  type HousingSeries,
  type HousingOptions,
  type HousingClient,
} from "./housing.ts";
export {
  createMortgageRateClient,
  parseMortgageRates,
  mortgageBindingFor,
  mortgageRateAt,
  MORTGAGE_BINDINGS,
  MORTGAGE_RATE_SOURCE,
  type MortgageAgreement,
  type MortgageBinding,
  type MortgageRateClient,
  type MortgageRatePoint,
  type MortgageRates,
  type MortgageRateSeries,
} from "./mortgage.ts";
export {
  createBankRateClient,
  parseHandelsbankenRates,
  bankListRateFor,
  isMortgageBank,
  MORTGAGE_BANKS,
  type BankAverageRate,
  type BankListRate,
  type BankMortgageRates,
  type BankRateClient,
  type MortgageBank,
} from "./banks.ts";
