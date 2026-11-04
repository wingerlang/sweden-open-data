/**
 * Geocoding client: Swedish addresses (including rural addresses missing from map data), place names and
 * points of interest worldwide, and county/municipality for a position.
 *
 * Data: [Photon](https://photon.komoot.io) (OpenStreetMap, ODbL) and
 * [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) (GeoNames, CC BY 4.0).
 *
 * @module
 */
import { createContext } from "../core/context.js";
import { assertCoordinates, distanceKm, fold, roundCoordinates } from "../core/geo.js";
import { SourceError } from "../core/errors.js";
import { list, record, text } from "../core/parse.js";
import {
  approximateAddress,
  matchesAddressQuery,
  parseAddressQuery,
  parseOpenMeteoPlaces,
  parsePhotonAddresses,
  parsePhotonPlaces,
} from "./address.js";
import { nearestCounty } from "./regions.js";
function checkQuery(query, max) {
  const q = typeof query === "string" ? query.replace(/\s+/g, " ").trim() : "";
  if (q.length < 2 || q.length > max || /[\u0000-\u001f]/.test(q)) {
    throw new RangeError(`query must be 2–${max} characters without control characters`);
  }
  return q;
}
function checkCountry(country, fallback) {
  const c = country === undefined ? fallback : country;
  if (c === null || c === "") return null;
  const upper = c.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) throw new RangeError(`country must be an ISO 3166-1 alpha-2 code: ${c}`);
  return upper;
}
function checkLimit(limit) {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError("limit must be an integer 1–20");
  return limit;
}
const uniqueByLabel = (list) => [...new Map(list.map((p) => [p.label, p])).values()];
/**
 * Creates a {@link GeoClient}.
 *
 * @example
 * ```ts
 * const geo = createGeoClient();
 * const [best] = await geo.addresses("Åraslöv 1105, 28890 Vinslöv");
 * const region = await geo.region(best); // { county: "Skåne län", municipality: "Hässleholms kommun", … }
 * ```
 */
export function createGeoClient(options = {}) {
  const ctx = createContext(options);
  // Some Photon deployments reject the countrycode filter; then we filter ourselves for an hour and try again. The
  // filter is only switched off when the same request without it succeeds, so an unrelated 400 changes nothing.
  let countryFilterOffUntil = -Infinity;
  async function photon(term, country, extra = {}) {
    const build = (withCountry) => {
      const url = new URL(ctx.endpoints.photon);
      url.searchParams.set("q", term);
      url.searchParams.set("limit", country ? "15" : "8");
      url.searchParams.set("lang", "en");
      if (country && withCountry) url.searchParams.set("countrycode", country);
      if (extra.near) {
        url.searchParams.set("lat", extra.near.latitude.toFixed(3));
        url.searchParams.set("lon", extra.near.longitude.toFixed(3));
      }
      if (extra.localities)
        for (const layer of ["city", "district", "locality"]) url.searchParams.append("layer", layer);
      return url;
    };
    const useFilter = ctx.now() >= countryFilterOffUntil;
    try {
      return await ctx.http.json("photon", build(useFilter), { signal: extra.signal });
    } catch (error) {
      if (!(error instanceof SourceError && error.status === 400 && useFilter && country)) throw error;
      const unfiltered = await ctx.http.json("photon", build(false), { signal: extra.signal });
      countryFilterOffUntil = ctx.now() + 3_600_000;
      return unfiltered;
    }
  }
  async function searchAddresses(q, country, signal) {
    const raw = async (term, extra = {}) =>
      parsePhotonAddresses(await photon(term, country, { ...extra, signal })).filter(
        (p) => !country || p.countryCode === country,
      );
    let lastError;
    const safe = (p) =>
      p.catch((error) => {
        if (signal?.aborted) throw error;
        lastError = error;
        return null;
      });
    const parsed = parseAddressQuery(q);
    // 1. The exact address: the query as typed and at most one rewritten form (address + town, else + postal code).
    const rewritten =
      parsed.address && parsed.city
        ? `${parsed.address} ${parsed.city}`
        : parsed.address && parsed.postalCode
          ? `${parsed.address} ${parsed.postalCode}`
          : "";
    const variants = [...new Set([q, rewritten].filter(Boolean))];
    const first = await Promise.all(variants.map((v) => safe(raw(v))));
    // Every variant failed: report the source error rather than "no results".
    if (first.every((r) => r === null)) throw lastError;
    const firstAll = first.flatMap((r) => r ?? []);
    const exact = uniqueByLabel(firstAll.filter((p) => p.precision === "address" && matchesAddressQuery(p, q)));
    if (exact.length) return exact;
    // 2. The town (or the postal code) as an anchor, and a village/street with the queried name near it. The town is
    // only looked up when the first answers do not already contain it.
    const isTown = (p) =>
      !p.address && fold(p.city) === fold(parsed.city) && fold(p.label.split(" · ")[0]) === fold(parsed.city);
    const knownTown = firstAll.filter(isTown);
    const townHits =
      parsed.city.length < 2
        ? []
        : knownTown.length
          ? knownTown
          : ((await safe(raw(parsed.city, { localities: true }))) ?? []);
    const postHits =
      !townHits.length && parsed.postalCode
        ? ((await safe(raw(parsed.postalCode))) ?? []).filter(
            (p) => p.postalCode.replace(/\s/g, "") === parsed.postalCode.replace(/\s/g, ""),
          )
        : [];
    const town = townHits.find((p) => fold(p.city) === fold(parsed.city)) ?? townHits[0] ?? postHits[0];
    const streetName =
      parsed.street ||
      q
        .replace(/\b\d+[a-z]?\b/gi, "")
        .replace(/[,\s]+/g, " ")
        .trim();
    const sameName = (p) => fold((p.address || p.label.split(" · ")[0]).replace(/\s\d.*$/, "")) === fold(streetName);
    const streetHits =
      streetName.length >= 3 ? ((await safe(raw(streetName, { localities: true, near: town }))) ?? []) : [];
    const nearTown = (p) => !town || distanceKm(p, town) <= 25;
    const village = [...streetHits, ...firstAll].find((p) => sameName(p) && nearTown(p));
    const anchor = village ?? town;
    // 3. The address as typed, positioned at the village or town, followed by those localities.
    const typed = anchor ? approximateAddress(q, anchor) : null;
    const localities = [
      village,
      town,
      ...streetHits.filter((p) => p.precision === "city" && sameName(p) && nearTown(p)),
    ].filter((p) => !!p && !p.address);
    const list = [...(typed ? [typed] : []), ...uniqueByLabel(localities)];
    if (list.length) return list.slice(0, 8);
    // Nothing nearby: only localities whose name really matches – never a different street.
    return uniqueByLabel(
      firstAll.filter((p) => p.precision === "city" && !p.address && matchesAddressQuery(p, streetName)),
    ).slice(0, 8);
  }
  return {
    async addresses(query, options = {}) {
      const q = checkQuery(query, 200);
      const country = checkCountry(options.country, "SE");
      const limit = checkLimit(options.limit);
      const all = await ctx.cache.get(
        `address:${country ?? ""}:${q.toLocaleLowerCase("sv")}`,
        ctx.ttl.search,
        (signal) => searchAddresses(q, country, signal),
        { signal: options.signal, source: "photon" },
      );
      return all.slice(0, limit);
    },
    async places(query, options = {}) {
      const q = checkQuery(query, 200);
      const country = checkCountry(options.country, null);
      const poi = !!options.pointsOfInterest;
      const limit = checkLimit(options.limit);
      const found = await ctx.cache.get(
        `places:${country ?? ""}:${poi ? 1 : 0}:${q.toLocaleLowerCase("sv")}`,
        ctx.ttl.search,
        async (signal) => {
          const url = new URL(ctx.endpoints.geocoding);
          url.searchParams.set("name", q);
          url.searchParams.set("language", "sv");
          url.searchParams.set("count", "8");
          if (country) url.searchParams.set("countryCode", country);
          let results = parseOpenMeteoPlaces(await ctx.http.json("open-meteo-geocoding", url, { signal })).slice(0, 8);
          if (!results.length || poi) {
            try {
              const more = parsePhotonPlaces(await photon(q, country, { signal })).filter(
                (p) => !country || p.countryCode === country,
              );
              results = [
                ...new Map(
                  [...results, ...more].map((p) => [`${p.name}:${p.countryCode}:${p.latitude.toFixed(2)}`, p]),
                ).values(),
              ].slice(0, 12);
            } catch (error) {
              // Points of interest are a bonus: cities from the first source are still a good answer.
              if (signal.aborted) throw error;
            }
          }
          return results;
        },
        { signal: options.signal, source: "open-meteo-geocoding" },
      );
      return found.slice(0, limit);
    },
    async region(position, options = {}) {
      assertCoordinates(position, "position");
      const p = roundCoordinates(position, ctx.precision);
      return ctx.cache.get(
        `region:${p.latitude},${p.longitude}`,
        (r) => (r.guessed ? Math.min(ctx.ttl.region, 15 * 60_000) : ctx.ttl.region),
        async (signal) => {
          const fallback = { ...p, county: nearestCounty(p), guessed: true };
          try {
            const url = new URL(ctx.endpoints.photonReverse);
            url.searchParams.set("lat", String(p.latitude));
            url.searchParams.set("lon", String(p.longitude));
            const json = await ctx.http.json("photon", url, { signal });
            const props = record(record(list(record(json).features)[0]).properties);
            const locality = [props.city, props.town, props.village, props.district].map((v) => text(v)).find(Boolean);
            const county = [props.state, props.county].map((v) => text(v)).find((x) => x && /län$/i.test(x));
            const municipality = [props.county, props.city, props.district]
              .map((v) => text(v))
              .find((x) => x && /kommun$/i.test(x));
            if (!county) return { ...fallback, ...(municipality ? { municipality } : {}) };
            return { ...p, county, ...(municipality ? { municipality } : {}), ...(locality ? { locality } : {}) };
          } catch (error) {
            if (signal.aborted) throw error;
            return fallback;
          }
        },
        { signal: options.signal, source: "photon" },
      );
    },
  };
}
