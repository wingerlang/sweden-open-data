/**
 * Coordinates and small geometry helpers (WGS 84, decimal degrees).
 *
 * @module
 */

/** A position in WGS 84 decimal degrees. */
export interface Coordinates {
  /** −90 … 90. */
  latitude: number;
  /** −180 … 180. */
  longitude: number;
}

/** A GeoJSON polygon: rings of `[longitude, latitude]` pairs. The first ring is the outline, the rest are holes. */
export type Polygon = number[][][];

/** `true` when `value` is an object with finite, in-range latitude and longitude. */
export function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const { latitude, longitude } = value as Record<string, unknown>;
  return typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) &&
    Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/** Throws a {@link RangeError} unless `value` are valid {@link Coordinates}. */
export function assertCoordinates(value: unknown, name = "coordinates"): asserts value is Coordinates {
  if (!isCoordinates(value)) {
    throw new RangeError(`${name} must be { latitude: −90…90, longitude: −180…180 }`);
  }
}

/** Rounds coordinates to `decimals` places (2 ≈ 1 km). Used before sending positions anywhere. */
export function roundCoordinates(point: Coordinates, decimals = 2): Coordinates {
  const f = 10 ** decimals;
  return { latitude: Math.round(point.latitude * f) / f, longitude: Math.round(point.longitude * f) / f };
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const r = Math.PI / 180;
  const x = Math.sin((b.latitude - a.latitude) * r / 2) ** 2 +
    Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin((b.longitude - a.longitude) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** `true` when the point lies inside the polygon's outline and outside all of its holes. */
export function inPolygon(point: Coordinates, polygon: Polygon): boolean {
  const inside = (ring: number[][]): boolean => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > point.latitude !== yj > point.latitude &&
        point.longitude < (xj - xi) * (point.latitude - yi) / (yj - yi || 1e-12) + xi) c = !c;
    }
    return c;
  };
  return !!polygon[0] && inside(polygon[0]) && !polygon.slice(1).some(inside);
}

/** Folds case and diacritics for comparisons: `"Åraslöv"` → `"araslov"`. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
