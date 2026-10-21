/**
 * Free public-page vehicle lookup from Transportstyrelsen. No credentials, owner data or access-control bypass.
 *
 * @experimental Transportstyrelsen publishes this page for people, not as an API, and no agreement covers
 * automated reading. Registration numbers can be personal data under GDPR. Kept out of the main entry point until
 * the terms are confirmed in writing;
 * import it from `@wingerlang/sweden-open-data/vehicles/free`.
 *
 * @module
 */
import { createContext, type ClientOptions } from "../core/context.ts";
import { SourceError } from "../core/errors.ts";
import { finiteNumber, invalidResponse, isoDay } from "../core/parse.ts";
import { normalizeVehicleRegistration, type VehicleClient, type VehicleRecord } from "./mod.ts";
const source = "transportstyrelsen",
  base = "https://fordon-fu-regnr.transportstyrelsen.se/UppgifterAnnatFordon/TillbakaTillFordonsuppgifter";
/** Links for opening a vehicle in an ordinary browser tab, when automatic reading is not possible. */
export function vehicleLookupLinks(registrationNumber: string): { transportstyrelsen: string; biluppgifter: string } {
  const plate = normalizeVehicleRegistration(registrationNumber);
  return {
    transportstyrelsen: base + "?Registreringsnummer=" + encodeURIComponent(plate),
    biluppgifter: "https://biluppgifter.se/fordon/" + plate.toLowerCase() + "/",
  };
}
const decode = (s: string) =>
  s
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, v: string) => {
      const n = v[0].toLowerCase() === "x" ? parseInt(v.slice(1), 16) : Number(v);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|aring|Aring|auml|Auml|ouml|Ouml);/g,
      (v) =>
        ({
          "&nbsp;": " ",
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&aring;": "å",
          "&Aring;": "Å",
          "&auml;": "ä",
          "&Auml;": "Ä",
          "&ouml;": "ö",
          "&Ouml;": "Ö",
        })[v] || v,
    );
/** Parse labelled fields only. Blank and changed pages fail closed; odometer units are never assumed. */
export function parseTransportstyrelsenVehicle(
  html: string,
  registrationNumber: string,
  fetchedAt: string,
): VehicleRecord {
  const plate = normalizeVehicleRegistration(registrationNumber);
  if (html.length > 2_000_000) throw new RangeError("Vehicle page too large");
  const fields = new Map<string, string>();
  const plain = (s: string) =>
    decode(
      s
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const m = /<strong\b[^>]*>([\s\S]*?)<\/strong>\s*<br\s*\/?>([\s\S]*)/i.exec(match[1]);
    if (m) {
      const key = plain(m[1]).toLocaleLowerCase("sv");
      if (!fields.has(key)) fields.set(key, plain(m[2]));
    }
  }
  const get = (...labels: string[]) => labels.map((k) => fields.get(k)).find(Boolean),
    reg = get("registreringsnummer");
  if (!reg || normalizeVehicleRegistration(reg) !== plate)
    throw invalidResponse(source, "Vehicle page missing or mismatched");
  const date = isoDay;
  // Page values carry units and spaces ("1 234 kronor"); a value without digits is missing, never zero.
  const number = (v?: string): number | undefined =>
    finiteNumber(v?.replace(/[^0-9.,]/g, "").replace(",", "."), { min: 0, strings: true }) ?? undefined;
  const mileage = get("mätarställning"),
    modelYear = number(get("årsmodell", "fordonsår"));
  const result: VehicleRecord = {
    registrationNumber: plate,
    source: "transportstyrelsen",
    fetchedAt,
    make: get("fabrikat", "märke"),
    model: get("handelsbeteckning", "modell"),
    modelYear:
      modelYear && Number.isInteger(modelYear) && modelYear >= 1886 && modelYear <= 2200 ? modelYear : undefined,
    annualTaxKr: number(get("årsskatt", "fordonsskatt")),
    mileageKm:
      mileage && /\bkm\b/i.test(mileage)
        ? number(mileage)
        : mileage && /\bmil\b/i.test(mileage)
          ? (number(mileage) ?? 0) * 10
          : undefined,
    lastInspectionDate: date(get("senast godkända besiktning", "senaste besiktning")),
    nextInspectionDeadline: date(get("besiktas senast", "besiktigas senast")),
    firstRegistered: date(
      get("i trafik första gången i sverige", "påställt första gången i sverige", "i trafik första gången"),
    ),
  };
  if (!result.make && !result.model && !result.nextInspectionDeadline)
    throw invalidResponse(source, "Vehicle page has no observations");
  return result;
}
/** Best effort public HTML, not an official API contract. Falls back to a user-opened page when its format changes. */
export function createFreeVehicleClient(options: Omit<ClientOptions, "endpoints" | "store"> = {}): VehicleClient {
  const redacted = base + "?Registreringsnummer=[redacted]";
  const clean = (e: SourceError) =>
    new SourceError("Public vehicle lookup failed (" + e.code + ")", {
      source,
      code: e.code,
      status: e.status,
      url: redacted,
    });
  // Pages are read with the shared HTTP layer: timeouts, retries, the response size limit (2 MB here) and statistics.
  const ctx = createContext({
    maxResponseBytes: 2_000_000,
    ...options,
    userAgent: options.userAgent || "sweden-open-data",
    onRequest: (e) => options.onRequest?.({ ...e, url: redacted, error: e.error ? clean(e.error) : undefined }),
    onCacheEvent: (e) => options.onCacheEvent?.({ ...e, key: "vehicle:[redacted]" }),
  });
  const load = async (plate: string, signal?: AbortSignal): Promise<VehicleRecord | null> => {
    try {
      const html = await ctx.http.text(source, vehicleLookupLinks(plate).transportstyrelsen, {
        signal,
        allowNotFound: true,
        redirect: "error",
      });
      return html === undefined ? null : parseTransportstyrelsenVehicle(html, plate, new Date(ctx.now()).toISOString());
    } catch (e) {
      if (e instanceof SourceError) throw clean(e);
      throw new SourceError("Public vehicle lookup failed", { source, code: "invalid-response", url: redacted });
    }
  };
  return Object.freeze({
    lookup: async (reg: string, o?: { signal?: AbortSignal }) => {
      const plate = normalizeVehicleRegistration(reg);
      return ctx.cache.get<VehicleRecord | null>(
        "vehicle:" + plate,
        (v) => (v === null ? 60_000 : 6 * 3_600_000),
        (signal) => load(plate, signal),
        { signal: o?.signal, source },
      );
    },
    clearCache: () => ctx.cache.clear(),
    stats: () => ctx.stats.snapshot(),
    resetStats: () => ctx.stats.reset(),
  });
}
