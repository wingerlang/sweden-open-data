/**
 * Experimental: one bank's published mortgage list rates and monthly average rates.
 *
 * The figures are public on the bank's own rate page, but the JSON behind that page is not a documented API and no
 * agreement covers automated reading. Expect it to change without notice; keep one long-lived client with a store so
 * the last good answer is served (marked `stale`) when the page changes or is down. Never send customer data.
 *
 * @module
 */
import { createContext, type ClientOptions, type Context } from "../core/context.ts";
import { cachedWithStore } from "../core/source.ts";
import { invalidResponse } from "../core/parse.ts";

/** Banks with a readable public rate page. */
export type MortgageBank = "handelsbanken";
/** Display names and public rate pages. */
export const MORTGAGE_BANKS: Readonly<Record<MortgageBank, { readonly name: string; readonly url: string }>> =
  Object.freeze({
    handelsbanken: {
      name: "Handelsbanken",
      url: "https://www.handelsbanken.se/sv/privat/bolan/bolanerantor",
    },
  });
/** A published list rate (the bank's starting price before any individual discount). */
export interface BankListRate {
  readonly bindingMonths: number;
  readonly ratePct: number;
  readonly effectivePct?: number;
}
/** The average rate the bank's customers actually got for new loans in a month. */
export interface BankAverageRate {
  readonly month: string;
  readonly bindingMonths: number;
  readonly ratePct: number;
}
/** Today's list rates and the bank's published monthly averages (usually the last twelve months). */
export interface BankMortgageRates {
  readonly bank: MortgageBank;
  readonly name: string;
  readonly listRates: readonly BankListRate[];
  readonly averageRates: readonly BankAverageRate[];
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly stale?: boolean;
}
/** Checks a bank identifier before any request. */
export function isMortgageBank(bank: string): bank is MortgageBank {
  return Object.hasOwn(MORTGAGE_BANKS, bank);
}
const fail = (message: string): never => {
  throw invalidResponse("handelsbanken", message);
};
const rate = (row: unknown): { bindingMonths: number; ratePct: number; effectivePct?: number } => {
  const r = row as {
    periodBasisType?: unknown;
    term?: unknown;
    rateValue?: { valueRaw?: unknown };
    effectiveRateValue?: { valueRaw?: unknown };
  };
  const unit = r?.periodBasisType === "3" ? 1 : r?.periodBasisType === "4" ? 12 : 0,
    term = Number(r?.term),
    value = r?.rateValue?.valueRaw,
    effective = r?.effectiveRateValue?.valueRaw;
  if (!unit || !Number.isInteger(term) || term < 1 || term > 30) return fail("Invalid binding period");
  if (typeof value !== "number" || !Number.isFinite(value) || value < -5 || value > 50) return fail("Invalid rate");
  return {
    bindingMonths: term * unit,
    ratePct: value,
    ...(typeof effective === "number" && Number.isFinite(effective) ? { effectivePct: effective } : {}),
  };
};
/** Parses the list-rate and average-rate answers of Handelsbanken's public rate page. */
export function parseHandelsbankenRates(
  list: unknown,
  averages: unknown,
): { listRates: BankListRate[]; averageRates: BankAverageRate[] } {
  const rows = (list as { interestRates?: unknown })?.interestRates,
    periods = (averages as { averageRatePeriods?: unknown })?.averageRatePeriods;
  if (!Array.isArray(rows) || !rows.length || rows.length > 50) fail("Missing list rates");
  if (!Array.isArray(periods) || periods.length > 400) fail("Missing average rates");
  const listRates = (rows as unknown[]).map(rate).sort((a, b) => a.bindingMonths - b.bindingMonths),
    averageRates: BankAverageRate[] = [];
  if (new Set(listRates.map((r) => r.bindingMonths)).size !== listRates.length) fail("Duplicate list rates");
  for (const period of periods as { period?: unknown; rates?: unknown }[]) {
    if (
      typeof period?.period !== "string" ||
      !/^\d{4}(0[1-9]|1[0-2])$/.test(period.period) ||
      !Array.isArray(period.rates)
    )
      fail("Invalid average-rate month");
    const month = `${(period.period as string).slice(0, 4)}-${(period.period as string).slice(4)}`;
    for (const row of period.rates as unknown[]) {
      const { bindingMonths, ratePct } = rate(row);
      averageRates.push({ month, bindingMonths, ratePct });
    }
  }
  return {
    listRates,
    averageRates: averageRates.sort((a, b) => a.month.localeCompare(b.month) || a.bindingMonths - b.bindingMonths),
  };
}
/** The list rate for a binding period, or the nearest shorter published one. */
export function bankListRateFor(rates: BankMortgageRates, bindingMonths: number): BankListRate | undefined {
  const limit = Math.max(3, bindingMonths);
  return [...rates.listRates].reverse().find((r) => r.bindingMonths <= limit) ?? rates.listRates[0];
}
/** Experimental bank rate reader. */
export interface BankRateClient {
  bankMortgageRates(bank: MortgageBank, options?: { signal?: AbortSignal }): Promise<BankMortgageRates>;
}
/** One shared, cached read per bank. */
export function createBankRateClient(options: ClientOptions | Context = {}): BankRateClient {
  const ctx = createContext(options);
  return {
    bankMortgageRates(bank, options = {}) {
      if (!isMortgageBank(bank)) return Promise.reject(new RangeError("Choose a bank with published rates"));
      return cachedWithStore<BankMortgageRates>(
        ctx,
        `bank-rates:v1:${bank}`,
        ctx.ttl.cpi,
        (v): v is BankMortgageRates =>
          !!v &&
          typeof v === "object" &&
          (v as BankMortgageRates).bank === bank &&
          Array.isArray((v as BankMortgageRates).listRates) &&
          (v as BankMortgageRates).listRates.length > 0 &&
          typeof (v as BankMortgageRates).fetchedAt === "string",
        async (signal) => {
          const base = ctx.endpoints.handelsbankenRates.replace(/\/?$/, "/");
          const [list, averages] = await Promise.all([
            ctx.http.json("handelsbanken", base + "interestrates", { signal }),
            ctx.http.json("handelsbanken", base + "averagerates/", { signal }),
          ]);
          return {
            bank,
            name: MORTGAGE_BANKS[bank].name,
            ...parseHandelsbankenRates(list, averages),
            sourceUrl: MORTGAGE_BANKS[bank].url,
            fetchedAt: new Date(ctx.now()).toISOString(),
          };
        },
        { signal: options.signal, source: "handelsbanken" },
      );
    },
  };
}
