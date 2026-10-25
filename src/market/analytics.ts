/** Moving averages and observed market-return statistics.
 * @module
 */
import type { ChartPoint, MarketAnalytics } from "./types.ts";

/** Moving averages use complete trading observations, including warm-up before the displayed range. */
export function movingAverage(points: readonly ChartPoint[], window: number): { date: string; value: number | null }[] {
  if (!Number.isInteger(window) || window < 1 || window > 10000) throw new RangeError("Invalid moving-average window");
  let sum = 0,
    missing = 0;
  const prices = points.map((p) => p.splitAdjustedPrice ?? p.price);
  return points.map((point, i) => {
    const value = prices[i]!;
    if (Number.isFinite(value) && value > 0) sum += value;
    else missing++;
    if (i >= window) {
      const old = prices[i - window]!;
      if (Number.isFinite(old) && old > 0) sum -= old;
      else missing--;
    }
    return { date: point.date, value: i + 1 >= window && !missing ? sum / window : null };
  });
}

/** Price and total-return statistics. Total return requires provider-adjusted closes throughout the period. */
export function marketAnalytics(input: readonly ChartPoint[], asOf: string): MarketAnalytics {
  const seen = new Map<string, ChartPoint>();
  for (const p of input)
    if (
      Number.isFinite(p.splitAdjustedPrice ?? p.price) &&
      (p.splitAdjustedPrice ?? p.price) > 0 &&
      Number.isFinite(Date.parse(p.date)) &&
      p.date.slice(0, 10) <= asOf.slice(0, 10)
    )
      seen.set(p.date.slice(0, 10), p);
  const points = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date)),
    end = new Date(asOf.slice(0, 10) + "T12:00:00Z");
  const ma50 = movingAverage(points, 50).at(-1)?.value ?? null,
    ma200 = movingAverage(points, 200).at(-1)?.value ?? null,
    periods: MarketAnalytics["periods"] = {};
  for (const period of ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"]) {
    const start = new Date(end);
    if (period === "YTD") start.setUTCMonth(0, 1);
    else if (period !== "MAX") {
      const months =
          period === "1M"
            ? 1
            : period === "3M"
              ? 3
              : period === "6M"
                ? 6
                : period === "1Y"
                  ? 12
                  : period === "3Y"
                    ? 36
                    : 60,
        day = start.getUTCDate();
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - months);
      start.setUTCDate(
        Math.min(day, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()),
      );
    }
    const at = period === "MAX" ? 0 : points.findIndex((p) => p.date.slice(0, 10) >= start.toISOString().slice(0, 10)),
      rows = at < 0 ? [] : points.slice(Math.max(0, at - 1)),
      first = rows[0],
      last = rows.at(-1);
    if (!first || !last) continue;
    const covered =
        rows.length > 1 && (period === "MAX" || Math.abs(Date.parse(first.date) - start.getTime()) < 8 * 86400000),
      price = (p: ChartPoint): number => p.splitAdjustedPrice ?? p.price;
    const totalKnown = covered && rows.every((p) => Number.isFinite(p.adjustedClose) && p.adjustedClose! > 0),
      daily: number[] = [];
    let peak = price(first),
      drawdown = 0;
    for (let i = 1; i < rows.length; i++) {
      const value = price(rows[i]!);
      daily.push(Math.log(value / price(rows[i - 1]!)));
      peak = Math.max(peak, value);
      drawdown = Math.min(drawdown, value / peak - 1);
    }
    const average = daily.reduce((a, b) => a + b, 0) / (daily.length || 1),
      variance = daily.length > 1 ? daily.reduce((s, r) => s + (r - average) ** 2, 0) / (daily.length - 1) : null;
    periods[period] = {
      from: first.date,
      to: last.date,
      observations: rows.length,
      priceReturn: covered ? price(last) / price(first) - 1 : null,
      totalReturn: totalKnown ? last.adjustedClose! / first.adjustedClose! - 1 : null,
      maxDrawdown: covered ? drawdown : null,
      volatility: covered && variance !== null ? Math.sqrt(variance * 252) : null,
      dividends: rows.every((p) => p.marketEventsKnown === true && Number.isFinite(p.splitAdjustedDividendPerShare))
        ? rows.slice(1).reduce((s, p) => s + (p.splitAdjustedDividendPerShare || 0), 0)
        : null,
    };
  }
  return { version: 1, observations: points.length, ma50, ma200, periods };
}

/** Rebase an observed series at its first valid value; never fill missing trading days. */
export function rebaseMarketSeries(
  points: readonly { date: string; value: number | null }[],
): { date: string; value: number | null }[] {
  const first = points.find((p) => p.value !== null && Number.isFinite(p.value) && p.value > 0)?.value;
  return points.map((p) => ({
    date: p.date,
    value: first && p.value !== null && Number.isFinite(p.value) ? (p.value / first - 1) * 100 : null,
  }));
}
