/** Shared source requests for public quotes, company information and indices.
 * @module
 */
import { record, list } from "../core/parse.ts";
import { createContext, type ClientOptions } from "../core/context.ts";
import { createLimiter } from "../core/limit.ts";
import { createMarketReadCache } from "./cache.ts";
import { fetchMarketQuote } from "./quote.ts";
import { fetchMarketFundamentals, fetchMarketReports, type PressRelease } from "./company.ts";
import { marketAnalytics } from "./analytics.ts";
import { marketIndices, parseIndexCsv, parseNasdaqIndex } from "./indices.ts";
import { mergeQuoteHistory, quoteCacheFresh } from "./history.ts";
import type { MarketPayload, MarketFundamentals, MarketIndexSeries, LiveMarketQuote } from "./types.ts";

/** Read options. Cancellation stops only this caller's wait, never another view's shared refresh. */
export interface MarketReadOptions {
  signal?: AbortSignal;
  fresh?: boolean;
  quoteOnly?: boolean;
}
/** Public data shape for MarketSearchResult. */
export interface MarketSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}
/** Public data shape for MarketReports. */
export interface MarketReports {
  slug: string;
  entityId?: string;
  url: string;
  items: PressRelease[];
  fetchedAt: string;
  stale?: boolean;
}
/** Public data shape for MarketClient. */
export interface MarketClient {
  quote(
    symbol: string,
    range?: "1d" | "5d" | "1mo" | "1y" | "max",
    options?: MarketReadOptions,
  ): Promise<MarketPayload>;
  fundamentals(
    symbol: string,
    options?: MarketReadOptions,
  ): Promise<MarketFundamentals & { fetchedAt: string; stale?: boolean }>;
  reports(slug: string, entityId?: string, options?: MarketReadOptions): Promise<MarketReports>;
  search(
    query: string,
    options?: MarketReadOptions,
  ): Promise<{ results: MarketSearchResult[]; fetchedAt: string; stale?: boolean }>;
  index(id: string, options?: MarketReadOptions): Promise<MarketIndexSeries>;
}
const symbolOf = (symbol: string): string => {
  if (typeof symbol !== "string" || !/^[A-Za-z0-9.^=-]{1,40}$/.test(symbol))
    throw new RangeError("Invalid market symbol");
  return symbol.toUpperCase();
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function wait<T>(job: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return job;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    job.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
/**
 * Public market data, never a personal portfolio. Use one long-lived client and a persistent store.
 * Expired snapshots return immediately with stale=true while a shared refresh runs in the background.
 * Yahoo/Nasdaq/MFN adapters are experimental and subject to their providers' access and reuse terms.
 * @example const market = createMarketClient({store}); await market.quote('INVE-B.ST','max');
 */
export function createMarketClient(options: ClientOptions = {}): MarketClient {
  const ctx = createContext(options),
    transport = options.fetch || (((input, init) => fetch(input, init)) as typeof fetch),
    limiter = createLimiter({
      yahoo: { concurrency: 2 },
      nasdaq: { concurrency: 2 },
      mfn: { concurrency: 2 },
      fred: { concurrency: 2 },
    });
  const fetcher: typeof fetch = async (input, init) => {
    let url = String(input);
    for (const [prefix, endpoint] of [
      ["https://query1.finance.yahoo.com/v8/finance/chart/", ctx.endpoints.marketChart],
      ["https://query2.finance.yahoo.com/v10/finance/quoteSummary/", ctx.endpoints.marketSummary],
      ["https://mfn.se/", ctx.endpoints.marketReports],
    ])
      if (url.startsWith(prefix)) {
        url = endpoint.replace(/\/?$/, "/") + url.slice(prefix.length);
        break;
      }
    const source = url.includes("yahoo")
        ? "yahoo"
        : url.includes("nasdaq")
          ? "nasdaq"
          : url.includes("mfn")
            ? "mfn"
            : "fred",
      signal = init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(options.timeoutMs ?? 6000)])
        : AbortSignal.timeout(options.timeoutMs ?? 6000),
      release = await limiter.acquire(source, signal);
    try {
      return await transport(url, { ...init, signal });
    } finally {
      release();
    }
  };
  const io = createMarketReadCache<unknown>({
    store: ctx.store,
    now: ctx.now,
    maxEntries: 512,
    timeoutMs: options.timeoutMs ?? 12000,
    valid: (v: unknown, key?: string): v is unknown => {
      if (
        !object(v) ||
        typeof v.fetchedAt !== "string" ||
        !Number.isFinite(Date.parse(v.fetchedAt)) ||
        Date.parse(v.fetchedAt) > ctx.now()
      )
        return false;
      if (key?.includes(":quote:"))
        return (
          typeof v.symbol === "string" &&
          key.split(":")[3] === v.symbol.toUpperCase() &&
          Number.isFinite(v.latestPrice) &&
          typeof v.currency === "string" &&
          object(v.liveCharts) &&
          Object.values(v.liveCharts).every(
            (points) =>
              Array.isArray(points) &&
              points.length <= 100000 &&
              points.every((p) => object(p) && Number.isFinite(p.price) && Number.isFinite(Date.parse(String(p.date)))),
          )
        );
      if (key?.includes(":index:"))
        return (
          v.id === key.slice("market:v1:index:".length) &&
          Array.isArray(v.points) &&
          v.points.length >= 2 &&
          v.points.every((p) => object(p) && typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0)
        );
      return true;
    },
  });
  const full = new Map<string, MarketPayload>(),
    failedFull = new Map<string, number>();
  const read = async <T extends { fetchedAt: string; stale?: boolean }>(
    key: string,
    ttl: number,
    load: (signal: AbortSignal) => Promise<T>,
    opts: MarketReadOptions = {},
    maxAge = 3650 * 86400000,
  ): Promise<T> => {
    const result = await wait(
      io("market:v1:" + key, opts.fresh ? 0 : ttl, opts.fresh ? -1 : maxAge, load),
      opts.signal,
    );
    return { ...(result.value as T), stale: result.stale, fetchedAt: result.fetchedAt };
  };
  const fundamentals = (
    symbol: string,
    opts: MarketReadOptions = {},
  ): Promise<MarketFundamentals & { fetchedAt: string; stale?: boolean }> => {
    symbol = symbolOf(symbol);
    return read(
      "fundamentals:" + symbol,
      ctx.ttl.marketFundamentals,
      async () => ({
        ...(await fetchMarketFundamentals(symbol, fetcher)),
        fetchedAt: new Date(ctx.now()).toISOString(),
      }),
      opts,
      30 * 86400000,
    );
  };
  const quote = async (
    symbol: string,
    range: "1d" | "5d" | "1mo" | "1y" | "max" = "1y",
    opts: MarketReadOptions = {},
  ): Promise<MarketPayload> => {
    symbol = symbolOf(symbol);
    if (!["1d", "5d", "1mo", "1y", "max"].includes(range)) throw new RangeError("Invalid market range");
    const old = full.get(symbol),
      ttl = range === "1d" || opts.quoteOnly ? ctx.ttl.marketQuote : ctx.ttl.marketHistory;
    const sessionTtl =
      old && quoteCacheFresh({ ...old, charts: old.liveCharts }, Date.parse(old.fetchedAt), ttl, ctx.now())
        ? Math.max(ttl, 15 * 60000)
        : ttl;
    if (
      old &&
      range !== "1d" &&
      range !== "max" &&
      !opts.fresh &&
      quoteCacheFresh({ ...old, charts: old.liveCharts }, Date.parse(old.fetchedAt), ttl, ctx.now())
    )
      return { ...old, stale: false };
    const result = await read(
      "quote:" + symbol + ":" + range + ":" + (opts.quoteOnly ? "quick" : "full"),
      sessionTtl,
      async (signal) => {
        let cached = full.get(symbol);
        if (!cached && ctx.store) {
          try {
            const raw = await ctx.store.get("market:history:v1:" + symbol);
            const value = raw ? JSON.parse(raw) : null;
            if (
              object(value) &&
              value.symbol === symbol &&
              Array.isArray(record(value.liveCharts).MAX) &&
              (record(value.liveCharts).MAX as unknown[]).length
            )
              cached = value as unknown as MarketPayload;
          } catch {
            /* Disposable public cache. */
          }
        }
        const wantTail =
            range === "max" &&
            cached &&
            Date.parse(cached.historyRebuiltAt || cached.fetchedAt) > ctx.now() - 30 * 86400000 &&
            !failedFull.has(symbol),
          rangeToLoad = wantTail ? "1y" : range;
        let usedTail = !!wantTail,
          payload = await fetchMarketQuote(symbol, rangeToLoad, opts.quoteOnly, signal, fetcher, ctx.now);
        if (wantTail && cached) {
          const merged = mergeQuoteHistory(
            { ...cached, charts: cached.liveCharts },
            { ...payload, charts: payload.liveCharts },
            ctx.now(),
          );
          if (merged) payload = { ...merged, liveCharts: merged.charts, fetchedAt: payload.fetchedAt };
          else {
            usedTail = false;
            failedFull.set(symbol, ctx.now());
            payload = await fetchMarketQuote(symbol, "max", opts.quoteOnly, signal, fetcher, ctx.now);
            failedFull.delete(symbol);
          }
        }
        if (range === "max")
          payload.historyRebuiltAt =
            usedTail && cached ? cached.historyRebuiltAt || cached.fetchedAt : payload.fetchedAt;
        if (range !== "1d")
          payload.analytics = marketAnalytics(
            payload.liveCharts.MAX.length ? payload.liveCharts.MAX : payload.liveCharts["1Å"],
            new Date(ctx.now()).toISOString(),
          );
        if (range === "max") {
          full.set(symbol, payload);
          while (full.size > 128) full.delete(full.keys().next().value!);
          if (ctx.store)
            try {
              await ctx.store.set("market:history:v1:" + symbol, JSON.stringify(payload));
            } catch {
              /* Cache failure never loses source data. */
            }
        }
        return payload;
      },
      opts,
    );
    if (range === "max") {
      failedFull.delete(symbol);
      full.set(symbol, result);
      while (full.size > 128) full.delete(full.keys().next().value!);
    }
    return result;
  };
  return {
    quote,
    fundamentals,
    reports: (slug, entityId, opts = {}) => {
      if (!/^[a-z0-9-]{2,80}$/.test(slug) || (entityId && !/^[0-9a-f-]{36}$/i.test(entityId)))
        throw new RangeError("Invalid report source");
      return read(
        "reports:" + slug + ":" + (entityId || "auto"),
        ctx.ttl.marketFundamentals,
        async () => ({
          ...(await fetchMarketReports({ slug, entityId, limit: 100 }, fetcher)),
          fetchedAt: new Date(ctx.now()).toISOString(),
        }),
        opts,
        90 * 86400000,
      );
    },
    search: (query, opts = {}) => {
      query = query.trim();
      if (query.length < 2 || query.length > 100 || /[\u0000-\u001f]/.test(query))
        throw new RangeError("Invalid symbol search");
      return read(
        "search:" + encodeURIComponent(query.toLocaleLowerCase("sv")),
        ctx.ttl.search,
        async (signal) => {
          const body = await ctx.http.json(
            "yahoo",
            ctx.endpoints.marketSearch +
              "?q=" +
              encodeURIComponent(query) +
              "&quotesCount=30&newsCount=0&enableFuzzyQuery=false",
            { signal },
          );
          const results: MarketSearchResult[] = list(record(body).quotes)
            .map(record)
            .filter(
              (r) =>
                typeof r.symbol === "string" &&
                typeof (r.longname || r.shortname) === "string" &&
                ["EQUITY", "ETF", "MUTUALFUND", "INDEX"].includes(String(r.quoteType)),
            )
            .map((r) => ({
              symbol: String(r.symbol),
              name: String(r.longname || r.shortname),
              exchange: typeof r.exchange === "string" ? r.exchange : "",
              type: String(r.quoteType),
            }))
            .sort(
              (a: MarketSearchResult, b: MarketSearchResult) =>
                Number(b.symbol.endsWith(".ST")) - Number(a.symbol.endsWith(".ST")),
            );
          return { results, fetchedAt: new Date(ctx.now()).toISOString() };
        },
        opts,
        7 * 86400000,
      );
    },
    index: async (id, opts = {}) => {
      const definition = marketIndices.find((i) => i.id === id);
      if (!definition || !definition.currency) throw new RangeError("Choose a downloadable index");
      return read(
        "index:" + id,
        ctx.ttl.marketIndex,
        async (signal) => {
          let points: MarketIndexSeries["points"],
            sourceUrl = definition.sourceUrl,
            sourceName = "Nasdaq";
          if (definition.nasdaq) {
            try {
              const response = await fetcher(ctx.endpoints.marketNasdaq, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
                body: new URLSearchParams({
                  id: definition.nasdaq,
                  startDate: "1900-01-01",
                  endDate: new Date(ctx.now()).toISOString().slice(0, 10),
                }),
                signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
              });
              if (!response.ok) throw Error("Index source unavailable");
              points = parseNasdaqIndex(
                await response.json(),
                definition.nasdaq,
                new Date(ctx.now()).toISOString().slice(0, 10),
              );
            } catch (error) {
              if (signal.aborted) throw error;
              if (!definition.fred) throw error;
              const csv = await ctx.http.text("fred", ctx.endpoints.marketFred + "?id=" + definition.fred, { signal });
              points = parseIndexCsv(csv || "").filter((p) => p.date <= new Date(ctx.now()).toISOString().slice(0, 10));
              sourceName = "Nasdaq via FRED";
              sourceUrl = "https://fred.stlouisfed.org/series/" + definition.fred;
            }
          } else {
            const data = await quote(definition.symbol!, "max", opts);
            points = data.liveCharts.MAX.map((p) => ({
              date: p.date.slice(0, 10),
              price: p.splitAdjustedPrice ?? p.price,
            }));
            sourceName = data.sourceName;
          }
          return {
            id,
            currency: definition.currency!,
            points,
            fetchedAt: new Date(ctx.now()).toISOString(),
            sourceUrl,
            sourceName,
          };
        },
        opts,
      );
    },
  };
}
