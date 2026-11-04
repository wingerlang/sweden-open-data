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
export { createEconomyClient, scbDataUrl } from "./client.js";
export { addMonths, adjustForInflation, annualAverage, averageAnnualInflation, CPI_INDICES, CPI_SOURCE, CPI_TABLES, cpiAt, cpiRange, deflate, inflationRate, inflationRates, isCpiIndex, latestCpi, parseScbMonthly, realChange, spliceSeries, toMonth, } from "./cpi.js";
export { createHousingClient, parseHousing, isHousingRegion, HOUSING_SOURCE, HOUSING_REGIONS, } from "./housing.js";
export { createMortgageRateClient, parseMortgageRates, mortgageBindingFor, mortgageRateAt, MORTGAGE_BINDINGS, MORTGAGE_RATE_SOURCE, } from "./mortgage.js";
export { createBankRateClient, parseHandelsbankenRates, bankListRateFor, isMortgageBank, MORTGAGE_BANKS, } from "./banks.js";
