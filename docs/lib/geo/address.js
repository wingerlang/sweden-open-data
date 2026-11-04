/**
 * Address and place parsing for Photon (OpenStreetMap) and Open-Meteo geocoding responses, and Swedish address
 * queries. Everything here is pure.
 *
 * @module
 */
import { fold, isCoordinates } from "../core/geo.js";
import { list, record, text } from "../core/parse.js";
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
export function parseAddressQuery(query) {
  const t = query.replace(/\s+/g, " ").trim();
  const pc = t.match(/\b(\d{3}) ?(\d{2})\b/);
  // A five-digit number that ends the query with no comma is a house number ("Storgatan 12345"), not a postcode.
  const pcIsHouse = !!pc && !t.includes(",") && !t.slice((pc.index ?? 0) + pc[0].length).trim();
  const postal = pc && !pcIsHouse ? pc : null;
  const postalCode = postal ? postal[1] + " " + postal[2] : "";
  const before = postal ? t.slice(0, postal.index).trim() : t;
  const after = postal ? t.slice((postal.index ?? 0) + postal[0].length).trim() : "";
  const [first = "", ...rest] = before
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
export function matchesAddressQuery(result, query) {
  const head = query.split(",")[0];
  const house = head.match(/\b\d+[a-z]?(?:-\d+)?\b/i)?.[0];
  const words = fold(head.split(/\b\d/)[0]).match(/[a-z]{2,}/g) ?? [];
  const tokens = new Set(fold(result.address || result.label).match(/[a-z0-9-]+/g) ?? []);
  if (!words.every((w) => tokens.has(w))) return false;
  return !house || (result.precision === "city" && !result.address) || tokens.has(fold(house));
}
const capitalize = (s) => s.replace(/(^|[\s-])(\p{Ll})/gu, (_, a, b) => a + b.toUpperCase());
/**
 * A suggestion with the address exactly as typed, positioned at a village or town that was found. Used when the
 * address itself is missing from the map data (common for rural addresses). Returns `null` without a street and
 * house number.
 */
export function approximateAddress(query, anchor) {
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
const str = (v) => text(v, 200) ?? "";
const point = (feature) => {
  const geometry = record(record(feature).geometry);
  const c = geometry.type === "Point" ? geometry.coordinates : null;
  const p = Array.isArray(c) ? { latitude: c[1], longitude: c[0] } : null;
  return isCoordinates(p) ? p : null;
};
/** Parses a Photon response into address suggestions (duplicates and invalid coordinates removed, at most 12). */
export function parsePhotonAddresses(json) {
  const seen = new Set();
  return list(record(json).features)
    .flatMap((f) => {
      const p = record(record(f).properties);
      const position = point(f);
      if (!position) return [];
      const house = str(p.housenumber);
      const street = str(p.street) || (house ? str(p.name) : "");
      const address = [street, house].filter(Boolean).join(" ");
      const city = str(p.city) || str(p.town) || str(p.village) || str(p.locality) || str(p.district) || str(p.name);
      const postalCode = str(p.postcode);
      const countryCode = str(p.countrycode).toUpperCase();
      if (!/^[A-Z]{2}$/.test(countryCode) || (!city && !address)) return [];
      const label = [address || str(p.name), [postalCode, city].filter(Boolean).join(" "), countryCode]
        .filter(Boolean)
        .join(" · ");
      const key = `${label}:${position.longitude},${position.latitude}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        { label, address, city, postalCode, countryCode, ...position, precision: house && street ? "address" : "city" },
      ];
    })
    .slice(0, 12);
}
/** Parses a Photon response into named places (points of interest, villages, cities). */
export function parsePhotonPlaces(json) {
  return list(record(json).features).flatMap((f) => {
    const p = record(record(f).properties);
    const position = point(f);
    const countryCode = str(p.countrycode).toUpperCase();
    const name = p.name;
    if (typeof name !== "string" || !/^[A-Z]{2}$/.test(countryCode) || !position) return [];
    const region = [p.city, p.state].filter((v) => typeof v === "string" && v !== name).join(" · ");
    return [{ name, region, countryCode, ...position, source: "OpenStreetMap / Photon" }];
  });
}
/** Parses an Open-Meteo geocoding response into places. */
export function parseOpenMeteoPlaces(json) {
  return list(record(json).results).flatMap((item) => {
    const r = record(item);
    const position = { latitude: r.latitude, longitude: r.longitude };
    const name = r.name;
    const countryCode = r.country_code;
    if (typeof name !== "string" || typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode)) return [];
    if (!isCoordinates(position)) return [];
    return [
      {
        name,
        region: typeof r.admin1 === "string" ? r.admin1 : "",
        countryCode,
        ...position,
        source: "Open-Meteo / GeoNames",
      },
    ];
  });
}
