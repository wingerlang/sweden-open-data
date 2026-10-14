/**
 * Address and place parsing for Photon (OpenStreetMap) and Open-Meteo geocoding responses, and Swedish address
 * queries. Everything here is pure.
 *
 * @module
 */
import { type Coordinates, fold, isCoordinates } from "../core/geo.ts";

/** An address (or, with `precision: "locality"`, a town or village) found for a query. */
export interface AddressSuggestion extends Coordinates {
  /** One line for display: `"Åraslöv 1105 · 288 90 Vinslöv · SE"`. */
  label: string;
  /** Street (or village) and house number, empty for localities. */
  address: string;
  city: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  /** `"address"` when the position is the house itself, `"city"` when it is the town or village. */
  precision: "address" | "city";
  /**
   * The address is not in the map data: the text is what you typed and the position is the nearest
   * village or town (named in {@link AddressSuggestion.near}). Nothing is invented.
   */
  approximate?: true;
  /** Name of the place the approximate position comes from. */
  near?: string;
}

/** A named place: a city, a village or a point of interest. */
export interface Place extends Coordinates {
  name: string;
  /** Region and, for points of interest, city. */
  region: string;
  countryCode: string;
  /** Data source and licence holder, for attribution. */
  source: string;
}

/** The parts of a Swedish address query. */
export interface AddressQuery {
  street: string;
  house: string;
  postalCode: string;
  city: string;
  /** Street and house number together. */
  address: string;
}

/**
 * Splits a Swedish address into street (or village), house number, postal code and town – with or without
 * commas. Postal codes are normalised to `"123 45"`.
 *
 * @example
 * ```ts
 * parseAddressQuery("Åraslöv 1105, 28890 Vinslöv");
 * // { street: "Åraslöv", house: "1105", postalCode: "288 90", city: "Vinslöv", address: "Åraslöv 1105" }
 * ```
 */
export function parseAddressQuery(query: string): AddressQuery {
  const t = query.replace(/\s+/g, " ").trim();
  const pc = t.match(/\b(\d{3}) ?(\d{2})\b/);
  // A five-digit number that ends the query with no comma is a house number ("Storgatan 12345"), not a postcode.
  const pcIsHouse = !!pc && !t.includes(",") && !t.slice((pc.index ?? 0) + pc[0].length).trim();
  const postal = pc && !pcIsHouse ? pc : null;
  const postalCode = postal ? postal[1] + " " + postal[2] : "";
  const before = postal ? t.slice(0, postal.index).trim() : t;
  const after = postal ? t.slice((postal.index ?? 0) + postal[0].length).trim() : "";
  const [first = "", ...rest] = before.split(",").map((s) => s.trim()).filter(Boolean);
  const houseMatch = first.match(/\s(\d+ ?[a-z]?(?:-\d+)?)$/i);
  const house = houseMatch ? houseMatch[1].replace(/\s/g, "").toUpperCase() : "";
  const street = (houseMatch ? first.slice(0, houseMatch.index) : first).trim();
  const city = [...rest, after.replace(/^[\s,]+/, "")].filter(Boolean).join(" ").trim();
  return { street, house, postalCode, city, address: [street, house].filter(Boolean).join(" ") };
}

/**
 * `true` when a result really is the queried address: every word of the street name must match and, when the
 * query has a house number, so must the number. "Åraslövsvägen 1105" or "Åraslöv 1106" never match "Åraslöv 1105".
 */
export function matchesAddressQuery(result: AddressSuggestion, query: string): boolean {
  const head = query.split(",")[0];
  const house = head.match(/\b\d+[a-z]?(?:-\d+)?\b/i)?.[0];
  const words = fold(head.split(/\b\d/)[0]).match(/[a-z]{2,}/g) ?? [];
  const tokens = new Set(fold(result.address || result.label).match(/[a-z0-9-]+/g) ?? []);
  if (!words.every((w) => tokens.has(w))) return false;
  return !house || (result.precision === "city" && !result.address) || tokens.has(fold(house));
}

const capitalize = (s: string): string => s.replace(/(^|[\s-])(\p{Ll})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/**
 * A suggestion with the address exactly as typed, positioned at a village or town that was found. Used when the
 * address itself is missing from the map data (common for rural addresses). Returns `null` without a street and
 * house number.
 */
export function approximateAddress(query: string, anchor: AddressSuggestion): AddressSuggestion | null {
  const p = parseAddressQuery(query);
  if (!p.street || !p.house) return null;
  const address = capitalize(p.address);
  const city = capitalize(p.city) || anchor.city;
  const postalCode = p.postalCode || (anchor.postalCode && fold(anchor.city) === fold(city) ? anchor.postalCode : "");
  const near = anchor.address ? anchor.address.replace(/\s\d.*$/, "") : anchor.label.split(" · ")[0];
  return {
    label: [address, [postalCode, city].filter(Boolean).join(" "), anchor.countryCode].filter(Boolean).join(" · "),
    address,
    city,
    postalCode,
    countryCode: anchor.countryCode,
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    precision: "city",
    approximate: true,
    near,
  };
}

// deno-lint-ignore no-explicit-any
type Json = any;
const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, 200) : "");
const point = (f: Json): Coordinates | null => {
  const c = f?.geometry?.type === "Point" ? f.geometry.coordinates : null;
  const p = Array.isArray(c) ? { latitude: c[1], longitude: c[0] } : null;
  return isCoordinates(p) ? p : null;
};

/** Parses a Photon response into address suggestions (duplicates and invalid coordinates removed, at most 12). */
export function parsePhotonAddresses(json: unknown): AddressSuggestion[] {
  const features = (json as Json)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  return features.flatMap((f: Json): AddressSuggestion[] => {
    const p = f?.properties;
    const position = point(f);
    if (!p || !position) return [];
    const house = str(p.housenumber);
    const street = str(p.street) || (house ? str(p.name) : "");
    const address = [street, house].filter(Boolean).join(" ");
    const city = str(p.city) || str(p.town) || str(p.village) || str(p.locality) || str(p.district) || str(p.name);
    const postalCode = str(p.postcode);
    const countryCode = str(p.countrycode).toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode) || (!city && !address)) return [];
    const label = [address || str(p.name), [postalCode, city].filter(Boolean).join(" "), countryCode].filter(Boolean).join(" · ");
    const key = `${label}:${position.longitude},${position.latitude}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label, address, city, postalCode, countryCode, ...position, precision: house && street ? "address" : "city" }];
  }).slice(0, 12);
}

/** Parses a Photon response into named places (points of interest, villages, cities). */
export function parsePhotonPlaces(json: unknown): Place[] {
  const features = (json as Json)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f: Json): Place[] => {
    const p = f?.properties ?? {};
    const position = point(f);
    const countryCode = str(p.countrycode).toUpperCase();
    if (typeof p.name !== "string" || !/^[A-Z]{2}$/.test(countryCode) || !position) return [];
    const region = [p.city, p.state].filter((v: unknown) => typeof v === "string" && v !== p.name).join(" · ");
    return [{ name: p.name, region, countryCode, ...position, source: "OpenStreetMap / Photon" }];
  });
}

/** Parses an Open-Meteo geocoding response into places. */
export function parseOpenMeteoPlaces(json: unknown): Place[] {
  const results = (json as Json)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((r: Json): Place[] => {
    const position = { latitude: r?.latitude, longitude: r?.longitude };
    if (typeof r?.name !== "string" || !/^[A-Z]{2}$/.test(r.country_code) || !isCoordinates(position)) return [];
    return [{ name: r.name, region: typeof r.admin1 === "string" ? r.admin1 : "", countryCode: r.country_code, ...position, source: "Open-Meteo / GeoNames" }];
  });
}
