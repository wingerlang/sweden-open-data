/**
 * Consumer price indices from Statistics Sweden (SCB) and pure functions for inflation arithmetic: what an amount
 * from one month is worth in another, the inflation rate for any period and the real change of a salary.
 *
 * Every function works on a {@link CpiSeries} you already have, so they run anywhere – also in the browser on data
 * your server fetched once.
 *
 * @module
 */
import { SourceError } from "../core/errors.ts";

/** The indices that are available. */
export type CpiIndex = "KPI" | "KPIF" | "KPIF-XE";

/** One month of an index, `month` as `YYYY-MM`. */
export interface CpiPoint {
  readonly month: string;
  readonly value: number;
}

/** A complete monthly index series. */
export interface CpiSeries {
  readonly index: CpiIndex;
  /** Swedish name, for example "Konsumentprisindex (KPI)". */
  readonly label: string;
  /** Reference period of the values. */
  readonly base: "2020=100";
  /** All months with a published value, oldest first. */
  readonly points: readonly CpiPoint[];
  /** When SCB last updated the newest table, if it said. */
  readonly updated?: string;
  /** When the values were fetched. */
  readonly fetchedAt: string;
  /** `true` when the source failed and an older copy is returned. */
  readonly stale?: boolean;
  readonly source: string;
  readonly sourceUrl: string;
  /** SCB tables the series is made of. */
  readonly tables: readonly string[];
}

/** Where the indices come from – show it next to the data. SCB's open data is free to use (CC0). */
export const CPI_SOURCE: { readonly name: string; readonly url: string; readonly license: string } = Object.freeze({
  name: "SCB, Statistikdatabasen",
  url: "https://www.scb.se/kpi",
  license: "CC0",
});

/** One SCB table and content code that makes up (part of) a series. Later parts win from their first month. */
export interface CpiTablePart {
  readonly table: string;
  readonly content: string;
}

/**
 * Which SCB tables each index is read from. KPI is the official ("fastställda") series: the 1980=100 figures
 * rebased to 2020=100 up to December 2025, then the official 2020=100 figures. KPIF and KPIF-XE start in 1987.
 */
export const CPI_TABLES: Readonly<
  Record<CpiIndex, { readonly label: string; readonly parts: readonly CpiTablePart[] }>
> = Object.freeze({
  KPI: {
    label: "Konsumentprisindex (KPI)",
    parts: [
      { table: "TAB6792", content: "000007T9" },
      { table: "TAB6596", content: "00000808" },
    ],
  },
  KPIF: { label: "KPI med fast ränta (KPIF)", parts: [{ table: "TAB6590", content: "000007ZN" }] },
  "KPIF-XE": { label: "KPIF exklusive energi (KPIF-XE)", parts: [{ table: "TAB6593", content: "000007ZW" }] },
});

/** Every index, in the order they are usually shown. */
export const CPI_INDICES: readonly CpiIndex[] = Object.freeze(["KPI", "KPIF", "KPIF-XE"] as const);

/** `true` for a known {@link CpiIndex}. */
export function isCpiIndex(value: unknown): value is CpiIndex {
  return typeof value === "string" && Object.hasOwn(CPI_TABLES, value);
}

const invalid = (message: string): SourceError => new SourceError(message, { source: "scb", code: "invalid-response" });

/**
 * Reads one content code from an SCB JSON-stat 2.0 answer with the dimensions `ContentsCode` and `Tid` (month,
 * `2026M09`). Months without a value are left out.
 */
export function parseScbMonthly(raw: unknown, content: string): { points: CpiPoint[]; updated?: string } {
  const d = raw as {
    id?: unknown;
    size?: unknown;
    value?: unknown;
    updated?: unknown;
    dimension?: Record<string, { category?: { index?: Record<string, number> | string[] } }>;
  };
  if (!d || typeof d !== "object" || !Array.isArray(d.id) || !Array.isArray(d.size) || !Array.isArray(d.value)) {
    throw invalid("SCB did not answer with JSON-stat");
  }
  const ids = d.id as string[],
    size = d.size as number[],
    values = d.value as unknown[];
  const positions = (name: string): Record<string, number> => {
    const index = d.dimension?.[name]?.category?.index;
    if (Array.isArray(index)) return Object.fromEntries(index.map((k, i) => [k, i]));
    if (index && typeof index === "object") return index;
    throw invalid(`SCB answer lacks the dimension ${name}`);
  };
  const time = positions("Tid"),
    contents = positions("ContentsCode");
  if (!(content in contents)) throw invalid(`SCB answer lacks ${content}`);
  if (values.length !== size.reduce((a, b) => a * b, 1) || values.length > 200_000)
    throw invalid("SCB answer has the wrong size");
  // Row-major position of (content, month) with any other dimensions fixed at 0.
  const stride = ids.map((_, i) => size.slice(i + 1).reduce((a, b) => a * b, 1));
  const at = (dims: Record<string, number>): number => ids.reduce((sum, id, i) => sum + (dims[id] ?? 0) * stride[i], 0);
  const points: CpiPoint[] = [];
  for (const [code, i] of Object.entries(time)) {
    const m = /^(\d{4})M(\d{2})$/.exec(code);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw invalid(`Unexpected SCB month ${code}`);
    const v = values[at({ Tid: i, ContentsCode: contents[content] })];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw invalid(`Unexpected SCB value for ${code}`);
    points.push({ month: `${m[1]}-${m[2]}`, value: v });
  }
  points.sort((a, b) => a.month.localeCompare(b.month));
  const updated = typeof d.updated === "string" ? d.updated : undefined;
  return updated ? { points, updated } : { points };
}

/** Joins parts of a series: each later part replaces the earlier ones from its first month on. */
export function spliceSeries(parts: readonly (readonly CpiPoint[])[]): CpiPoint[] {
  let out: CpiPoint[] = [];
  for (const part of parts) {
    if (!part.length) continue;
    const from = part[0].month;
    out = [...out.filter((p) => p.month < from), ...part];
  }
  return out;
}

/** `YYYY-MM` from `YYYY-MM`, `YYYY-MM-DD` or an ISO timestamp. Throws `RangeError` for anything else. */
export function toMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})(?:-\d{2}(?:T.*)?)?$/.exec(value);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RangeError(`Not a month: ${value}`);
  return `${m[1]}-${m[2]}`;
}

/** Adds months to `YYYY-MM`. */
export function addMonths(month: string, months: number): string {
  const [y, m] = toMonth(month).split("-").map(Number);
  const t = y * 12 + (m - 1) + months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** The index value for a month, or `undefined` when it is not published (yet). */
export function cpiAt(series: Pick<CpiSeries, "points">, month: string): number | undefined {
  const key = toMonth(month);
  const points = series.points;
  let lo = 0,
    hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1,
      m = points[mid].month;
    if (m === key) return points[mid].value;
    if (m < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** The newest month with a value. */
export function latestCpi(series: Pick<CpiSeries, "points">): CpiPoint | undefined {
  return series.points[series.points.length - 1];
}

/** First and last month of the series. */
export function cpiRange(series: Pick<CpiSeries, "points">): { from: string; to: string } | undefined {
  return series.points.length
    ? { from: series.points[0].month, to: series.points[series.points.length - 1].month }
    : undefined;
}

function valueAt(series: Pick<CpiSeries, "points" | "index">, month: string): number {
  const v = cpiAt(series, month);
  if (v === undefined) {
    const r = cpiRange(series);
    throw new RangeError(
      `${series.index ?? "The index"} has no value for ${toMonth(month)}${r ? ` (${r.from}–${r.to})` : ""}`,
    );
  }
  return v;
}

/** The result of {@link adjustForInflation}. */
export interface InflationAdjustment {
  /** The amount expressed in the prices of `to`. */
  readonly amount: number;
  /** Price change between the months: `amount = original × factor`. */
  readonly factor: number;
  /** Inflation between the months, as a fraction (`0.25` = 25 %). */
  readonly change: number;
  readonly from: string;
  readonly to: string;
}

/**
 * What `amount` in the prices of month `from` is worth in the prices of month `to` (default: the newest month).
 *
 * @example 10 000 kr in January 2000, in today's money
 * ```ts
 * const kpi = await se.economy.cpi("KPI");
 * adjustForInflation(kpi, 10_000, "2000-01").amount; // ≈ 16 000
 * ```
 */
export function adjustForInflation(
  series: Pick<CpiSeries, "points" | "index">,
  amount: number,
  from: string,
  to?: string,
): InflationAdjustment {
  if (!Number.isFinite(amount)) throw new RangeError("amount must be a finite number");
  const end = to === undefined ? latestCpi(series)?.month : toMonth(to);
  if (!end) throw new RangeError("The series is empty");
  const start = toMonth(from),
    factor = valueAt(series, end) / valueAt(series, start);
  return { amount: amount * factor, factor, change: factor - 1, from: start, to: end };
}

/** Inflation over the `months` months up to and including `month` (default 12, the usual annual rate), or `null`. */
export function inflationRate(series: Pick<CpiSeries, "points">, month: string, months = 12): number | null {
  if (!Number.isInteger(months) || months < 1) throw new RangeError("months must be a positive integer");
  const now = cpiAt(series, month),
    before = cpiAt(series, addMonths(month, -months));
  return now === undefined || before === undefined ? null : now / before - 1;
}

/** The annual inflation rate (12-month change) for every month where it can be calculated. */
export function inflationRates(series: Pick<CpiSeries, "points">, months = 12): CpiPoint[] {
  return series.points.flatMap((p) => {
    const r = inflationRate(series, p.month, months);
    return r === null ? [] : [{ month: p.month, value: r }];
  });
}

/** Average annual inflation between two months (geometric, as a fraction per year). */
export function averageAnnualInflation(series: Pick<CpiSeries, "points" | "index">, from: string, to: string): number {
  const a = toMonth(from),
    b = toMonth(to);
  const months = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));
  if (months <= 0) throw new RangeError("to must be after from");
  return (valueAt(series, b) / valueAt(series, a)) ** (12 / months) - 1;
}

/** Average of the twelve months of a year, or `null` when any month is missing. */
export function annualAverage(series: Pick<CpiSeries, "points">, year: number): number | null {
  const values = Array.from({ length: 12 }, (_, i) => cpiAt(series, `${year}-${String(i + 1).padStart(2, "0")}`));
  return values.every((v) => v !== undefined) ? (values as number[]).reduce((a, b) => a + b, 0) / 12 : null;
}

/** An amount at a point in time – a salary, a price, a balance. */
export interface DatedAmount {
  readonly amount: number;
  /** `YYYY-MM` (or a date in that month). */
  readonly month: string;
}

/** The result of {@link realChange}. */
export interface RealChange {
  /** Change in kronor, as a fraction (`0.3` = +30 %). */
  readonly nominal: number;
  /** Inflation between the months, as a fraction. */
  readonly inflation: number;
  /** Change in purchasing power, as a fraction. Positive when the amount grew faster than prices. */
  readonly real: number;
  /** The earlier amount in the prices of the later month – what the later amount must be to keep its purchasing power. */
  readonly earlierInLaterPrices: number;
}

/**
 * How an amount developed compared with prices – for a salary: did it keep up with inflation?
 *
 * @example
 * ```ts
 * const r = realChange(kpi, { amount: 32_000, month: "2018-01" }, { amount: 41_000, month: "2026-09" });
 * r.real; // > 0: the salary buys more than in 2018
 * ```
 */
export function realChange(
  series: Pick<CpiSeries, "points" | "index">,
  earlier: DatedAmount,
  later: DatedAmount,
): RealChange {
  if (!(earlier.amount > 0) || !(later.amount >= 0))
    throw new RangeError("The earlier amount must be positive and the later one not negative");
  const adj = adjustForInflation(series, earlier.amount, earlier.month, later.month);
  return {
    nominal: later.amount / earlier.amount - 1,
    inflation: adj.change,
    real: later.amount / adj.amount - 1,
    earlierInLaterPrices: adj.amount,
  };
}

/**
 * Turns nominal values (for example a balance, an index level or a price series) into real values in the prices of
 * month `to` (default: newest). Points in months without an index value are left out.
 */
export function deflate(
  series: Pick<CpiSeries, "points" | "index">,
  values: readonly DatedAmount[],
  to?: string,
): DatedAmount[] {
  const end = to === undefined ? latestCpi(series)?.month : toMonth(to);
  if (!end) return [];
  const target = valueAt(series, end);
  return values.flatMap((v) => {
    const at = cpiAt(series, v.month);
    return at === undefined ? [] : [{ amount: (v.amount * target) / at, month: toMonth(v.month) }];
  });
}
