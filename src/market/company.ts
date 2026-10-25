/** Yahoo fundamentals and MFN publications; only known public fields are retained.
 * @module
 */
import { record, list, finiteNumber, isoDay } from "../core/parse.ts";
import type { MarketFundamentals } from "./types.ts";
type Fetch = typeof fetch;
const UA = { "User-Agent": "Mozilla/5.0 (Emergens)", Accept: "application/json,text/html;q=0.9" };
const raw = (v: unknown): number | null => finiteNumber(record(v).raw ?? v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoDate = (v: unknown): string | null => {
  const n = raw(v),
    date = n === null ? null : new Date(n * 1000);
  return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};
let crumb: { value: string; cookie: string; until: number } | undefined;
async function yahooCrumb(fetchImpl: Fetch) {
  if (crumb && crumb.until > Date.now()) return crumb;
  const first = await fetchImpl("https://fc.yahoo.com/", {
    headers: UA,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const cookies = (first.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() as
      | string[]
      | undefined,
    cookie = (cookies?.length ? cookies : [first.headers.get("set-cookie") || ""])
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
  const response = await fetchImpl("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...UA, cookie },
    signal: AbortSignal.timeout(8000),
  });
  const value = (await response.text()).trim();
  if (!response.ok || !value || value.length > 40) throw Error("Yahoo gav ingen åtkomstnyckel.");
  crumb = { value, cookie, until: Date.now() + 30 * 60000 };
  return crumb;
}
const MODULES = "price,assetProfile,summaryDetail,defaultKeyStatistics,financialData,calendarEvents";
/** Yahoo fundamentals and MFN publications; only known public fields are retained. */
export async function fetchMarketFundamentals(symbol: string, fetchImpl: Fetch = fetch): Promise<MarketFundamentals> {
  const url = (c?: string) =>
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}${c ? "&crumb=" + encodeURIComponent(c) : ""}`;
  let response = await fetchImpl(url(), { headers: UA, signal: AbortSignal.timeout(12000) });
  if (response.status === 401 || response.status === 403) {
    crumb = undefined;
    const c = await yahooCrumb(fetchImpl);
    response = await fetchImpl(url(c.value), {
      headers: { ...UA, cookie: c.cookie },
      signal: AbortSignal.timeout(12000),
    });
  }
  if (!response.ok) throw Error("Nyckeltal är otillgängliga (Yahoo " + response.status + ").");
  const r = record(list(record(record(await response.json()).quoteSummary).result)[0]);
  if (!Object.keys(r).length || String(record(r.price).symbol || symbol).toUpperCase() !== symbol.toUpperCase())
    throw Error("Nyckeltalen gällde inte begärd symbol.");
  const p = record(r.assetProfile),
    s = record(r.summaryDetail),
    k = record(r.defaultKeyStatistics),
    f = record(r.financialData),
    c = record(r.calendarEvents),
    price = record(r.price);
  const officers = list(p.companyOfficers).map(record);
  const ceo = officers.find((o) => /\b(ceo|chief executive|vd)\b/i.test(text(o.title) || ""));
  return {
    ...(text(price.symbol) ? { symbol: text(price.symbol) } : {}),
    currency: text(price.currency) || text(f.financialCurrency),
    financialCurrency: text(f.financialCurrency),
    profile: {
      name: text(price.longName) || text(price.shortName),
      sector: text(p.sector),
      industry: text(p.industry),
      employees: raw(p.fullTimeEmployees),
      website: text(p.website),
      summary: text(p.longBusinessSummary),
      ceo: text(ceo?.name),
      city: text(p.city),
      country: text(p.country),
    },
    valuation: {
      marketCap: raw(price.marketCap) ?? raw(s.marketCap),
      enterpriseValue: raw(k.enterpriseValue),
      trailingPE: raw(s.trailingPE),
      forwardPE: raw(s.forwardPE) ?? raw(k.forwardPE),
      priceToBook: raw(k.priceToBook),
      priceToSales: raw(s.priceToSalesTrailing12Months),
      evToEbitda: raw(k.enterpriseToEbitda),
      beta: raw(s.beta) ?? raw(k.beta),
      dividendYield: raw(s.dividendYield),
      payoutRatio: raw(s.payoutRatio),
      sharesOutstanding: raw(k.sharesOutstanding),
      fiftyTwoWeekHigh: raw(s.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: raw(s.fiftyTwoWeekLow),
    },
    financials: {
      totalRevenue: raw(f.totalRevenue),
      revenueGrowth: raw(f.revenueGrowth),
      grossMargin: raw(f.grossMargins),
      ebitdaMargin: raw(f.ebitdaMargins),
      operatingMargin: raw(f.operatingMargins),
      profitMargin: raw(f.profitMargins),
      ebitda: raw(f.ebitda),
      totalCash: raw(f.totalCash),
      totalDebt: raw(f.totalDebt),
      freeCashflow: raw(f.freeCashflow),
      returnOnEquity: raw(f.returnOnEquity),
      trailingEps: raw(k.trailingEps),
      forwardEps: raw(k.forwardEps),
    },
    events: {
      earningsDate: isoDate(list(record(c.earnings).earningsDate)[0]),
      exDividendDate: isoDate(c.exDividendDate) ?? isoDate(s.exDividendDate),
      dividendDate: isoDate(c.dividendDate),
    },
  };
}
/** MFN-sidans namn, t.ex. "Embracer Group B" → "embracer-group". */

/** Yahoo fundamentals and MFN publications; only known public fields are retained. */
export interface PressRelease {
  title: string;
  date: string | null;
  url: string;
  preamble?: string | null;
  lang?: string | null;
}
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function feedItems(items: unknown[], slug: string): PressRelease[] {
  return items.flatMap((item) => {
    const i = record(item),
      content = record(i.content),
      title = text(content.title);
    if (!title) return [];
    const url = text(i.url) || (content.slug ? `https://mfn.se/a/${slug}/${content.slug}` : null);
    if (!url || !/^https:\/\/([a-z]+\.)?mfn\.se\//.test(url)) return [];
    return [
      {
        title,
        date: text(content.publish_date),
        url,
        preamble: text(content.preamble),
        lang: text(record(i.properties).lang),
      },
    ];
  });
}
/** Pressmeddelanden: MFN:s JSON-flöde i första hand, annars bolagets publika MFN-sida. */
export async function fetchMarketReports(
  options: { slug: string; entityId?: string; limit?: number },
  fetchImpl: Fetch = fetch,
): Promise<{ slug: string; entityId?: string; url: string; items: PressRelease[] }> {
  const { slug, limit = 20 } = options,
    page = `https://mfn.se/all/a/${slug}`;
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) throw Error("Ogiltigt MFN-namn.");
  const json = async (url: string) => {
    const r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    try {
      return await r.json();
    } catch {
      return null;
    }
  };
  if (options.entityId && /^[0-9a-f-]{36}$/i.test(options.entityId)) {
    const data = record(await json(`https://feed.mfn.se/v1/feed/${options.entityId}?limit=${limit}`));
    if (Array.isArray(data?.items))
      return { slug, entityId: options.entityId, url: page, items: feedItems(data.items, slug) };
  }
  const search = record(
    await json(`https://mfn.se/all/s.json?type=all&.author.slug=${slug}&limit=${limit}`).catch(() => null),
  );
  if (Array.isArray(search?.items) && search.items.length) {
    const entityId = text(record(record(search.items[0]).author).entity_id) || undefined;
    return { slug, entityId, url: page, items: feedItems(search.items, slug) };
  }
  const response = await fetchImpl(page, {
    headers: { ...UA, Accept: "text/html" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw Error(
      response.status === 404
        ? "Bolaget hittades inte på MFN. Ange MFN-namnet manuellt."
        : "MFN är otillgängligt (" + response.status + ").",
    );
  const html = await response.text(),
    items: PressRelease[] = [],
    seen = new Set<string>();
  const pattern = new RegExp(
    `<a[^>]+href="((?:https://(?:www\\.)?mfn\\.se)?/(?:cis/|c/)?a/${slug}/[^"#?]+)"[^>]*>([\\s\\S]*?)</a>`,
    "g",
  );
  for (const match of html.matchAll(pattern)) {
    const url = match[1].startsWith("http") ? match[1].replace("://www.", "://") : "https://mfn.se" + match[1],
      title = decode(match[2]);
    if (!title || title.length < 4 || seen.has(url)) continue;
    seen.add(url);
    const before = html.slice(Math.max(0, match.index! - 600), match.index!),
      dates = [...before.matchAll(/([0-9-]{10})(?:[ T](\d{2}:\d{2}))?/g)];
    const d = dates.at(-1),day=isoDay(d?.[1]);
    items.push({ title, date: day ? day + (d?.[2] ? " " + d[2] : "") : null, url });
    if (items.length >= limit) break;
  }
  const entityId = html.match(
    /entity[_-]?id["':=\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )?.[1];
  return { slug, entityId, url: page, items };
}
