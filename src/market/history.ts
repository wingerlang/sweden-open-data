/** Merge and freshness rules for public market histories.
 * @module
 */
import { marketAnalytics } from "./analytics.ts";
import type { ChartPoint, LiveMarketQuote } from "./types.ts";
/**
 * Historiska dagskurser ändras inte i efterhand, så när en full historik (MAX) redan finns
 * räcker det att hämta det senaste året och lägga till de nya dagarna. En ny split gör att
 * leverantören räknar om all historik – då returneras null och hela historiken hämtas igen.
 */
const DAY = 86400000;
/** Schema capability, not cache age: older cached quotes must be upgraded for analysis. */
export function hasAdjustedHistory(points: readonly ChartPoint[] | undefined): boolean {
  return (
    !!points?.length &&
    points.every(
      (p) =>
        Number.isFinite(p.splitAdjustedPrice) &&
        p.splitAdjustedPrice! > 0 &&
        p.marketEventsKnown === true &&
        Number.isFinite(p.cashDividendPerShare),
    )
  );
}
const splitKey = (s: { date: number; numerator: number; denominator: number }) =>
  `${s.date}:${s.numerator}/${s.denominator}`;
/** Merge and freshness rules for public market histories. */
export function rebuildCharts(points: ChartPoint[], now: number = Date.now()): LiveMarketQuote["charts"] {
  const since = (days: number) => points.filter((p) => Date.parse(p.date) >= now - days * DAY);
  return { "1D": [], "1M": since(31), "3M": since(93), "1Å": since(366), "3Å": since(3 * 366), MAX: points };
}
/** Merge and freshness rules for public market histories. */
export function mergeQuoteHistory(
  cached: LiveMarketQuote,
  fresh: LiveMarketQuote,
  now: number = Date.now(),
): LiveMarketQuote | null {
  const old = cached.charts.MAX,
    tail = fresh.charts["1Å"].length ? fresh.charts["1Å"] : fresh.charts.MAX;
  if (
    !old.length ||
    !tail.length ||
    cached.currency !== fresh.currency ||
    cached.symbol.toUpperCase() !== fresh.symbol.toUpperCase()
  )
    return null;
  const known = new Set((cached.corporateSplits || []).map(splitKey));
  if ((fresh.corporateSplits || []).some((s) => !known.has(splitKey(s)))) return null;
  const lastDay = old.at(-1)!.date.slice(0, 10);
  // The fresh year must overlap the cached history, otherwise there would be a silent gap.
  if (tail[0].date.slice(0, 10) > lastDay) return null;
  const overlap = old.find((p) => p.date.slice(0, 10) === tail[0].date.slice(0, 10)),
    scale = overlap?.adjustedClose && tail[0].adjustedClose ? tail[0].adjustedClose / overlap.adjustedClose : 1;
  const byDay = new Map(
    old.map((p) => [
      p.date.slice(0, 10),
      p.adjustedClose && scale !== 1 ? { ...p, adjustedClose: p.adjustedClose * scale } : p,
    ]),
  );
  for (const point of tail) byDay.set(point.date.slice(0, 10), point);
  const merged = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...fresh,
    analytics: marketAnalytics(merged, new Date(now).toISOString()),
    events: [
      ...(cached.events || []).filter((e) => e.date.slice(0, 10) < tail[0].date.slice(0, 10)),
      ...(fresh.events || []),
    ],
    dividendPerShare: fresh.dividendPerShare ?? cached.dividendPerShare,
    dividendYieldPct: fresh.dividendYieldPct ?? cached.dividendYieldPct,
    corporateSplits: cached.corporateSplits,
    charts: rebuildCharts(merged, now),
  };
}
/** Hur länge en hämtad kurs räknas som färsk innan den hämtas igen. */
export const quoteFreshness: Record<"1d" | "5d" | "1mo" | "1y" | "max", number> = {
  "1d": 60000,
  "5d": 5 * 60000,
  "1mo": 10 * 60000,
  "1y": 10 * 60000,
  max: 10 * 60000,
};
const clocks = new Map<string, Intl.DateTimeFormat>();
function exchangeParts(time: number, zone: string) {
  let clock = clocks.get(zone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    clocks.set(zone, clock);
    if (clocks.size > 20) clocks.delete(clocks.keys().next().value!);
  }
  return Object.fromEntries(clock.formatToParts(time).map((p) => [p.type, p.value]));
}
/** Merge and freshness rules for public market histories. */
export function quoteLocalDay(quote: Pick<LiveMarketQuote, "marketSession">, time: number): string {
  const p = exchangeParts(time, quote.marketSession?.timezone || "Europe/Stockholm");
  return p.year + "-" + p.month + "-" + p.day;
}
/** Keep a verified closing quote until the next possible regular session, including weekends.
 * Unknown sessions use the short TTL; holidays are checked conservatively on the next weekday. */
export function quoteCacheFresh(
  quote: LiveMarketQuote,
  savedAt: number,
  ttl: number,
  now: number = Date.now(),
): boolean {
  if (now < savedAt) return false;
  if (now - savedAt < ttl) return true;
  const session = quote.marketSession;
  if (
    !session ||
    !Number.isFinite(session.open) ||
    !Number.isFinite(session.close) ||
    session.close <= session.open ||
    now - savedAt > 4 * 86400000
  )
    return false;
  if (now < session.open * 1000) return true;
  if (now < session.close * 1000 || savedAt < session.close * 1000 + 15 * 60000) return false;
  try {
    const parts = (time: number) => exchangeParts(time, session.timezone || "Europe/Stockholm");
    const open = parts(session.open * 1000),
      close = parts(session.close * 1000),
      current = parts(now);
    const date = (p: Record<string, string>) => Date.UTC(+p.year, +p.month - 1, +p.day);
    let next = date(close) + 86400000;
    while ([0, 6].includes(new Date(next).getUTCDay())) next += 86400000;
    return (
      date(current) < next ||
      (date(current) === next && +current.hour * 60 + +current.minute < +open.hour * 60 + +open.minute)
    );
  } catch {
    return false;
  }
}
/** A lightweight quote must not erase already fetched fundamentals or chart periods. */
export function combineQuotes(cached: LiveMarketQuote, fresh: LiveMarketQuote): LiveMarketQuote {
  if (cached.symbol.toUpperCase() !== fresh.symbol.toUpperCase() || cached.currency !== fresh.currency) return fresh;
  const splitChanged = (fresh.corporateSplits || []).some(
    (s) => !(cached.corporateSplits || []).some((old) => splitKey(old) === splitKey(s)),
  );
  const result = {
    ...cached,
    ...fresh,
    charts: splitChanged
      ? fresh.charts
      : { ...cached.charts, ...Object.fromEntries(Object.entries(fresh.charts).filter(([, points]) => points.length)) },
  };
  delete (result as unknown as Record<string, unknown>).liveCharts;
  for (const field of [
    "sharesOutstanding",
    "sharesOutstandingDate",
    "marketCapValue",
    "marketCapDate",
    "marketCapMethod",
    "dividendPerShare",
    "dividendYieldPct",
  ] as const)
    if (fresh[field] == null && cached[field] != null)
      (result as unknown as Record<string, unknown>)[field] = cached[field];
  if (fresh.marketCap === "Saknas") result.marketCap = cached.marketCap;
  if (result.marketCapMethod === "shares-times-price" && result.sharesOutstanding) {
    result.marketCapValue = result.sharesOutstanding * fresh.latestPrice;
    result.marketCap = String(result.marketCapValue);
  }
  return result;
}
