/** Official SCB permanent small-house price indices. No individual properties or addresses. @module */
import { createContext, type ClientOptions, type Context } from "../core/context.ts";
import { cachedWithStore } from "../core/source.ts";
import { invalidResponse } from "../core/parse.ts";

/** Published observation frequency: quarters and years are not interchangeable. */
export type HousingFrequency = "quarter" | "year";
/** One observed regional house-price index level for its published period. */
export interface HousingPoint {
  readonly period: string;
  readonly from: string;
  readonly to: string;
  readonly value: number;
}
/** A dated regional house-price series with source and revision metadata. */
export interface HousingSeries {
  readonly region: string;
  readonly label: string;
  readonly frequency: HousingFrequency;
  readonly base: string;
  readonly points: readonly HousingPoint[];
  readonly source: string;
  readonly sourceUrl: string;
  readonly table: string;
  readonly fetchedAt: string;
  readonly updated?: string;
  readonly stale?: boolean;
  readonly notes: readonly string[];
}
/** Official source for regional house-price indices. */
export const HOUSING_SOURCE: { readonly name: string; readonly url: string; readonly license: string } = {
  name: "SCB · fastighetsprisindex för permanenta småhus",
  url: "https://www.scb.se/BO0501",
  license: "CC0",
};
/** Regions for which house-price observations can be requested. */
export const HOUSING_REGIONS: Readonly<Record<HousingFrequency, Readonly<Record<string, string>>>> = {
  quarter: {
    "00": "Riket",
    "0010": "Stor-Stockholm",
    "0020": "Stor-Göteborg",
    "0030": "Stor-Malmö",
    RIKS1: "Stockholms län",
    RIKS2: "Östra mellansverige",
    RIKS3: "Småland med öarna",
    RIKS4: "Sydsverige",
    RIKS5: "Västsverige",
    RIKS6: "Norra mellansverige",
    RIKS7: "Mellersta Norrland",
    RIKS8: "Övre Norrland",
  },
  year: {
    "00": "Riket",
    "01": "Stockholms län",
    "03": "Uppsala län",
    "04": "Södermanlands län",
    "05": "Östergötlands län",
    "06": "Jönköpings län",
    "07": "Kronobergs län",
    "08+09": "Kalmar och Gotlands län",
    "10": "Blekinge län",
    "12": "Skåne län",
    "13": "Hallands län",
    "14": "Västra Götalands län",
    "17": "Värmlands län",
    "18": "Örebro län",
    "19": "Västmanlands län",
    "20": "Dalarnas län",
    "21": "Gävleborgs län",
    "22": "Västernorrlands län",
    "23": "Jämtlands län",
    "24": "Västerbottens län",
    "25": "Norrbottens län",
  },
};
/** Checks a supported region identifier before querying the provider. */
export function isHousingRegion(region: string, frequency: HousingFrequency = "quarter"): boolean {
  return Object.hasOwn(HOUSING_REGIONS[frequency], region);
}
/** Cancellation and observation frequency for one house-price request. */
export interface HousingOptions {
  frequency?: HousingFrequency;
  signal?: AbortSignal;
}
/** Official regional house-price observations backed by the shared cache. */
export interface HousingClient {
  housePrices(region?: string, options?: HousingOptions): Promise<HousingSeries>;
}
const definitions: Record<HousingFrequency, { table: string; dimension: string; content: string; base: string }> = {
  quarter: { table: "TAB1150", dimension: "Region", content: "BO0501K2", base: "1981=100" },
  year: { table: "TAB1148", dimension: "Lan", content: "BO0501R5", base: "1990=100" },
};
/** Read all dimensions by their advertised positions; never assume a dimension order or substitute another region. */
export function parseHousing(
  raw: unknown,
  region: string,
  frequency: HousingFrequency,
): { points: HousingPoint[]; updated?: string; notes: string[] } {
  const fail = (message: string): never => {
    throw invalidResponse("scb", message);
  };
  if (!isHousingRegion(region, frequency)) throw new RangeError("Unknown housing region");
  const d = raw as {
      id: string[];
      size: number[];
      value: unknown[];
      dimension: Record<string, { category: { index: Record<string, number> | string[] } }>;
      updated?: string;
      note?: unknown[];
    },
    def = definitions[frequency];
  if (
    !d ||
    !Array.isArray(d.id) ||
    !Array.isArray(d.size) ||
    !Array.isArray(d.value) ||
    d.id.length !== 3 ||
    d.size.length !== 3 ||
    new Set(d.id).size !== 3 ||
    d.id.some((id) => ![def.dimension, "ContentsCode", "Tid"].includes(id)) ||
    d.size.some((n) => !Number.isInteger(n) || n < 1) ||
    d.value.length !== d.size.reduce((a, b) => a * b, 1) ||
    d.value.length > 100000
  )
    fail("Invalid housing dataset dimensions");
  const positions = (name: string): Record<string, number> => {
    const index = d.dimension?.[name]?.category?.index,
      values = Array.isArray(index) ? Object.fromEntries(index.map((code, i) => [code, i])) : index;
    if (!values || typeof values !== "object") return fail("Missing housing dimension");
    const list = Object.values(values),
      size = d.size[d.id.indexOf(name)];
    if (
      list.length !== size ||
      new Set(list).size !== size ||
      list.some((i) => !Number.isInteger(i) || i < 0 || i >= size)
    )
      return fail("Invalid housing dimension positions");
    return values;
  };
  const regions = positions(def.dimension),
    contents = positions("ContentsCode"),
    times = positions("Tid");
  if (!Object.hasOwn(regions, region) || !Object.hasOwn(contents, def.content))
    fail("Requested housing series is absent");
  const stride = d.id.map((_, i) => d.size.slice(i + 1).reduce((a, b) => a * b, 1)),
    points: HousingPoint[] = [];
  for (const [period, i] of Object.entries(times)) {
    if (!(frequency === "quarter" ? /^\d{4}K[1-4]$/ : /^\d{4}$/).test(period)) fail("Invalid housing period");
    const year = Number(period.slice(0, 4)),
      quarter = frequency === "quarter" ? Number(period.slice(-1)) : 0,
      month = quarter ? (quarter - 1) * 3 + 1 : 1,
      endMonth = quarter ? quarter * 3 : 12;
    const dims: Record<string, number> = {
        [def.dimension]: regions[region],
        ContentsCode: contents[def.content],
        Tid: i,
      },
      value = d.value[d.id.reduce((n, id, j) => n + dims[id] * stride[j], 0)];
    if (value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail("Invalid house price index");
    points.push({
      period,
      from: `${year}-${String(month).padStart(2, "0")}-01`,
      to: `${year}-${String(endMonth).padStart(2, "0")}-${new Date(Date.UTC(year, endMonth, 0)).getUTCDate()}`,
      value: value as number,
    });
  }
  if (!points.length) fail("No house price observations");
  return {
    points: points.sort((a, b) => a.from.localeCompare(b.from)),
    ...(typeof d.updated === "string" ? { updated: d.updated } : {}),
    notes: (d.note || []).filter((n): n is string => typeof n === "string").slice(0, 20),
  };
}
/** Whole official series, deduplicated and durably cached with last-good fallback. */
export function createHousingClient(options: ClientOptions | Context = {}): HousingClient {
  const ctx = createContext(options);
  return {
    housePrices(region = "00", options = {}) {
      const frequency = options.frequency || "quarter";
      if (!["quarter", "year"].includes(frequency) || !isHousingRegion(region, frequency))
        return Promise.reject(new RangeError("Choose an available house-price region and frequency"));
      const def = definitions[frequency];
      return cachedWithStore<HousingSeries>(
        ctx,
        `housing:v1:${frequency}:${region}`,
        ctx.ttl.cpi,
        (v): v is HousingSeries =>
          !!v &&
          typeof v === "object" &&
          (v as HousingSeries).region === region &&
          (v as HousingSeries).frequency === frequency &&
          Array.isArray((v as HousingSeries).points) &&
          (v as HousingSeries).points.length > 0 &&
          typeof (v as HousingSeries).fetchedAt === "string",
        async (signal) => {
          const url = `${ctx.endpoints.scb.replace(/\/+$/, "")}/tables/${def.table}/data?lang=sv&outputFormat=json-stat2&valueCodes[${def.dimension}]=${encodeURIComponent(region)}&valueCodes[ContentsCode]=${def.content}&valueCodes[Tid]=*`;
          return {
            ...parseHousing(await ctx.http.json("scb", url, { signal }), region, frequency),
            region,
            label: HOUSING_REGIONS[frequency][region],
            frequency,
            base: def.base,
            table: def.table,
            source: HOUSING_SOURCE.name,
            sourceUrl: HOUSING_SOURCE.url,
            fetchedAt: new Date(ctx.now()).toISOString(),
          };
        },
        { signal: options.signal, source: "scb" },
      );
    },
  };
}
