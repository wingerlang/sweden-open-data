/** Dated public reports and corporate actions attached to a market quote.
 * @module
 */
import type { LiveMarketQuote, MarketEvent, MarketFundamentals } from "./types.ts";
import type { PressRelease } from "./company.ts";
/** Public data shape for MarketCompanyData. */
export interface MarketCompanyData {
  symbol: string;
  fetchedAt: string;
  fundamentals: MarketFundamentals | null;
  news: { items: PressRelease[] } | null;
}
const reportPattern = new RegExp(
  [
    "delårsrapport",
    "kvartalsrapport",
    "bokslut",
    "årsredovisning",
    "interim report",
    "annual report",
    "year.end report",
    "quarterly report",
    "financial report",
  ].join("|"),
  "i",
);
/** Report publication dates are source dates, never inferred fiscal period-end dates. */
export function companyMarketEvents(
  fundamentals: MarketFundamentals | null | undefined,
  reports: readonly PressRelease[],
): MarketEvent[] {
  const events: MarketEvent[] = [];
  for (const item of reports)
    if (
      item.date &&
      reportPattern.test(item.title) &&
      !/(inbjudan|invitation|inför|kommer|presentation|will publish)/i.test(item.title) &&
      Number.isFinite(Date.parse(item.date)) &&
      /^https:\/\/([a-z]+\.)?mfn\.se\//.test(item.url)
    )
      events.push({ date: item.date, type: "report", label: item.title, url: item.url });
  if (fundamentals?.events?.earningsDate)
    events.push({
      date: fundamentals.events.earningsDate,
      type: "earnings",
      label: "Rapportdatum · kurskälla, preliminärt",
      estimated: true,
    });
  if (fundamentals?.events?.exDividendDate)
    events.push({
      date: fundamentals.events.exDividendDate,
      type: "dividend",
      label: "Utdelning · X-dag enligt kurskälla",
    });
  return events;
}
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
/** Public company totals only. A holding quantity is never a capitalization input. */
export function enrichMarketQuote(quote: LiveMarketQuote, data?: MarketCompanyData): LiveMarketQuote {
  if (
    !data ||
    data.symbol.toUpperCase() !== quote.symbol.toUpperCase() ||
    (data.fundamentals?.currency && data.fundamentals.currency !== quote.currency)
  )
    return quote;
  if (!data.fundamentals)
    return { ...quote, events: [...(quote.events || []), ...companyMarketEvents(undefined, data.news?.items || [])] };
  const v = data.fundamentals.valuation,
    shares = positive(quote.sharesOutstanding)
      ? quote.sharesOutstanding
      : positive(v.sharesOutstanding)
        ? v.sharesOutstanding
        : null,
    reported = positive(quote.marketCapValue) ? quote.marketCapValue : positive(v.marketCap) ? v.marketCap : null,
    cap = reported ?? (shares && positive(quote.latestPrice) ? shares * quote.latestPrice : null);
  return {
    ...quote,
    events: [...(quote.events || []), ...companyMarketEvents(data.fundamentals, data.news?.items || [])],
    sharesOutstanding: shares,
    sharesOutstandingDate: positive(quote.sharesOutstanding)
      ? quote.sharesOutstandingDate
      : shares
        ? data.fetchedAt
        : undefined,
    marketCapValue: cap,
    marketCapMethod:
      reported !== null
        ? positive(quote.marketCapValue)
          ? quote.marketCapMethod || "reported"
          : "reported"
        : cap !== null
          ? "shares-times-price"
          : undefined,
    marketCapDate: positive(quote.marketCapValue) ? quote.marketCapDate : cap !== null ? data.fetchedAt : undefined,
  };
}
