/**
 * Swedish calendar time. Sources publish per Swedish day, so "today" means today in Europe/Stockholm whatever
 * time zone the code runs in. Daylight-saving days have 23 or 25 hours; these helpers handle that.
 *
 * @module
 */

/** The time zone all Swedish sources use. */
export const TIME_ZONE = "Europe/Stockholm";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const dateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const clock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Local Swedish wall time for an instant, as `YYYY-MM-DDTHH:MM:SS`. */
export function stockholmDateTime(time: number | string | Date): string {
  return dateTime.format(new Date(time)).replace(" ", "T");
}

/**
 * The Swedish calendar date (`YYYY-MM-DD`) of an instant, optionally shifted by whole days.
 *
 * @example
 * ```ts
 * swedishDate(Date.parse("2026-10-12T22:30:00Z")); // "2026-10-13" – already tomorrow in Sweden
 * swedishDate(Date.now(), 1);                      // tomorrow
 * ```
 */
export function swedishDate(time: number | string | Date = Date.now(), offsetDays = 0): string {
  const date = stockholmDateTime(time).slice(0, 10);
  return offsetDays ? addDays(date, offsetDays) : date;
}

/** `true` for a real calendar date written as `YYYY-MM-DD` (so `2026-02-30` is rejected). */
export function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function assertDate(date: string): void {
  if (!isCalendarDate(date)) throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${String(date)}`);
}

/** Adds (or with a negative number subtracts) whole calendar days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  assertDate(date);
  return new Date(Date.parse(date + "T12:00:00Z") + Math.trunc(days) * DAY).toISOString().slice(0, 10);
}

/** The instant (ms since the epoch) when a Swedish calendar day starts. */
export function stockholmMidnight(date: string): number {
  assertDate(date);
  const wall = Date.parse(date + "T00:00:00Z");
  // Sweden is UTC+1 in winter and UTC+2 in summer; midnight is never inside a DST transition.
  for (const offset of [1, 2]) {
    const candidate = wall - offset * HOUR;
    if (stockholmDateTime(candidate) === date + "T00:00:00") return candidate;
  }
  /* node:coverage ignore next */
  throw new RangeError(`Could not resolve midnight in ${TIME_ZONE} for ${date}`);
}

/** Length of a Swedish calendar day in hours: 24, or 23/25 on daylight-saving changes. */
export function hoursInDay(date: string): number {
  return (stockholmMidnight(addDays(date, 1)) - stockholmMidnight(date)) / HOUR;
}

/** Swedish clock time `HH:MM` for an instant. */
export function stockholmClock(time: number | string | Date): string {
  return clock.format(new Date(time));
}
