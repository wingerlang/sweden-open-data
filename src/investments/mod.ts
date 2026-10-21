/**
 * Public investment-company data from IBIndex. No personal holdings are accepted.
 *
 * @experimental IBIndex offers no public API or agreement for these endpoints; availability and data terms are
 * decided by IBIndex. Not part of `createClient()` until the terms are confirmed in writing;
 * import it from `@wingerlang/sweden-open-data/investments`.
 *
 * @module
 */
import { createContext, storeGet, storeSet, type ClientOptions, type Context } from "../core/context.ts";
import { SourceError } from "../core/errors.ts";
export interface InvestmentCompany {
  product: string;
  name: string;
  symbol: string;
  marketWeight?: number | null;
}
export interface InvestmentPoint {
  date: string;
  price: number;
  reportedNav: number | null;
  estimatedNav: number | null;
  reportedDiscount: number | null;
  estimatedDiscount: number | null;
}
export interface InvestmentHolding {
  product: string;
  name: string;
  category: string;
  categoryName?: string;
  value: number;
  weightPct: number | null;
}
export interface InvestmentDetail {
  company: InvestmentCompany;
  history: InvestmentPoint[];
  holdings: InvestmentHolding[];
  holdingsDate: string | null;
  reportedNavDate: string | null;
  fetchedAt: string;
  sourceUrl: string;
  stale?: boolean;
}
export interface InvestmentCompanies {
  companies: InvestmentCompany[];
  fetchedAt: string;
  sourceUrl: string;
  stale?: boolean;
}
export interface InvestmentOverview {
  companies: (InvestmentCompany & {
    price: number;
    reportedNav: number | null;
    estimatedNav: number | null;
    reportedDiscount: number | null;
    estimatedDiscount: number | null;
    reportedNavDate: string | null;
  })[];
  fetchedAt: string;
  sourceUrl: string;
  stale?: boolean;
}
export interface InvestmentClient {
  overview(): Promise<InvestmentOverview>;
  companies(): Promise<InvestmentCompanies>;
  company(product: string): Promise<InvestmentDetail>;
}
export const IBINDEX_SOURCE = "https://ibindex.se/ibi/";
const productPattern = /^[A-Z0-9][A-Z0-9 .&-]{0,39}$/;
const number = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && !Number.isNaN(new Date(v).getTime())
    ? new Date(v).toISOString().slice(0, 10)
    : null;
const bad = (): never => {
  throw new SourceError("Unexpected IBIndex data", { source: "ibindex", code: "invalid-response" });
};
/** Positive means a discount; negative means a premium. Missing or zero NAV never means zero discount. */
export function navDiscount(price: number, nav: number | null): number | null {
  return nav !== null && nav > 0 && price >= 0 && Number.isFinite(price) ? (1 - price / nav) * 100 : null;
}
export function parseInvestmentCompanies(input: unknown): InvestmentCompany[] {
  if (!Array.isArray(input) || !input.length) return bad();
  const map = new Map<string, InvestmentCompany>();
  for (const v of input) {
    if (
      !v ||
      typeof v.product !== "string" ||
      !productPattern.test(v.product) ||
      typeof v.productName !== "string" ||
      !v.productName.trim()
    )
      return bad();
    map.set(v.product, {
      product: v.product,
      name: v.productName.slice(0, 150),
      ...(number(v.marketWeight) !== null ? { marketWeight: number(v.marketWeight) } : {}),
      symbol: ({ VEFAB: "VEF.ST" } as Record<string, string>)[v.product] || v.product.replaceAll(" ", "-") + ".ST",
    });
  }
  return [...map.values()];
}
export function parseInvestmentHistory(input: unknown): InvestmentPoint[] {
  if (!Array.isArray(input) || !input.length) return bad();
  const map = new Map<string, InvestmentPoint>();
  for (const v of input) {
    const day = date(v?.date),
      price = number(v?.productPrice),
      reported = number(v?.netAssetValuePrice),
      estimated = number(v?.netAssetValueCalculatedPrice);
    if (!day || price === null || price < 0) return bad();
    map.set(day, {
      date: day,
      price,
      reportedNav: reported && reported > 0 ? reported : null,
      estimatedNav: estimated && estimated > 0 ? estimated : null,
      reportedDiscount: navDiscount(price, reported),
      estimatedDiscount: navDiscount(price, estimated),
    });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function parseInvestmentHoldings(input: unknown): InvestmentHolding[] {
  if (!Array.isArray(input)) return bad();
  const values: InvestmentHolding[] = input.map((v) => {
    const value = number(v?.holdingValue);
    if (value === null || typeof v.holdingName !== "string" || typeof v.category !== "string") return bad();
    return {
      product: String(v.holdingProduct || ""),
      name: v.holdingName.slice(0, 200),
      category: v.category.slice(0, 20),
      ...(typeof v.categoryName === "string" && v.categoryName.trim()
        ? { categoryName: v.categoryName.slice(0, 100) }
        : {}),
      value,
      weightPct: null,
    };
  });
  // IBIndex uses assets except cash/debt for its holdings percentages. State that denominator in the UI.
  const assets = values.filter((v) => !["C&D", "DBT"].includes(v.category)),
    total = assets.reduce((s, v) => s + v.value, 0);
  return values.map((v) => ({
    ...v,
    weightPct: !["C&D", "DBT"].includes(v.category) && total > 0 ? (v.value / total) * 100 : null,
  }));
}
/** A small snapshot for lists. No per-company historical downloads. */
export function parseInvestmentOverview(
  input: unknown,
  companies: InvestmentCompany[],
): InvestmentOverview["companies"] {
  if (!Array.isArray(input) || !input.length) return bad();
  const known = new Map(companies.map((c) => [c.product, c]));
  return input.flatMap((v) => {
    const company = known.get(v?.product);
    if (!company) return [];
    const price = number(v.price),
      reported = number(v.netAssetValue),
      estimated = number(v.netAssetValueCalculated);
    if (price === null || price < 0) return bad();
    return [
      {
        ...company,
        price,
        reportedNav: reported !== null && reported > 0 ? reported : null,
        estimatedNav: estimated !== null && estimated > 0 ? estimated : null,
        reportedDiscount: navDiscount(price, reported),
        estimatedDiscount: navDiscount(price, estimated),
        reportedNavDate: date(v.netAssetValueChangeDate),
      },
    ];
  });
}
export function createInvestmentClient(options: ClientOptions | Context = {}): InvestmentClient {
  const ctx = createContext(options),
    ttl = 6 * 3600000;
  const post = (path: string, body: unknown): Promise<unknown> =>
    ctx.http.json("ibindex", IBINDEX_SOURCE + path + ".req", { method: "POST", body });
  const cached = <T extends { fetchedAt: string }>(
    key: string,
    valid: (v: any) => v is T,
    load: () => Promise<T>,
    duration = ttl,
  ): Promise<T> =>
    ctx.cache.get(key, duration, async () => {
      const old = await storeGet(ctx.store, key),
        kept = valid(old) ? old : undefined;
      if (kept && ctx.now() - Date.parse(kept.fetchedAt) < duration) return kept;
      try {
        const value = await load();
        await storeSet(ctx.store, key, value);
        return value;
      } catch (error) {
        if (kept) return { ...kept, stale: true };
        throw error;
      }
    });
  const companies = (): Promise<InvestmentCompanies> =>
    cached(
      "ibindex:companies:v2",
      (v: any): v is InvestmentCompanies =>
        !!v && Array.isArray(v.companies) && v.companies.length > 0 && typeof v.fetchedAt === "string",
      async () => ({
        companies: parseInvestmentCompanies(await post("companies/getCompanies", {})),
        fetchedAt: new Date(ctx.now()).toISOString(),
        sourceUrl: IBINDEX_SOURCE,
      }),
    );
  return {
    companies,
    overview: () =>
      cached(
        "ibindex:overview:v1",
        (v: any): v is InvestmentOverview =>
          !!v && Array.isArray(v.companies) && v.companies.length > 0 && typeof v.fetchedAt === "string",
        async () => {
          const [catalog, rows] = await Promise.all([companies(), post("index/getProducts", {})]);
          return {
            companies: parseInvestmentOverview(rows, catalog.companies),
            fetchedAt: new Date(ctx.now()).toISOString(),
            sourceUrl: IBINDEX_SOURCE,
            ...(catalog.stale ? { stale: true } : {}),
          };
        },
        15 * 60000,
      ),
    async company(product: string): Promise<InvestmentDetail> {
      if (typeof product !== "string" || !productPattern.test(product))
        throw new RangeError("Invalid investment company");
      const company = (await companies()).companies.find((c) => c.product === product);
      if (!company) throw new RangeError("Unknown investment company");
      return cached(
        "ibindex:company:v2:" + product,
        (v: any): v is InvestmentDetail =>
          !!v &&
          v.company?.product === product &&
          Array.isArray(v.history) &&
          v.history.length > 0 &&
          Array.isArray(v.holdings) &&
          typeof v.fetchedAt === "string",
        async () => {
          const [history, holdings, holdingsDate, nav] = await Promise.all([
            post("company/getChartDataPrice", { product, interval: "ALL" }),
            post("company/getHoldings", product),
            post("company/getHoldingsDate", product),
            post("company/getNetAssetValue", product),
          ]);
          return {
            company,
            history: parseInvestmentHistory(history),
            holdings: parseInvestmentHoldings(holdings),
            holdingsDate: date(holdingsDate),
            reportedNavDate: date((nav as any)?.netAssetValueChangeDate),
            fetchedAt: new Date(ctx.now()).toISOString(),
            sourceUrl: IBINDEX_SOURCE + "#/company/" + encodeURIComponent(product),
          };
        },
      );
    },
  };
}
