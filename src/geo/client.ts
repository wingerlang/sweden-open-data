/**
 * Geocoding client: Swedish addresses (including rural addresses missing from map data), place names and
 * points of interest worldwide, and county/municipality for a position.
 *
 * Data: [Photon](https://photon.komoot.io) (OpenStreetMap, ODbL) and
 * [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) (GeoNames, CC BY 4.0).
 *
 * @module
 */
import { type ClientOptions, type Context, createContext } from "../core/context.ts";
import { type Coordinates, assertCoordinates, distanceKm, fold, roundCoordinates } from "../core/geo.ts";
import { SourceError } from "../core/errors.ts";
import {
  type AddressSuggestion,
  type Place,
  approximateAddress,
  matchesAddressQuery,
  parseAddressQuery,
  parseOpenMeteoPlaces,
  parsePhotonAddresses,
  parsePhotonPlaces,
} from "./address.ts";
import { type Region, nearestCounty } from "./regions.ts";

/** Options for {@link GeoClient.addresses}. */
export interface AddressSearchOptions {
  /** ISO 3166-1 alpha-2 country, or `null` for anywhere. Default `"SE"`. */
  country?: string | null;
  signal?: AbortSignal;
}

/** Options for {@link GeoClient.places}. */
export interface PlaceSearchOptions {
  /** ISO 3166-1 alpha-2 country. Default: anywhere. */
  country?: string | null;
  /** Also search points of interest (parks, nature reserves, venues …), not only cities. Default `false`. */
  pointsOfInterest?: boolean;
  signal?: AbortSignal;
}

/** Geocoding. */
export interface GeoClient {
  /**
   * Finds addresses. When the exact address is not in the map data – common for rural Swedish addresses such as
   * "Åraslöv 1105" – the first suggestion is the address as typed, positioned at the village or town
   * (`approximate: true`). A different house number or a similarly named street is never returned as the address.
   */
  addresses(query: string, options?: AddressSearchOptions): Promise<AddressSuggestion[]>;
  /** Finds cities and villages (and optionally points of interest) by name. */
  places(query: string, options?: PlaceSearchOptions): Promise<Place[]>;
  /**
   * County, municipality and locality for a position. Falls back to the county with the nearest centre
   * (`guessed: true`) when reverse geocoding is unavailable – this method never throws for a valid position.
   */
  region(position: Coordinates, options?: { signal?: AbortSignal }): Promise<Region>;
}

function checkQuery(query: unknown, max: number): string {
  const q = typeof query === "string" ? query.replace(/\s+/g, " ").trim() : "";
  if (q.length < 2 || q.length > max || /[\u0000-\u001f]/.test(q)) {
    throw new RangeError(`query must be 2–${max} characters without control characters`);
  }
  return q;
}

function checkCountry(country: string | null | undefined, fallback: string | null): string | null {
  const c = country === undefined ? fallback : country;
  if (c === null || c === "") return null;
  const upper = c.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) throw new RangeError(`country must be an ISO 3166-1 alpha-2 code: ${c}`);
  return upper;
}

const uniqueByLabel = (list: AddressSuggestion[]): AddressSuggestion[] => [...new Map(list.map((p) => [p.label, p])).values()];
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

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
export function createGeoClient(options: ClientOptions | Context = {}): GeoClient {
  const ctx = createContext(options);
  // Some Photon deployments reject the countrycode filter; then we filter ourselves.
  let countryFilter = true;

  async function photon(
    term: string,
    country: string | null,
    extra: { localities?: boolean; near?: Coordinates; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const build = (withCountry: boolean): URL => {
      const url = new URL(ctx.endpoints.photon);
      url.searchParams.set("q", term);
      url.searchParams.set("limit", country ? "15" : "8");
      url.searchParams.set("lang", "en");
      if (country && withCountry) url.searchParams.set("countrycode", country);
      if (extra.near) {
        url.searchParams.set("lat", extra.near.latitude.toFixed(3));
        url.searchParams.set("lon", extra.near.longitude.toFixed(3));
      }
      if (extra.localities) for (const layer of ["city", "district", "locality"]) url.searchParams.append("layer", layer);
      return url;
    };
    try {
      return await ctx.http.json("photon", build(countryFilter), { signal: extra.signal });
    } catch (error) {
      if (!(error instanceof SourceError && error.status === 400 && countryFilter && country)) throw error;
      countryFilter = false;
      return ctx.http.json("photon", build(false), { signal: extra.signal });
    }
  }

  async function searchAddresses(q: string, country: string | null, signal?: AbortSignal): Promise<AddressSuggestion[]> {
    const raw = async (term: string, extra: { localities?: boolean; near?: Coordinates } = {}): Promise<AddressSuggestion[]> =>
      parsePhotonAddresses(await photon(term, country, { ...extra, signal })).filter((p) => !country || p.countryCode === country);
    let lastError: unknown;
    const safe = (p: Promise<AddressSuggestion[]>): Promise<AddressSuggestion[] | null> =>
      p.catch((error) => {
        if (signal?.aborted) throw error;
        lastError = error;
        return null;
      });
    const parsed = parseAddressQuery(q);

    // 1. The exact address, trying the common ways of writing the same query.
    const variants = [...new Set([
      q,
      parsed.address && parsed.city ? `${parsed.address} ${parsed.city}` : "",
      parsed.address && parsed.postalCode ? `${parsed.address} ${parsed.postalCode}` : "",
    ].filter(Boolean))];
    const first = await Promise.all(variants.map((v) => safe(raw(v))));
    // Every variant failed: report the source error rather than "no results".
    if (first.every((r) => r === null)) throw lastError;
    const firstAll = first.flatMap((r) => r ?? []);
    const exact = uniqueByLabel(firstAll.filter((p) => p.precision === "address" && matchesAddressQuery(p, q)));
    if (exact.length) return exact;

    // 2. The town (or the postal code) as an anchor, and a village/street with the queried name near it.
    const townHits = parsed.city.length >= 2 ? (await safe(raw(parsed.city, { localities: true }))) ?? [] : [];
    const postHits = !townHits.length && parsed.postalCode
      ? ((await safe(raw(parsed.postalCode))) ?? []).filter((p) => p.postalCode.replace(/\s/g, "") === parsed.postalCode.replace(/\s/g, ""))
      : [];
    const town = townHits.find((p) => fold(p.city) === fold(parsed.city)) ?? townHits[0] ?? postHits[0];
    const streetName = parsed.street || q.replace(/\b\d+[a-z]?\b/gi, "").replace(/[,\s]+/g, " ").trim();
    const sameName = (p: AddressSuggestion): boolean =>
      fold((p.address || p.label.split(" · ")[0]).replace(/\s\d.*$/, "")) === fold(streetName);
    const streetHits = streetName.length >= 3 ? (await safe(raw(streetName, { localities: true, near: town }))) ?? [] : [];
    const nearTown = (p: AddressSuggestion): boolean => !town || distanceKm(p, town) <= 25;
    const village = [...streetHits, ...firstAll].find((p) => sameName(p) && nearTown(p));
    const anchor = village ?? town;

    // 3. The address as typed, positioned at the village or town, followed by those localities.
    const typed = anchor ? approximateAddress(q, anchor) : null;
    const localities = [village, town, ...streetHits.filter((p) => p.precision === "city" && sameName(p) && nearTown(p))]
      .filter((p): p is AddressSuggestion => !!p && !p.address);
    const list = [...(typed ? [typed] : []), ...uniqueByLabel(localities)];
    if (list.length) return list.slice(0, 8);

    // Nothing nearby: only localities whose name really matches – never a different street.
    return uniqueByLabel(firstAll.filter((p) => p.precision === "city" && !p.address && matchesAddressQuery(p, streetName))).slice(0, 8);
  }

  return {
    async addresses(query, options = {}) {
      const q = checkQuery(query, 200);
      const country = checkCountry(options.country, "SE");
      return ctx.cache.get(`address:${country ?? ""}:${q.toLocaleLowerCase("sv")}`, ctx.ttl.search, () => searchAddresses(q, country, options.signal));
    },

    async places(query, options = {}) {
      const q = checkQuery(query, 200);
      const country = checkCountry(options.country, null);
      const poi = !!options.pointsOfInterest;
      return ctx.cache.get(`places:${country ?? ""}:${poi ? 1 : 0}:${q.toLocaleLowerCase("sv")}`, ctx.ttl.search, async () => {
        const url = new URL(ctx.endpoints.geocoding);
        url.searchParams.set("name", q);
        url.searchParams.set("language", "sv");
        url.searchParams.set("count", "8");
        if (country) url.searchParams.set("countryCode", country);
        let results = parseOpenMeteoPlaces(await ctx.http.json("open-meteo-geocoding", url, { signal: options.signal })).slice(0, 8);
        if (!results.length || poi) {
          try {
            const more = parsePhotonPlaces(await photon(q, country, { signal: options.signal }))
              .filter((p) => !country || p.countryCode === country);
            results = [...new Map([...results, ...more].map((p) => [`${p.name}:${p.countryCode}:${p.latitude.toFixed(2)}`, p])).values()].slice(0, 12);
          } catch (error) {
            // Points of interest are a bonus: cities from the first source are still a good answer.
            if (options.signal?.aborted) throw error;
          }
        }
        return results;
      });
    },

    async region(position, options = {}) {
      assertCoordinates(position, "position");
      const p = roundCoordinates(position, ctx.precision);
      return ctx.cache.get(`region:${p.latitude},${p.longitude}`, (r: Region) => (r.guessed ? Math.min(ctx.ttl.region, 15 * 60_000) : ctx.ttl.region), async () => {
        const fallback: Region = { ...p, county: nearestCounty(p), guessed: true };
        try {
          const url = new URL(ctx.endpoints.photonReverse);
          url.searchParams.set("lat", String(p.latitude));
          url.searchParams.set("lon", String(p.longitude));
          // deno-lint-ignore no-explicit-any
          const json: any = await ctx.http.json("photon", url, { signal: options.signal });
          const props = json?.features?.[0]?.properties ?? {};
          const locality = [props.city, props.town, props.village, props.district].map(text).find(Boolean);
          const county = [props.state, props.county].map(text).find((x) => x && /län$/i.test(x));
          const municipality = [props.county, props.city, props.district].map(text).find((x) => x && /kommun$/i.test(x));
          if (!county) return { ...fallback, ...(municipality ? { municipality } : {}) };
          return { ...p, county, ...(municipality ? { municipality } : {}), ...(locality ? { locality } : {}) };
        } catch (error) {
          if (options.signal?.aborted) throw error;
          return fallback;
        }
      });
    },
  };
}
