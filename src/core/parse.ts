/**
 * Small, shared helpers for reading untrusted source data. Every parser in the package uses these, so a string, a
 * number or a date is judged the same way everywhere.
 *
 * ```ts
 * finiteNumber("12", { strings: true }); // 12
 * finiteNumber(-1, { min: 0 });          // null
 * isoDay("2026-02-30");                  // undefined
 * fold(" Åraslöv ");                     // "araslov"
 * ```
 *
 * @module
 */
import { SourceError } from "./errors.ts";
import { isCalendarDate } from "./time.ts";

/**
 * Folds case, diacritics and spacing for comparisons: `" Åraslöv  Gård "` → `"araslov gard"`. Uses compatibility
 * decomposition, so ligatures such as `ﬁ` compare equal to their letters.
 */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("sv").trim().replace(/\s+/g, " ");
}

/** A trimmed, non-empty string (cut to `max` characters), or `undefined` for anything else. */
export function text(value: unknown, max?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return max === undefined ? trimmed : trimmed.slice(0, max);
}

/** Options for {@link finiteNumber}. */
export interface NumberOptions {
  /** Smallest accepted value. */
  min?: number;
  /** Also accept numeric strings such as `"12.5"` (an empty string is never a number). Default `false`. */
  strings?: boolean;
}

/** A finite number, or `null` for `null`, `undefined`, `""`, `NaN`, infinities, other types and values below `min`. */
export function finiteNumber(value: unknown, options: NumberOptions = {}): number | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (options.strings && typeof value === "string" && value.trim() !== "") n = Number(value);
  else return null;
  if (!Number.isFinite(n)) return null;
  return options.min !== undefined && n < options.min ? null : n;
}

/** The calendar day of `"YYYY-MM-DD"` or `"YYYY-MM-DDT…"`, or `undefined` when it is not a real date. */
export function isoDay(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return undefined;
  const day = value.slice(0, 10);
  return isCalendarDate(day) ? day : undefined;
}

/** The UTC calendar day of a time in milliseconds since the epoch, or `undefined` for anything that is not one. */
export function dayFromEpochMs(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/** The fields of a JSON object, or an empty object for anything else (arrays, `null`, primitives). */
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A JSON array, or an empty array for anything else. */
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The error every parser throws when a source answers in an unexpected format. */
export function invalidResponse(source: string, message: string = `Unexpected response from ${source}`): SourceError {
  return new SourceError(message, { code: "invalid-response", source });
}
