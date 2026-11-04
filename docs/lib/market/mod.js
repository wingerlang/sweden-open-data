/** Experimental market adapters and pure public-data calculations.
 * @module
 */
/** Experimental public market adapters. Provider access does not imply an open redistribution licence. */
export { createMarketClient, } from "./client.js";
export { marketIndices, parseIndexCsv, parseNasdaqIndex } from "./indices.js";
export { marketAnalytics, movingAverage, rebaseMarketSeries } from "./analytics.js";
export { hasAdjustedHistory, rebuildCharts, mergeQuoteHistory, quoteFreshness, quoteLocalDay, quoteCacheFresh, combineQuotes, } from "./history.js";
export { fetchMarketQuote } from "./quote.js";
export { fetchMarketFundamentals, fetchMarketReports } from "./company.js";
export { createMarketReadCache } from "./cache.js";
export { stockPeriods, adjustedChartPoints, periodStart, stockSeries, periodPerformance, } from "./series.js";
export { companyMarketEvents, enrichMarketQuote } from "./events.js";
export { quoteCapitalization } from "./capitalization.js";
