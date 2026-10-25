/** Select observed chart periods and price returns.
 * @module
 */
import type { ChartPoint, LiveMarketQuote } from "./types.ts";
/** Select observed chart periods and price returns. */
export const stockPeriods: readonly ["1D", "1M", "3M", "YTD", "1Å", "3Å", "MAX"] = [
  "1D",
  "1M",
  "3M",
  "YTD",
  "1Å",
  "3Å",
  "MAX",
];
/** Select observed chart periods and price returns. */
export type StockPeriod = (typeof stockPeriods)[number];
/** Select observed chart periods and price returns. */
export function adjustedChartPoints(quote: LiveMarketQuote, points: ChartPoint[]): ChartPoint[] {
  return points.map((p) => {
    const factor = (quote.corporateSplits || [])
      .filter((s) => s.date * 1000 > Date.parse(p.date) && s.numerator > 0 && s.denominator > 0)
      .reduce((f, s) => (f * s.numerator) / s.denominator, 1);
    return { ...p, price: p.splitAdjustedPrice ?? p.price / factor };
  });
}
/** Select observed chart periods and price returns. */
export function periodStart(period: StockPeriod, now: Date): string | null {
  const calendar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(now),
    d = new Date(calendar + "T12:00:00Z");
  if (period === "MAX") return null;
  if (period === "YTD")
    return `${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric" }).format(d)}-01-01`;
  if (period === "1D") d.setUTCDate(d.getUTCDate() - 1);
  else {
    const months = period === "1M" ? 1 : period === "3M" ? 3 : period === "1Å" ? 12 : 36,
      day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - months);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(d);
}
/** Select observed chart periods and price returns. */
export function stockSeries(quote: LiveMarketQuote, period: StockPeriod, now: Date = new Date()): ChartPoint[] {
  const source = period === "1D" ? quote.charts["1D"] : quote.charts.MAX.length ? quote.charts.MAX : quote.charts["1Å"];
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(now),
    points = adjustedChartPoints(quote, source)
      .filter((p) => p.date.slice(0, 10) <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
  if (period === "1D") return points;
  const start = periodStart(period, now);
  if (!start) return points;
  const first = points.findIndex((p) => p.date.slice(0, 10) >= start);
  if (first < 0) return [];
  return points.slice(Math.max(0, first - 1));
}
/** Select observed chart periods and price returns. */
export function periodPerformance(quote: LiveMarketQuote, period: StockPeriod, now: Date = new Date()): number | null {
  if (period === "1D")
    return quote.changePercent === null ||
      !Number.isFinite(quote.changePercent) ||
      now.getTime() - Date.parse(quote.lastUpdated) > 7 * 86400000
      ? null
      : quote.changePercent / 100;
  const points = stockSeries(quote, period, now),
    first = points[0],
    last = points.at(-1),
    start = periodStart(period, now);
  if (!first || !last || points.length < 2 || first.price <= 0) return null;
  if (start && Math.abs(Date.parse(first.date.slice(0, 10)) - Date.parse(start)) > 7 * 86400000) return null;
  if (now.getTime() - Date.parse(last.date) > 7 * 86400000) return null;
  return last.price / first.price - 1;
}
