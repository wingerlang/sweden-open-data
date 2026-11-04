/**
 * Experimental: one bank's published mortgage list rates and monthly average rates.
 *
 * The figures are public on the bank's own rate page, but the JSON behind that page is not a documented API and no
 * agreement covers automated reading. Expect it to change without notice; keep one long-lived client with a store so
 * the last good answer is served (marked `stale`) when the page changes or is down. Never send customer data.
 *
 * @module
 */
import { createContext } from "../core/context.js";
import { cachedWithStore } from "../core/source.js";
import { invalidResponse } from "../core/parse.js";
/** Display names and public rate pages. */
export const MORTGAGE_BANKS = Object.freeze({
  handelsbanken: {
    name: "Handelsbanken",
    url: "https://www.handelsbanken.se/sv/privat/bolan/bolanerantor",
  },
});
/** Checks a bank identifier before any request. */
export function isMortgageBank(bank) {
  return Object.hasOwn(MORTGAGE_BANKS, bank);
}
const fail = (message) => {
  throw invalidResponse("handelsbanken", message);
};
const rate = (row) => {
  const r = row;
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
export function parseHandelsbankenRates(list, averages) {
  const rows = list?.interestRates,
    periods = averages?.averageRatePeriods;
  if (!Array.isArray(rows) || !rows.length || rows.length > 50) fail("Missing list rates");
  if (!Array.isArray(periods) || periods.length > 400) fail("Missing average rates");
  const listRates = rows.map(rate).sort((a, b) => a.bindingMonths - b.bindingMonths),
    averageRates = [];
  if (new Set(listRates.map((r) => r.bindingMonths)).size !== listRates.length) fail("Duplicate list rates");
  for (const period of periods) {
    if (
      typeof period?.period !== "string" ||
      !/^\d{4}(0[1-9]|1[0-2])$/.test(period.period) ||
      !Array.isArray(period.rates)
    )
      fail("Invalid average-rate month");
    const month = `${period.period.slice(0, 4)}-${period.period.slice(4)}`;
    for (const row of period.rates) {
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
export function bankListRateFor(rates, bindingMonths) {
  const limit = Math.max(3, bindingMonths);
  return [...rates.listRates].reverse().find((r) => r.bindingMonths <= limit) ?? rates.listRates[0];
}
/** One shared, cached read per bank. */
export function createBankRateClient(options = {}) {
  const ctx = createContext(options);
  return {
    bankMortgageRates(bank, options = {}) {
      if (!isMortgageBank(bank)) return Promise.reject(new RangeError("Choose a bank with published rates"));
      return cachedWithStore(
        ctx,
        `bank-rates:v1:${bank}`,
        ctx.ttl.cpi,
        (v) =>
          !!v &&
          typeof v === "object" &&
          v.bank === bank &&
          Array.isArray(v.listRates) &&
          v.listRates.length > 0 &&
          typeof v.fetchedAt === "string",
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
