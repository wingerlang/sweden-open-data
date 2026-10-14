/**
 * Geocoding: Swedish addresses (including rural addresses missing from map data), place names, points of
 * interest, and county/municipality for a position.
 *
 * ```ts
 * import { createGeoClient } from "@wingerlang/sweden-open-data/geo";
 *
 * const geo = createGeoClient();
 * const [address] = await geo.addresses("Åraslöv 1105, 28890 Vinslöv");
 * const { county, municipality } = await geo.region(address);
 * ```
 *
 * @module
 */
export * from "./address.ts";
export * from "./regions.ts";
export * from "./client.ts";
