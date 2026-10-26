/** Official average mortgage rates to Swedish households, published by SCB for the Riksbank. Market averages only. @module */
import { createContext, type ClientOptions, type Context } from "../core/context.ts";
import { cachedWithStore } from "../core/source.ts";
import { invalidResponse } from "../core/parse.ts";

/** Original fixed-rate period as published: floating (up to 3 months) and four fixed bands. */
export type MortgageBinding = "floating" | "3m-1y" | "1y-3y" | "3y-5y" | "5y+";
/** New and renegotiated agreements during the month, or all outstanding loans at the end of the month. */
export type MortgageAgreement = "new" | "outstanding";
/** One monthly average rate in percent per year. */
export interface MortgageRatePoint {
  readonly month: string;
  readonly ratePct: number;
}
/** One published average-rate series. */
export interface MortgageRateSeries {
  readonly agreement: MortgageAgreement;
  readonly binding: MortgageBinding;
  readonly label: string;
  readonly points: readonly MortgageRatePoint[];
}
/** All market-average series from one SCB table, with source and revision metadata. */
export interface MortgageRates {
  readonly series: readonly MortgageRateSeries[];
  readonly source: string;
  readonly sourceUrl: string;
  readonly table: string;
  readonly fetchedAt: string;
  readonly updated?: string;
  readonly stale?: boolean;
}
/** Official source for household mortgage rates. */
export const MORTGAGE_RATE_SOURCE: { readonly name: string; readonly url: string; readonly license: string } = {
  name: "SCB / Riksbanken · bolåneräntor till hushåll",
  url: "https://www.scb.se/FM5001",
  license: "CC0",
};
/** Labels for the published fixed-rate bands. */
export const MORTGAGE_BINDINGS: Readonly<Record<MortgageBinding, string>> = Object.freeze({
  floating: "Rörlig (3 mån)",
  "3m-1y": "Bunden 3 mån–1 år",
  "1y-3y": "Bunden 1–3 år",
  "3y-5y": "Bunden 3–5 år",
  "5y+": "Bunden över 5 år",
});
const TABLE = "TAB5783",
  CONTENT = "000004ZW",
  codes: Readonly<Record<MortgageBinding, string>> = {
    floating: "1.1.1",
    "3m-1y": "1.1.2.1",
    "1y-3y": "1.1.2.2.1",
    "3y-5y": "1.1.2.2.2",
    "5y+": "1.1.2.3",
  },
  agreements: Readonly<Record<MortgageAgreement, string>> = { new: "0100", outstanding: "0200" };

/** The published band for a fixed-rate period in months; up to three months is floating. */
export function mortgageBindingFor(months: number): MortgageBinding {
  if (!Number.isFinite(months) || months < 0) throw new RangeError("Binding period must be zero or more months");
  return months <= 3 ? "floating" : months <= 12 ? "3m-1y" : months <= 36 ? "1y-3y" : months <= 60 ? "3y-5y" : "5y+";
}
/** The average for a month, or the latest published month before it; `undefined` before the series starts. */
export function mortgageRateAt(series: MortgageRateSeries, month: string): number | undefined {
  let found: number | undefined;
  for (const p of series.points) {
    if (p.month > month) break;
    found = p.ratePct;
  }
  return found;
}
/** Reads every dimension by its advertised position. Missing (`..`) months stay missing; nothing is interpolated. */
export function parseMortgageRates(raw: unknown): { series: MortgageRateSeries[]; updated?: string } {
  const fail = (message: string): never => {
    throw invalidResponse("scb", message);
  };
  const d = raw as {
    id: string[];
    size: number[];
    value: unknown[];
    dimension: Record<string, { category: { index: Record<string, number> | string[] } }>;
    updated?: string;
  };
  const expected = ["Referenssektor", "Motpartssektor", "Avtal", "Rantebindningstid", "ContentsCode", "Tid"];
  if (
    !d ||
    !Array.isArray(d.id) ||
    !Array.isArray(d.size) ||
    !Array.isArray(d.value) ||
    d.id.length !== expected.length ||
    d.size.length !== expected.length ||
    expected.some((id) => !d.id.includes(id)) ||
    d.size.some((n) => !Number.isInteger(n) || n < 1) ||
    d.value.length !== d.size.reduce((a, b) => a * b, 1) ||
    d.value.length > 200000
  )
    fail("Invalid mortgage-rate dataset dimensions");
  const positions = (name: string): Record<string, number> => {
    const index = d.dimension?.[name]?.category?.index,
      values = Array.isArray(index) ? Object.fromEntries(index.map((code, i) => [code, i])) : index;
    if (!values || typeof values !== "object") return fail("Missing mortgage-rate dimension");
    const list = Object.values(values),
      size = d.size[d.id.indexOf(name)];
    if (
      list.length !== size ||
      new Set(list).size !== size ||
      list.some((i) => !Number.isInteger(i) || i < 0 || i >= size)
    )
      return fail("Invalid mortgage-rate dimension positions");
    return values;
  };
  const sector = positions("Referenssektor"),
    counterpart = positions("Motpartssektor"),
    agreement = positions("Avtal"),
    binding = positions("Rantebindningstid"),
    content = positions("ContentsCode"),
    times = positions("Tid");
  if (!Object.hasOwn(sector, "1") || !Object.hasOwn(counterpart, "2c") || !Object.hasOwn(content, CONTENT))
    fail("Requested mortgage-rate series is absent");
  const stride = d.id.map((_, i) => d.size.slice(i + 1).reduce((a, b) => a * b, 1)),
    months = Object.entries(times).sort(([a], [b]) => a.localeCompare(b)),
    series: MortgageRateSeries[] = [];
  for (const period of Object.keys(times))
    if (!/^\d{4}M(0[1-9]|1[0-2])$/.test(period)) fail("Invalid mortgage-rate month");
  for (const [kind, agreementCode] of Object.entries(agreements) as [MortgageAgreement, string][])
    for (const [band, bindingCode] of Object.entries(codes) as [MortgageBinding, string][]) {
      if (!Object.hasOwn(agreement, agreementCode) || !Object.hasOwn(binding, bindingCode)) continue;
      const points: MortgageRatePoint[] = [];
      for (const [period, i] of months) {
        const dims: Record<string, number> = {
            Referenssektor: sector["1"],
            Motpartssektor: counterpart["2c"],
            Avtal: agreement[agreementCode],
            Rantebindningstid: binding[bindingCode],
            ContentsCode: content[CONTENT],
            Tid: i,
          },
          value = d.value[d.id.reduce((n, id, j) => n + dims[id] * stride[j], 0)];
        if (value === null) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value < -5 || value > 50)
          fail("Invalid mortgage rate");
        points.push({
          month: `${period.slice(0, 4)}-${period.slice(5)}`,
          ratePct: Math.round((value as number) * 10000) / 10000,
        });
      }
      if (points.length)
        series.push({
          agreement: kind,
          binding: band,
          label: `${MORTGAGE_BINDINGS[band]} · ${kind === "new" ? "nya avtal" : "alla lån"}`,
          points,
        });
    }
  if (!series.length) fail("No mortgage-rate observations");
  return { series, ...(typeof d.updated === "string" ? { updated: d.updated } : {}) };
}
/** Average household mortgage rates. */
export interface MortgageRateClient {
  /** Every published band for new and outstanding loans, cached like other monthly SCB series. */
  mortgageRates(options?: { signal?: AbortSignal }): Promise<MortgageRates>;
}
/** Whole official table in one request, durably cached with last-good fallback. */
export function createMortgageRateClient(options: ClientOptions | Context = {}): MortgageRateClient {
  const ctx = createContext(options);
  return {
    mortgageRates(options = {}) {
      return cachedWithStore<MortgageRates>(
        ctx,
        "mortgage-rates:v1",
        ctx.ttl.cpi,
        (v): v is MortgageRates =>
          !!v &&
          typeof v === "object" &&
          Array.isArray((v as MortgageRates).series) &&
          (v as MortgageRates).series.length > 0 &&
          typeof (v as MortgageRates).fetchedAt === "string",
        async (signal) => {
          const url =
            `${ctx.endpoints.scb.replace(/\/+$/, "")}/tables/${TABLE}/data?lang=sv&outputFormat=json-stat2` +
            `&valueCodes[Referenssektor]=1&valueCodes[Motpartssektor]=2c` +
            `&valueCodes[Avtal]=${Object.values(agreements).join(",")}` +
            `&valueCodes[Rantebindningstid]=${Object.values(codes).join(",")}` +
            `&valueCodes[ContentsCode]=${CONTENT}&valueCodes[Tid]=*`;
          return {
            ...parseMortgageRates(await ctx.http.json("scb", url, { signal })),
            source: MORTGAGE_RATE_SOURCE.name,
            sourceUrl: MORTGAGE_RATE_SOURCE.url,
            table: TABLE,
            fetchedAt: new Date(ctx.now()).toISOString(),
          };
        },
        { signal: options.signal, source: "scb" },
      );
    },
  };
}
