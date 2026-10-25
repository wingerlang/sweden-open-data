/** Reported company totals, independent of personal portfolio quantities.
 * @module
 */
import { fetchMarketFundamentals } from "./company.ts";
import type { MarketFundamentals } from "./types.ts";
/** Public data shape for MarketCapitalization. */
export interface MarketCapitalization {
  sharesOutstanding: number | null;
  sharesOutstandingDate?: string;
  marketCapDate?: string;
  marketCapValue: number | null;
  marketCapMethod?: "reported" | "shares-times-price";
}
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const cache = new Map<string, { until: number; shares: number | null; cap: number | null; fetchedAt: string }>();
const pending = new Map<
  string,
  Promise<{ until: number; shares: number | null; cap: number | null; fetchedAt: string }>
>();
/** Provider totals may change after buybacks/issues. Do not infer company shares from this user's holding. */
export async function quoteCapitalization(
  symbol: string,
  meta: Record<string, unknown>,
  waitMs: number = 1500,
  lookup?: () => Promise<MarketFundamentals>,
): Promise<MarketCapitalization> {
  let shares = positive(meta.sharesOutstanding) ? meta.sharesOutstanding : null,
    cap = positive(meta.marketCap) ? meta.marketCap : null,
    fetchedAt = new Date().toISOString();
  if (shares === null || cap === null) {
    const key = symbol.toUpperCase() + "|" + String(meta.currency || "");
    let stored = cache.get(key);
    if (!stored || stored.until < Date.now()) {
      let request = pending.get(key);
      if (!request) {
        request = (async () => {
          let suppliedShares: number | null = null,
            suppliedCap: number | null = null;
          try {
            const data = await (lookup ? lookup() : fetchMarketFundamentals(symbol));
            if (
              data.symbol?.toUpperCase() === symbol.toUpperCase() &&
              (!data.currency || data.currency === meta.currency)
            ) {
              suppliedShares = positive(data.valuation.sharesOutstanding) ? data.valuation.sharesOutstanding : null;
              suppliedCap = positive(data.valuation.marketCap) ? data.valuation.marketCap : null;
            }
          } catch {
            /* Chart data remains available without fundamentals. */
          }
          const value = {
            until: Date.now() + (suppliedShares || suppliedCap ? 600000 : 60000),
            shares: suppliedShares,
            cap: suppliedCap,
            fetchedAt: new Date().toISOString(),
          };
          cache.set(key, value);
          while (cache.size > 300) cache.delete(cache.keys().next().value!);
          return value;
        })();
        pending.set(key, request);
        void request.finally(() => {
          if (pending.get(key) === request) pending.delete(key);
        });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        stored = await Promise.race([
          request,
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), waitMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (stored) {
      shares ??= stored.shares;
      cap ??= stored.cap;
      fetchedAt = stored.fetchedAt;
    }
  }
  const method =
    cap !== null
      ? ("reported" as const)
      : shares !== null && positive(meta.regularMarketPrice ?? meta.latestPrice)
        ? ("shares-times-price" as const)
        : undefined;
  return {
    sharesOutstanding: shares,
    sharesOutstandingDate: shares === null ? undefined : fetchedAt,
    marketCapDate: method ? fetchedAt : undefined,
    marketCapValue:
      cap ?? (shares !== null && positive(meta.regularMarketPrice) ? shares * meta.regularMarketPrice : null),
    marketCapMethod: method,
  };
}
