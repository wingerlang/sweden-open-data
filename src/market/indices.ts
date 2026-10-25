/** Named index definitions and defensive index observation parsers.
 * @module
 */
import { isCalendarDate } from "../core/time.ts";
import type { MarketIndexPoint } from "./types.ts";
/** Price indices and gross total-return indices are distinct; currencies are never converted implicitly. */
export interface MarketIndex {
  id: string;
  label: string;
  kind: string;
  currency?: string;
  fred?: string;
  symbol?: string;
  nasdaq?: string;
  sourceUrl: string;
}
/** Named index definitions and defensive index observation parsers. */
export const marketIndices: readonly MarketIndex[] = [
  {
    id: "benchmark-fred-omxs30",
    label: "OMXS30 · Nasdaq/FRED",
    kind: "Prisindex",
    currency: "SEK",
    fred: "NASDAQOMXS30",
    nasdaq: "OMXS30",
    sourceUrl: "https://fred.stlouisfed.org/series/NASDAQOMXS30",
  },
  {
    id: "benchmark-omxs30gi",
    label: "OMXS30GI · återinvesterad utdelning",
    kind: "Totalavkastning före skatt",
    currency: "SEK",
    fred: "NASDAQOMXS30GI",
    nasdaq: "OMXS30GI",
    sourceUrl: "https://fred.stlouisfed.org/series/NASDAQOMXS30GI",
  },
  {
    id: "benchmark-omxs30",
    label: "OMXS30",
    kind: "Prisindex",
    currency: "SEK",
    symbol: "^OMX",
    nasdaq: "OMXS30",
    sourceUrl: "https://indexes.nasdaqomx.com/Index/Overview/OMXS30",
  },
  {
    id: "benchmark-omxspi",
    label: "OMXSPI · hela Stockholmsbörsen",
    kind: "Prisindex",
    currency: "SEK",
    symbol: "^OMXSPI",
    nasdaq: "OMXSPI",
    sourceUrl: "https://indexes.nasdaqomx.com/Index/Overview/OMXSPI",
  },
  {
    id: "benchmark-omxsscpi",
    label: "Stockholm Small Cap",
    kind: "Prisindex",
    currency: "SEK",
    fred: "NASDAQOMXSSCPI",
    nasdaq: "OMXSSCPI",
    sourceUrl: "https://fred.stlouisfed.org/series/NASDAQOMXSSCPI",
  },
  {
    id: "benchmark-microcap",
    label: "Mikrocap · egen indexserie",
    kind: "Importerad serie",
    sourceUrl: "https://www.carnegie.se/securities/kurser-och-index/",
  },
  {
    id: "benchmark-sp500",
    label: "S&P 500",
    kind: "Prisindex",
    currency: "USD",
    symbol: "^GSPC",
    sourceUrl: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/",
  },
  {
    id: "benchmark-nasdaq100",
    label: "Nasdaq 100",
    kind: "Prisindex",
    currency: "USD",
    symbol: "^NDX",
    sourceUrl: "https://indexes.nasdaqomx.com/Index/Overview/NDX",
  },
];
/** Validates a Nasdaq chart response without attaching any private instrument identity. */
export function parseNasdaqIndex(body: unknown, symbol: string, asOf: string): MarketIndexPoint[] {
  if (!Array.isArray(body) || body.length > 30000) throw Error("Invalid index history");
  const values = new Map<string, number>();
  for (const row of body) {
    if (!row || row.FPSymbol !== symbol || !Number.isFinite(row.x) || !Number.isFinite(row.y) || row.y <= 0)
      throw Error("Invalid index observation");
    const date = new Date(row.x).toISOString().slice(0, 10);
    if (date <= asOf) {
      if (values.has(date) && values.get(date) !== row.y) throw Error("Conflicting index observations");
      values.set(date, row.y);
    }
  }
  if (values.size < 2) throw Error("Insufficient index history");
  return [...values].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price }));
}
/** Parses provider CSV (date,value); dots denote missing observations, never zero. */
export function parseIndexCsv(text: string): MarketIndexPoint[] {
  if (text.length > 2000000) throw Error("Index history exceeds 2 MB");
  const rows = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (rows.length > 30001) throw Error("Too many index observations");
  const values = new Map<string, number>();
  for (const line of rows.slice(1)) {
    const [date, raw] = line.split(",");
    if (raw === "." || !raw) continue;
    const price = Number(raw);
    if (
      !isCalendarDate(date) ||
      !Number.isFinite(price) ||
      price <= 0 ||
      new Date(date!).toISOString().slice(0, 10) !== date
    )
      throw Error("Invalid index observation");
    if (values.has(date!) && values.get(date!) !== price) throw Error("Conflicting index observations");
    values.set(date!, price);
  }
  if (values.size < 2) throw Error("Insufficient index history");
  return [...values].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price }));
}
