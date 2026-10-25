/** Public market-data contracts. No personal holdings or trades.
 * @module
 */
export interface ChartPoint {
  adjustedClose?: number;
  splitAdjustedDividendPerShare?: number;
  splitAdjustedPrice?: number;
  splitAdjustedHigh?: number;
  openPrice?: number;
  cashDividendPerShare?: number;
  splitRatio?: number;
  marketEventsKnown?: boolean;
  dividendYieldPct?: number | null;
  date: string;
  price: number;
  volume?: number;
}

/** Public data shape for LiveMarketQuote. */
export interface LiveMarketQuote {
  events?: MarketEvent[];
  analytics?: MarketAnalytics;
  checkedAt?: string;
  marketSession?: { open: number; close: number; timezone?: string };
  sharesOutstanding?: number | null;
  sharesOutstandingDate?: string;
  marketCapDate?: string;
  marketCapValue?: number | null;
  marketCapMethod?: "reported" | "shares-times-price";
  corporateSplits?: { date: number; numerator: number; denominator: number }[];
  symbol: string;
  name: string;
  latestPrice: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  turnoverKr: number | null;
  marketCap: string;
  peRatio: number | null;
  dividendYieldPct: number | null;
  dividendPerShare: number | null;
  currency: string;
  exchange: string;
  lastUpdated: string;
  isLive: boolean;
  sourceName: string;
  charts: {
    "1D": ChartPoint[];
    "1M": ChartPoint[];
    "3M": ChartPoint[];
    "1Å": ChartPoint[];
    "3Å": ChartPoint[];
    MAX: ChartPoint[];
  };
}

/** Public data shape for MarketEvent. */
export interface MarketEvent {
  date: string;
  type: "dividend" | "split" | "earnings" | "report";
  label: string;
  amount?: number;
  currency?: string;
  url?: string;
  estimated?: boolean;
}
/** Public data shape for MarketAnalytics. */
export interface MarketAnalytics {
  version: 1;
  observations: number;
  ma50: number | null;
  ma200: number | null;
  periods: Record<
    string,
    {
      from: string;
      to: string;
      priceReturn: number | null;
      totalReturn: number | null;
      volatility: number | null;
      maxDrawdown: number | null;
      dividends: number | null;
      observations: number;
    }
  >;
}
/** Public data shape for MarketPayload. */
export interface MarketPayload extends Omit<LiveMarketQuote, "charts"> {
  liveCharts: LiveMarketQuote["charts"];
  historyRebuiltAt?: string;
  fetchedAt: string;
  stale?: boolean;
}
/** Public data shape for MarketFundamentals. */
export interface MarketFundamentals {
  symbol?: string | null;
  currency: string | null;
  financialCurrency: string | null;
  profile: {
    name: string | null;
    sector: string | null;
    industry: string | null;
    employees: number | null;
    website: string | null;
    summary: string | null;
    ceo: string | null;
    city: string | null;
    country: string | null;
  };
  valuation: Record<string, number | null>;
  financials: Record<string, number | null>;
  events: Record<"earningsDate" | "exDividendDate" | "dividendDate", string | null>;
}
/** Public data shape for MarketIndexPoint. */
export interface MarketIndexPoint {
  date: string;
  price: number;
}
/** Public data shape for MarketIndexSeries. */
export interface MarketIndexSeries {
  id: string;
  currency: string;
  points: MarketIndexPoint[];
  fetchedAt: string;
  sourceUrl: string;
  sourceName: string;
  stale?: boolean;
}
