/**
 * Public investment-company data from IBIndex. No personal holdings are accepted.
 *
 * @experimental IBIndex offers no public API or agreement for these endpoints; availability and data terms are
 * decided by IBIndex. Not part of `createClient()` until the terms are confirmed in writing;
 * import it from `@wingerlang/sweden-open-data/investments`.
 *
 * ```ts
 * import { createInvestmentClient } from "@wingerlang/sweden-open-data/investments";
 *
 * const ib = createInvestmentClient();
 * const { companies } = await ib.overview(); // price, NAV and discount per company
 * const investor = await ib.company("INVE B"); // history and holdings
 * ```
 *
 * @module
 */
import { createContext } from "../core/context.js";
import { cachedWithStore } from "../core/source.js";
import { dayFromEpochMs, finiteNumber, invalidResponse } from "../core/parse.js";
/** Where the data comes from – link to it next to the data. */
export const IBINDEX_SOURCE = "https://ibindex.se/ibi/";
const productPattern = /^[A-Z0-9][A-Z0-9 .&-]{0,39}$/;
const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isCompanyList = (v) =>
  isRecord(v) && Array.isArray(v.companies) && v.companies.length > 0 && typeof v.fetchedAt === "string";
const number = (v) => finiteNumber(v);
const date = (v) => dayFromEpochMs(v) ?? null;
const bad = () => {
  throw invalidResponse("ibindex", "Unexpected IBIndex data");
};
/** Positive means a discount; negative means a premium. Missing or zero NAV never means zero discount. */
export function navDiscount(price, nav) {
  return nav !== null && nav > 0 && price >= 0 && Number.isFinite(price) ? (1 - price / nav) * 100 : null;
}
/** Parses IBIndex `getCompanies`. @throws {SourceError} `"invalid-response"` for an empty or malformed list. */
export function parseInvestmentCompanies(input) {
  if (!Array.isArray(input) || !input.length) return bad();
  const map = new Map();
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
      symbol: { VEFAB: "VEF.ST" }[v.product] || v.product.replaceAll(" ", "-") + ".ST",
    });
  }
  return [...map.values()];
}
/** Parses IBIndex `getChartDataPrice`, one point per day in date order. @throws {SourceError} for malformed rows. */
export function parseInvestmentHistory(input) {
  if (!Array.isArray(input) || !input.length) return bad();
  const map = new Map();
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
/** Parses IBIndex `getHoldings`, with weights computed over assets except cash and debt. */
export function parseInvestmentHoldings(input) {
  if (!Array.isArray(input)) return bad();
  const values = input.map((v) => {
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
export function parseInvestmentOverview(input, companies) {
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
/** Creates an {@link InvestmentClient}. With a `store`, the last complete answer survives restarts and outages. */
export function createInvestmentClient(options = {}) {
  const ctx = createContext(options);
  const post = (path, body, signal) =>
    ctx.http.json("ibindex", `${ctx.endpoints.ibindex.replace(/\/?$/, "/")}${path}.req`, {
      method: "POST",
      body,
      signal,
    });
  const cached = (key, ttlMs, valid, load, signal) =>
    cachedWithStore(ctx, key, ttlMs, valid, load, { signal, source: "ibindex" });
  const fetchedAt = () => new Date(ctx.now()).toISOString();
  const companies = (companyOptions = {}) =>
    cached(
      "ibindex:companies:v2",
      ctx.ttl.investments,
      isCompanyList,
      async (signal) => ({
        companies: parseInvestmentCompanies(await post("companies/getCompanies", {}, signal)),
        fetchedAt: fetchedAt(),
        sourceUrl: IBINDEX_SOURCE,
      }),
      companyOptions.signal,
    );
  return {
    companies,
    overview: (overviewOptions = {}) =>
      cached(
        "ibindex:overview:v1",
        ctx.ttl.investmentsOverview,
        isCompanyList,
        async (signal) => {
          const [catalog, rows] = await Promise.all([companies({ signal }), post("index/getProducts", {}, signal)]);
          return {
            companies: parseInvestmentOverview(rows, catalog.companies),
            fetchedAt: fetchedAt(),
            sourceUrl: IBINDEX_SOURCE,
            ...(catalog.stale ? { stale: true } : {}),
          };
        },
        overviewOptions.signal,
      ),
    async company(product, companyOptions = {}) {
      if (typeof product !== "string" || !productPattern.test(product)) {
        throw new RangeError("Invalid investment company");
      }
      const company = (await companies(companyOptions)).companies.find((c) => c.product === product);
      if (!company) throw new RangeError("Unknown investment company");
      return cached(
        "ibindex:company:v2:" + product,
        ctx.ttl.investments,
        (v) =>
          isRecord(v) &&
          isRecord(v.company) &&
          v.company.product === product &&
          Array.isArray(v.history) &&
          v.history.length > 0 &&
          Array.isArray(v.holdings) &&
          typeof v.fetchedAt === "string",
        async (signal) => {
          const [history, holdings, holdingsDate, nav] = await Promise.all([
            post("company/getChartDataPrice", { product, interval: "ALL" }, signal),
            post("company/getHoldings", product, signal),
            post("company/getHoldingsDate", product, signal),
            post("company/getNetAssetValue", product, signal),
          ]);
          return {
            company,
            history: parseInvestmentHistory(history),
            holdings: parseInvestmentHoldings(holdings),
            holdingsDate: date(holdingsDate),
            reportedNavDate: date(isRecord(nav) ? nav.netAssetValueChangeDate : undefined),
            fetchedAt: fetchedAt(),
            sourceUrl: IBINDEX_SOURCE + "#/company/" + encodeURIComponent(product),
          };
        },
        companyOptions.signal,
      );
    },
  };
}
