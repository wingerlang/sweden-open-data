/**
 * Optional authenticated vehicle lookup from Biluppgifter. Unlike the open sources it needs your own provider
 * agreement and API key, so use it on a server only. Registry observations only: no owner, address, VIN or finance data.
 *
 * ```ts
 * import { createVehicleClient } from "@wingerlang/sweden-open-data/vehicles";
 *
 * const vehicles = createVehicleClient({ apiKey: process.env.BILUPPGIFTER_API_KEY! });
 * const vehicle = await vehicles.lookup("ABC123"); // null when the registry has no such vehicle
 * ```
 *
 * The free, experimental Transportstyrelsen lookup lives in `/vehicles/free`.
 *
 * @module
 */
import { createContext, DEFAULT_ENDPOINTS, DEFAULT_TTL } from "../core/context.js";
import { SourceError } from "../core/errors.js";
import { finiteNumber, isoDay, text } from "../core/parse.js";
import { redactError, redactedHooks } from "../core/source.js";
const SOURCE = "biluppgifter";
// Always the default address: the API key is never sent to an overridden endpoint.
const BASE = DEFAULT_ENDPOINTS.biluppgifter;
const REDACTED = BASE + "[redacted]";
/** Canonical Swedish plate, e.g. `abc 123` becomes `ABC123`. Throws for malformed input. */
export function normalizeVehicleRegistration(value) {
    if (typeof value !== "string" || value.length > 16)
        throw new RangeError("Invalid Swedish registration number");
    const plate = value.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-Z]{3}[0-9]{2}[A-Z0-9]$/.test(plate))
        throw new RangeError("Invalid Swedish registration number");
    return plate;
}
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
const number = (v) => finiteNumber(v, { min: 0, strings: true }) ?? undefined;
const date = isoDay;
const year = (v) => {
    const n = number(v);
    return n !== undefined && Number.isInteger(n) && n >= 1886 && n <= 2200 ? n : undefined;
};
const redaction = {
    source: SOURCE,
    url: REDACTED,
    message: "Vehicle lookup failed",
    cacheKey: "vehicle:[redacted]",
};
const publicError = (e) => redactError(e, redaction);
/**
 * Parses documented Biluppgifter v1 basic/status/inspection packages, preserving missing values and zero tax.
 * Throws SourceError for an empty or mismatched response. No inspection dates are calculated.
 * @example parseBiluppgifterVehicle(payload, 'ABC123', '2026-10-16T12:00:00Z')
 */
export function parseBiluppgifterVehicle(payload, registrationNumber, fetchedAt) {
    const plate = normalizeVehicleRegistration(registrationNumber), data = object(object(payload).data), attrs = object(data.attributes);
    const b = object(object(data.basic).data), s = object(object(data.status).data), i = object(object(data.inspection).data);
    const registered = text(attrs.regno);
    if (registered && registered.replace(/\s/g, "").toUpperCase() !== plate)
        throw new SourceError("Vehicle registration did not match", {
            source: SOURCE,
            code: "invalid-response",
            url: REDACTED,
        });
    const result = {
        registrationNumber: plate,
        make: text(b.make),
        model: text(b.model),
        modelYear: year(b.model_year) ?? year(b.vehicle_year),
        vehicleYear: year(b.vehicle_year),
        annualTaxKr: number(s.tax),
        mileageKm: number(i.meter),
        lastInspectionDate: date(i.latest_inspection),
        nextInspectionDeadline: date(i.inspection_valid_until),
        firstRegistered: date(s.first_registered),
        source: SOURCE,
        fetchedAt,
    };
    if (!result.make &&
        !result.model &&
        result.modelYear === undefined &&
        result.annualTaxKr === undefined &&
        result.mileageKm === undefined &&
        !result.lastInspectionDate &&
        !result.nextInspectionDeadline &&
        !result.firstRegistered)
        throw new SourceError("No usable vehicle observations", {
            source: SOURCE,
            code: "invalid-response",
            url: REDACTED,
        });
    return result;
}
/**
 * Creates an opt-in, server-side lookup using Biluppgifter v1. Reuses shared HTTP retries/timeouts and bounded
 * in-memory caching. Plates, keys and upstream causes are removed from telemetry and returned errors.
 * @example const vehicles = createVehicleClient({apiKey: process.env.BILUPPGIFTER_API_KEY!});
 */
export function createVehicleClient(options) {
    if (typeof options?.apiKey !== "string" || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey))
        throw new RangeError("A server-side Biluppgifter API key is required");
    const ttl = options.ttlMs ?? DEFAULT_TTL.vehicle;
    if (!Number.isFinite(ttl) || ttl < 0)
        throw new RangeError("ttlMs must be non-negative");
    const { apiKey, ttlMs: _, ...network } = options, request = options.fetch ?? globalThis.fetch;
    const ctx = createContext({
        ...network,
        userAgent: options.userAgent || "sweden-open-data",
        fetch: (input, init) => {
            const headers = new Headers(init?.headers);
            headers.set("Authorization", "Bearer " + apiKey.trim());
            return request(input, { ...init, headers, redirect: "error" });
        },
        ...redactedHooks(options, redaction),
    });
    const load = async (plate, signal) => {
        try {
            const raw = await ctx.http.json(SOURCE, BASE + encodeURIComponent(plate) + "?include=basic,status,inspection", {
                allowNotFound: true,
                signal,
            });
            return raw === undefined ? null : parseBiluppgifterVehicle(raw, plate, new Date(ctx.now()).toISOString());
        }
        catch (error) {
            if (error instanceof SourceError)
                throw publicError(error);
            throw error;
        }
    };
    return Object.freeze({
        lookup: async (registrationNumber, lookupOptions) => {
            const plate = normalizeVehicleRegistration(registrationNumber);
            return ctx.cache.get("vehicle:" + plate, (v) => (v === null ? Math.min(ttl, 300_000) : ttl), (signal) => load(plate, signal), { signal: lookupOptions?.signal, source: SOURCE });
        },
        clearCache: () => ctx.cache.clear(),
        stats: () => ctx.stats.snapshot(),
        resetStats: () => ctx.stats.reset(),
    });
}
