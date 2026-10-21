/**
 * Public warnings and crisis information: parsing and relevance. Everything here is pure.
 *
 *  - **Krisinformation.se** publishes VMA (Important Public Announcements) and news from Swedish authorities.
 *    Areas are given as the country, a county or a municipality, sometimes with a point.
 *  - **SMHI** publishes impact-based weather warnings, each with a polygon.
 *
 * An alert is relevant to a place when it is national or touches the place (polygon, county, municipality or
 * within 40 km of a given point). Both formats are read defensively: unknown or missing fields skip the entry,
 * they never break the whole feed.
 *
 * @module
 */
import { type Coordinates, type Polygon, distanceKm, fold, inPolygon } from "../core/geo.ts";
import { list, record, text as parseText } from "../core/parse.ts";
import { type Region, neighboringCounties, regionKey } from "../geo/regions.ts";
import type { Locale } from "../core/context.ts";

/** VMA, a weather warning, or news from an authority. */
export type AlertKind = "vma" | "warning" | "news";
/** Severity. VMA are always `"red"`; news have no level. */
export type AlertLevel = "red" | "orange" | "yellow" | "message";

/** An area an alert applies to, as named by the source. */
export interface AlertArea {
  type: "country" | "county" | "municipality" | "other";
  name: string;
  point?: Coordinates;
}

/** An alert as parsed from a source. */
export interface Alert {
  /** Stable id, prefixed with the source: `"kris:…"` or `"smhi:…"`. */
  id: string;
  source: "Krisinformation" | "SMHI";
  kind: AlertKind;
  level?: AlertLevel;
  title: string;
  /** Plain text. Krisinformation preambles are stripped of HTML and capped at 600 characters; SMHI texts are kept whole. */
  summary: string;
  /** Always an `https://` link. */
  url: string;
  /** ISO 8601. */
  published: string;
  start?: string;
  end?: string;
  areas: AlertArea[];
  /** SMHI warning areas. */
  polygons?: Polygon[];
}

/** An alert that concerns at least one of the given places. */
export interface RelevantAlert extends Omit<Alert, "polygons" | "areas"> {
  /** Area names. */
  areas: string[];
  /** `true` for alerts that apply to all of Sweden. */
  national: boolean;
  /** Indexes into the places that were passed in. */
  places: number[];
}

/** The first of `keys` that `value` has (also in another letter case), or `undefined`. */
const pick = (value: unknown, ...keys: string[]): unknown => {
  const o = record(value);
  for (const k of keys) {
    if (o[k] != null) return o[k];
    const hit = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
    if (hit && o[hit] != null) return o[hit];
  }
  return undefined;
};
/** Text from a plain string or a `{ sv: "…" }` translation object; `""` when there is none. */
const text = (v: unknown, max = 2000): string =>
  parseText(v && typeof v === "object" ? (v as { sv?: unknown }).sv : v, max) ?? "";
const iso = (v: unknown): string => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};
const stripHtml = (s: string): string =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Reads a point from the many shapes sources use: `"56.1,14.0"`, `"14.0 56.1"`, `"POINT (14.0 56.1)"` or
 * `{ lat, lon }`. When the order is ambiguous, the value in Sweden's latitude range is taken as latitude.
 */
export function parsePoint(value: unknown): Coordinates | undefined {
  if (value && typeof value === "object") {
    const lat = Number(pick(value, "latitude", "lat"));
    const lon = Number(pick(value, "longitude", "lon", "lng"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { latitude: lat, longitude: lon };
  }
  const nums = String(value ?? "")
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map(Number);
  if (!nums || nums.length < 2) return undefined;
  const [a, b] = nums;
  if (Math.abs(a) > 90 && Math.abs(b) > 90) return undefined;
  const latFirst = a >= 50 && a <= 72 && !(b >= 50 && b <= 72);
  return latFirst ? { latitude: a, longitude: b } : { latitude: b, longitude: a };
}

function krisArea(a: unknown): AlertArea | null {
  const name = text(pick(a, "Description", "Name"), 120);
  if (!name) return null;
  const t = fold(String(pick(a, "Type") ?? ""));
  const n = fold(name);
  const type: AlertArea["type"] =
    t.includes("country") || /^(sverige|hela (sverige|landet))$/.test(n)
      ? "country"
      : t.includes("county") || /\blan$/.test(n)
        ? "county"
        : t.includes("municipality") || /kommun$/.test(n)
          ? "municipality"
          : "other";
  const point = parsePoint(pick(a, "Coordinate", "Coordinates"));
  return {
    type,
    name,
    ...(point && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 ? { point } : {}),
  };
}

/**
 * Parses Krisinformation.se API v3 (`/news` or `/vmas`). Accepts a list or an object with
 * `items`/`Entries`/`data`. Links that are not `https://` are replaced by the site's front page.
 */
export function parseKrisinformation(json: unknown, feed: "news" | "vma"): Alert[] {
  const entries = Array.isArray(json) ? json : list(pick(json, "items", "Entries", "data"));
  return entries.flatMap((x): Alert[] => {
    const id = text(pick(x, "Identifier", "Id"), 200);
    const title = text(pick(x, "Headline", "PushMessage", "Title"), 300);
    if (!id || !title) return [];
    const raw = pick(x, "Area", "Areas");
    const areas = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(krisArea).filter((a): a is AlertArea => !!a);
    const isVma = feed === "vma" || /alert|vma/.test(fold(String(pick(x, "Event") ?? "")));
    let url = text(pick(x, "Web", "Url", "Link"), 500);
    if (!/^https:\/\//.test(url)) url = "https://www.krisinformation.se";
    return [
      {
        id: "kris:" + id,
        source: "Krisinformation",
        kind: isVma ? "vma" : "news",
        ...(isVma ? { level: "red" as const } : {}),
        title,
        summary: stripHtml(text(pick(x, "Preamble", "PushMessage", "BodyText"), 1200)).slice(0, 600),
        url,
        // The publication date decides freshness. "Updated" is only a fallback: a later edit must not revive old news.
        published: iso(pick(x, "Published", "Sent")) || iso(pick(x, "Updated")),
        areas,
      },
    ];
  });
}

const LEVELS: Record<string, AlertLevel> = {
  red: "red",
  orange: "orange",
  yellow: "yellow",
  message: "message",
  rod: "red",
  gul: "yellow",
};
const LEVEL_TITLES: Record<Locale, Record<AlertLevel, string>> = {
  sv: { red: "Röd varning", orange: "Orange varning", yellow: "Gul varning", message: "Meddelande" },
  en: { red: "Red warning", orange: "Orange warning", yellow: "Yellow warning", message: "Message" },
};

/** The polygons of any GeoJSON object (feature collection, feature, polygon, multipolygon, geometry collection). */
function polygonsOf(value: unknown): Polygon[] {
  const geo = record(value);
  switch (geo.type) {
    case "FeatureCollection":
      return list(geo.features).flatMap((f) => polygonsOf(record(f).geometry));
    case "Feature":
      return polygonsOf(geo.geometry);
    case "Polygon":
      return Array.isArray(geo.coordinates) ? [geo.coordinates as Polygon] : [];
    case "MultiPolygon":
      return Array.isArray(geo.coordinates) ? (geo.coordinates as Polygon[]) : [];
    case "GeometryCollection":
      return list(geo.geometries).flatMap((g) => polygonsOf(g));
    default:
      return [];
  }
}

/** Options for {@link parseSmhiWarnings}. */
export interface SmhiOptions {
  /** Warnings that have ended before this instant are skipped. Default `Date.now()`. */
  now?: number;
  /** Language of the generated title prefix ("Gul varning" / "Yellow warning"). Default `"sv"`. */
  locale?: Locale;
}

/** Parses SMHI's impact-based warnings (`warning.json`): one alert per warning area. */
export function parseSmhiWarnings(json: unknown, options: SmhiOptions = {}): Alert[] {
  const now = options.now ?? Date.now();
  const titles = LEVEL_TITLES[options.locale ?? "sv"];
  if (!Array.isArray(json)) return [];
  return json.flatMap((w: unknown): Alert[] => {
    const event = text(pick(w, "event"), 120);
    const warningAreas = pick(w, "warningAreas");
    if (!Array.isArray(warningAreas)) return [];
    return warningAreas.flatMap((a: unknown): Alert[] => {
      const end = iso(pick(a, "approximateEnd", "end"));
      if (end && Date.parse(end) < now) return [];
      const rawLevel = pick(a, "warningLevel");
      const code = fold(String(pick(rawLevel, "code") ?? text(rawLevel) ?? ""));
      const level = LEVELS[code] ?? (code ? "message" : "yellow");
      const areaName = text(pick(a, "areaName"), 120);
      const what = text(pick(a, "eventDescription"), 120) || event;
      const id = String(pick(a, "id") ?? "");
      if (!id || !what) return [];
      const descriptions = pick(a, "descriptions");
      const affected = pick(a, "affectedAreas");
      const areas: AlertArea[] = (Array.isArray(affected) ? affected : [])
        .map((x: unknown) => text(x, 120))
        .filter(Boolean)
        .map(
          (name: string): AlertArea => ({
            type: /kommun$/.test(fold(name)) ? "municipality" : /lan$/.test(fold(name)) ? "county" : "other",
            name,
          }),
        );
      const start = iso(pick(a, "approximateStart", "start"));
      return [
        {
          id: "smhi:" + id,
          source: "SMHI",
          kind: "warning",
          level,
          title: `${titles[level]}: ${what}${areaName ? " – " + areaName : ""}`,
          // SMHI's terms: warning texts must not be altered, so they are kept in full.
          summary: Array.isArray(descriptions)
            ? descriptions
                .map((d: unknown) => text(pick(d, "text"), 4000))
                .filter(Boolean)
                .join(" ")
            : "",
          url: "https://www.smhi.se/vader/varningar-och-brandrisk/varningar-och-meddelanden/varningar",
          published: iso(pick(a, "published")) || iso(pick(w, "published")),
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
          areas,
          polygons: polygonsOf(pick(a, "area")),
        },
      ];
    });
  });
}

/** Options for matching alerts to places. */
export interface MatchOptions {
  /** Also match alerts for counties that border a place's county. Default `false`. */
  neighbors?: boolean;
  /** Distance in km within which an alert's point counts as touching a place. Default `40`. */
  radiusKm?: number;
}

/** Outline bounding boxes, computed once per polygon: `[minLon, minLat, maxLon, maxLat]`. */
const boxes = new WeakMap<Polygon, readonly [number, number, number, number]>();

/** A cheap first test: points outside the outline's bounding box are never inside the polygon. */
function insideBox(point: Coordinates, polygon: Polygon): boolean {
  let box = boxes.get(polygon);
  if (!box) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of polygon[0] ?? []) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    box = [minLon, minLat, maxLon, maxLat];
    boxes.set(polygon, box);
  }
  return point.longitude >= box[0] && point.latitude >= box[1] && point.longitude <= box[2] && point.latitude <= box[3];
}

/** Which of `places` an alert concerns, and whether it is national. */
export function alertPlaces(
  alert: Alert,
  places: Region[],
  options: MatchOptions = {},
): { national: boolean; places: number[] } {
  const national = alert.areas.some((a) => a.type === "country");
  if (national) return { national, places: places.map((_, i) => i) };
  const radius = options.radiusKm ?? 40;
  const same = (a: string, b: string | undefined): boolean => !!b && regionKey(a) === regionKey(b);
  const hits = places.flatMap((p, i) => {
    if (alert.polygons?.some((poly) => insideBox(p, poly) && inPolygon(p, poly))) return [i];
    for (const a of alert.areas) {
      if (a.type === "county" && same(a.name, p.county)) return [i];
      if (
        options.neighbors &&
        a.type === "county" &&
        p.county &&
        neighboringCounties(p.county).some((c) => same(c, a.name))
      )
        return [i];
      if (a.type === "municipality" && same(a.name, p.municipality)) return [i];
      if (a.type === "other" && (same(a.name, p.municipality) || same(a.name, p.county))) return [i];
      if (a.point && a.type !== "county" && distanceKm(p, a.point) <= radius) return [i];
    }
    return [];
  });
  return { national, places: hits };
}

/** Options for {@link relevantAlerts}. */
export interface RelevanceOptions extends MatchOptions {
  /** Reference time. Default `Date.now()`. */
  now?: number;
  /** Drop alerts published more than this many days ago (1–30). Default `7`. */
  days?: number;
  /** Only these kinds, for example `["vma", "warning"]`. Default: all. */
  kinds?: AlertKind[];
  /**
   * Only alerts at least this severe, for example `"orange"` for orange and red warnings. Applies to alerts that have
   * a level (VMA are always `"red"`); news have no level and are kept – use {@link RelevanceOptions.kinds} to drop them.
   */
  minLevel?: AlertLevel;
}

const KIND_ORDER: Record<AlertKind, number> = { vma: 0, warning: 1, news: 2 };
const LEVEL_ORDER: Record<AlertLevel, number> = { red: 0, orange: 1, yellow: 2, message: 3 };
const clampDays = (days: number | undefined): number =>
  Math.max(1, Math.min(30, Number.isFinite(days) ? (days as number) : 7));

/**
 * Keeps the alerts that concern at least one place and are still current, removes duplicates and sorts them:
 * VMA first, then warnings by severity, then newest first.
 */
export function relevantAlerts(alerts: Alert[], places: Region[], options: RelevanceOptions = {}): RelevantAlert[] {
  const now = options.now ?? Date.now();
  const maxAge = clampDays(options.days) * 86_400_000;
  const seen = new Set<string>();
  return alerts
    .flatMap((alert): RelevantAlert[] => {
      if (seen.has(alert.id)) return [];
      seen.add(alert.id);
      const stamp = Date.parse(alert.published || alert.start || "");
      if (!Number.isFinite(stamp) || now - stamp > maxAge) return [];
      if (alert.end && Date.parse(alert.end) < now) return [];
      if (alert.kind === "warning" && alert.level === "message" && !alert.polygons?.length && !alert.areas.length)
        return [];
      if (options.kinds && !options.kinds.includes(alert.kind)) return [];
      if (options.minLevel && alert.level && LEVEL_ORDER[alert.level] > LEVEL_ORDER[options.minLevel]) return [];
      const match = alertPlaces(alert, places, options);
      if (!match.places.length) return [];
      const { polygons: _polygons, areas, ...rest } = alert;
      return [{ ...rest, areas: areas.map((a) => a.name), national: match.national, places: match.places }];
    })
    .map((alert) => ({ alert, published: Date.parse(alert.published || "0") }))
    .sort(
      (a, b) =>
        KIND_ORDER[a.alert.kind] - KIND_ORDER[b.alert.kind] ||
        LEVEL_ORDER[a.alert.level ?? "message"] - LEVEL_ORDER[b.alert.level ?? "message"] ||
        b.published - a.published,
    )
    .map((x) => x.alert);
}

/**
 * Drops alerts that are too old or have ended – also for data from a cache or an older server, so stale alerts
 * can never resurface. Upcoming warnings without a publication date stay.
 */
export function freshAlerts<T extends { published?: string; start?: string; end?: string }>(
  alerts: T[],
  options: { days?: number; now?: number } = {},
): T[] {
  const now = options.now ?? Date.now();
  const days = clampDays(options.days);
  const cutoff = now - days * 86_400_000;
  return alerts.filter((a) => {
    const stamp = Date.parse(a.published || a.start || "");
    const horizon = now + (a.published ? 1 : days) * 86_400_000;
    return Number.isFinite(stamp) && stamp >= cutoff && stamp <= horizon && (!a.end || Date.parse(a.end) >= now);
  });
}
