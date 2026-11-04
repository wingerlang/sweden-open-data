import { finiteNumber, text } from "../core/parse.js";
/** Convert source quote observations without inventing missing prices. */
/** Time limit for one request to the quote provider, in milliseconds. */
const QUOTE_TIMEOUT_MS = 6000;
/** Fetches a quote and its history for one symbol from the provider and validates the response shape. */
export async function fetchMarketQuote(
  symbol,
  range,
  quoteOnly = false,
  signal,
  fetchImpl = fetch,
  now = Date.now,
  capitalization,
) {
  const timeoutMs = QUOTE_TIMEOUT_MS;
  const interval = range === "1d" ? "5m" : "1d";
  // Yahoo may silently aggregate range=max into monthly bars. Explicit dates
  // preserve daily observations and the dividend events needed for TTM yield.
  const period = range === "max" ? `period1=0&period2=${Math.floor(now() / 1000)}` : `range=${range}`;
  const response = await fetchImpl(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${period}&interval=${interval}&events=div%2Csplits`,
    {
      headers: { Accept: "application/json", "User-Agent": "Emergens/1.0" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? `Unknown symbol "${symbol}" (quote provider returned 404). Check the ticker, e.g. "VOLV-B.ST".`
        : `Quote provider failed for "${symbol}" with HTTP status ${response.status}. Try again later.`,
    );
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`Quote provider returned a response for "${symbol}" that is not valid JSON.`);
  }
  const body = parsed;
  const result = body?.chart?.result?.[0];
  const m = result?.meta;
  if (
    !m ||
    m.symbol?.toUpperCase() !== symbol.toUpperCase() ||
    !Number.isFinite(m.regularMarketPrice) ||
    typeof m.currency !== "string" ||
    !m.currency ||
    !Number.isFinite(m.regularMarketTime)
  )
    throw new Error(
      `Quote provider returned incomplete or mismatched data for "${symbol}" (missing price, currency or time, or another symbol).`,
    );
  const stamps = result.timestamp || [];
  if (stamps.length > 50000) throw Error("Too many quote observations");
  const closes = result.indicators?.quote?.[0]?.close || [];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const opens = result.indicators?.quote?.[0]?.open || [];
  const highs = result.indicators?.quote?.[0]?.high || [];
  const splits = Object.values(result.events?.splits || {}).filter(
    (s) =>
      Number.isFinite(s.date) &&
      Number.isFinite(s.numerator) &&
      s.numerator > 0 &&
      Number.isFinite(s.denominator) &&
      s.denominator > 0,
  );
  const dividends = Object.values(result.events?.dividends || {}).filter(
    (d) => Number.isFinite(d.date) && Number.isFinite(d.amount),
  );
  const factor = (time) => splits.filter((s) => s.date > time).reduce((f, s) => (f * s.numerator) / s.denominator, 1);
  const trailingDividend = (time) =>
    dividends
      .filter((d) => d.date <= time && d.date > time - 365.25 * 86400 && Number.isFinite(d.amount))
      .reduce((s, d) => s + (d.amount * factor(d.date)) / factor(time), 0);
  const covered = (time) => stamps.length > 0 && time - stamps[0] >= 365 * 86400;
  const points = stamps.flatMap((time, i) =>
    Number.isFinite(time) && Number.isFinite(closes[i])
      ? [
          {
            ...(Number.isFinite(adjusted[i]) && adjusted[i] > 0 ? { adjustedClose: adjusted[i] } : {}),
            date: new Date(time * 1000).toISOString(),
            price: closes[i] * factor(time),
            splitAdjustedPrice: closes[i],
            ...(Number.isFinite(highs[i]) ? { splitAdjustedHigh: highs[i] } : {}),
            ...(Number.isFinite(opens[i]) && opens[i] > 0 ? { openPrice: opens[i] * factor(time) } : {}),
            splitAdjustedDividendPerShare: dividends
              .filter(
                (d) =>
                  new Date(d.date * 1000).toISOString().slice(0, 10) ===
                  new Date(time * 1000).toISOString().slice(0, 10),
              )
              .reduce((sum, d) => sum + d.amount, 0),
            marketEventsKnown: range !== "1d",
            cashDividendPerShare: dividends
              .filter(
                (d) =>
                  new Date(d.date * 1000).toISOString().slice(0, 10) ===
                  new Date(time * 1000).toISOString().slice(0, 10),
              )
              .reduce((sum, d) => sum + d.amount * factor(d.date), 0),
            splitRatio: splits
              .filter(
                (s) =>
                  new Date(s.date * 1000).toISOString().slice(0, 10) ===
                  new Date(time * 1000).toISOString().slice(0, 10),
              )
              .reduce((f, s) => (f * s.numerator) / s.denominator, 1),
            dividendYieldPct:
              covered(time) && closes[i] > 0 ? (trailingDividend(time) / (closes[i] * factor(time))) * 100 : null,
          },
        ]
      : [],
  );
  const dividendPerShare = covered(m.regularMarketTime) ? trailingDividend(m.regularMarketTime) : null;
  const charts = {
    "1D": range === "1d" ? points : [],
    "1M": range === "1d" ? [] : points.filter((p) => Date.parse(p.date) >= now() - 31 * 86400000),
    "3M": range === "1d" ? [] : points.filter((p) => Date.parse(p.date) >= now() - 93 * 86400000),
    "1Å": range === "1d" ? [] : points.filter((p) => Date.parse(p.date) >= now() - 366 * 86400000),
    "3Å": range === "max" ? points.filter((p) => Date.parse(p.date) >= now() - 3 * 366 * 86400000) : [],
    MAX: range === "max" ? points : [],
  };
  const marketDay = new Date(m.regularMarketTime * 1000).toISOString().slice(0, 10);
  const previous =
    range === "1d"
      ? (finiteNumber(m.previousClose) ?? finiteNumber(m.chartPreviousClose))
      : (points.filter((p) => p.date.slice(0, 10) < marketDay).at(-1)?.price ?? null);
  const change = previous !== null && Number.isFinite(previous) ? m.regularMarketPrice - previous : null;
  const capital =
    capitalization && !quoteOnly
      ? await capitalization(symbol, m)
      : {
          sharesOutstanding: Number.isFinite(m.sharesOutstanding) ? m.sharesOutstanding : null,
          marketCapValue: Number.isFinite(m.marketCap) ? m.marketCap : null,
        };
  const regular = m.currentTradingPeriod?.regular;
  return {
    ...capital,
    ...(regular && Number.isFinite(regular.start) && Number.isFinite(regular.end)
      ? { marketSession: { open: regular.start, close: regular.end, timezone: text(m.exchangeTimezoneName) } }
      : {}),
    events: [
      ...dividends
        .filter((d) => Number.isFinite(d.date) && Number.isFinite(d.amount))
        .map((d) => ({
          date: new Date(d.date * 1000).toISOString(),
          type: "dividend",
          label: "Utdelning",
          amount: d.amount,
          currency: m.currency,
        })),
      ...splits
        .filter((s) => s.numerator > 0 && s.denominator > 0 && Number.isFinite(s.date))
        .map((s) => ({
          date: new Date(s.date * 1000).toISOString(),
          type: "split",
          label: "Split " + s.numerator + ":" + s.denominator,
        })),
    ],
    fetchedAt: new Date(now()).toISOString(),
    symbol,
    name: text(m.longName) || text(m.shortName) || symbol,
    latestPrice: m.regularMarketPrice,
    previousClose: previous,
    change,
    changePercent: previous !== null && previous > 0 && change !== null ? (change / previous) * 100 : null,
    dayHigh: m.regularMarketDayHigh ?? null,
    dayLow: m.regularMarketDayLow ?? null,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    volume: m.regularMarketVolume ?? null,
    turnoverKr: null,
    marketCap: capital.marketCapValue !== null ? String(capital.marketCapValue) : "Saknas",
    peRatio: null,
    dividendYieldPct:
      dividendPerShare !== null && m.regularMarketPrice > 0 ? (dividendPerShare / m.regularMarketPrice) * 100 : null,
    dividendPerShare,
    currency: m.currency,
    exchange: text(m.exchangeName) || text(m.fullExchangeName) || "",
    lastUpdated: new Date(m.regularMarketTime * 1000).toISOString(),
    isLive: false,
    sourceName: "Yahoo Finance",
    liveCharts: charts,
    corporateSplits: splits,
  };
}
