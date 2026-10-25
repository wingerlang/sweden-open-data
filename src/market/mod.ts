/** Experimental market adapters and pure public-data calculations.
 * @module
 */
/** Experimental public market adapters. Provider access does not imply an open redistribution licence. */
export {
  createMarketClient,
  type MarketClient,
  type MarketReadOptions,
  type MarketReports,
  type MarketSearchResult,
} from "./client.ts";
export { marketIndices, parseIndexCsv, parseNasdaqIndex, type MarketIndex } from "./indices.ts";
export { marketAnalytics, movingAverage, rebaseMarketSeries } from "./analytics.ts";
export {
  hasAdjustedHistory,
  rebuildCharts,
  mergeQuoteHistory,
  quoteFreshness,
  quoteLocalDay,
  quoteCacheFresh,
  combineQuotes,
} from "./history.ts";
export { fetchMarketQuote } from "./quote.ts";
export { fetchMarketFundamentals, fetchMarketReports, type PressRelease } from "./company.ts";
export { createMarketReadCache, type MarketRead } from "./cache.ts";
export type {
  ChartPoint,
  LiveMarketQuote,
  MarketPayload,
  MarketFundamentals,
  MarketIndexPoint,
  MarketIndexSeries,
  MarketEvent,
  MarketAnalytics,
} from "./types.ts";
export {
  stockPeriods,
  type StockPeriod,
  adjustedChartPoints,
  periodStart,
  stockSeries,
  periodPerformance,
} from "./series.ts";
export { companyMarketEvents, enrichMarketQuote, type MarketCompanyData } from "./events.ts";
export { quoteCapitalization, type MarketCapitalization } from "./capitalization.ts";
