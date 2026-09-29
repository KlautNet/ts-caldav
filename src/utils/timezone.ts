import ICAL from "ical.js";

/**
 * Time-zone conversion between JS `Date` instants and iCalendar wall-clock
 * times, backed by the runtime's `Intl` zone data. ical.js resolves a `TZID`
 * only through a `VTIMEZONE` component embedded in the same resource and ships
 * no zone database, so everything written or read with a bare IANA name goes
 * through here.
 */

const formatters = new Map<string, Intl.DateTimeFormat | null>();

const formatterFor = (tzid: string): Intl.DateTimeFormat | null => {
  const cached = formatters.get(tzid);
  if (cached !== undefined) return cached;

  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // Not an IANA name the runtime knows (e.g. a Windows zone name).
    formatter = null;
  }
  formatters.set(tzid, formatter);
  return formatter;
};

/** Whether the runtime can resolve `tzid` (IANA names such as `Europe/Vienna`). */
export const isKnownTimeZone = (tzid: string): boolean =>
  formatterFor(tzid) !== null;

/**
 * The wall-clock fields of `date` in `tzid`, expressed as the UTC epoch
 * millisecond of those same fields. Comparing it with `date` itself yields
 * the zone's offset at that instant.
 */
const wallClockMs = (formatter: Intl.DateTimeFormat, date: Date): number => {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
};

/**
 * Converts an instant to the floating wall-clock time it has in `tzid`,
 * suitable for writing as a DATE-TIME with a `TZID` parameter. `undefined`
 * when the zone is unknown, in which case the caller should write UTC
 * without a `TZID`.
 */
export const toZonedTime = (date: Date, tzid: string): ICAL.Time | undefined => {
  const formatter = formatterFor(tzid);
  if (!formatter) return undefined;

  const wall = new Date(wallClockMs(formatter, date));
  return ICAL.Time.fromData({
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
    isDate: false,
  });
};

/**
 * Converts a floating wall-clock time that is meant to be read in `tzid` to
 * the instant it denotes. `undefined` when the zone is unknown.
 */
export const fromZonedTime = (
  time: ICAL.Time,
  tzid: string,
): Date | undefined => {
  const formatter = formatterFor(tzid);
  if (!formatter) return undefined;

  const wall = Date.UTC(
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second,
  );

  // Two passes: the first guesses the offset at the wall-clock reading taken
  // as UTC, the second corrects it with the offset actually in force at the
  // resulting instant, which differs around a DST transition.
  let instant = wall - (wallClockMs(formatter, new Date(wall)) - wall);
  instant -= wallClockMs(formatter, new Date(instant)) - wall;
  return new Date(instant);
};

/**
 * The instant an iCalendar time denotes. A time whose `TZID` ical.js could
 * not resolve (no matching `VTIMEZONE` in the resource) parses as floating;
 * it is interpreted in `tzid` here rather than in the process's local zone.
 */
export const resolveTime = (time: ICAL.Time, tzid?: string): Date => {
  if (tzid && !time.isDate && time.zone === ICAL.Timezone.localTimezone) {
    const resolved = fromZonedTime(time, tzid);
    if (resolved) return resolved;
  }
  return time.toJSDate();
};

/**
 * Like `resolveTime`, but reads the `TZID` from the property the time was
 * parsed from.
 */
export const resolvePropertyTime = (
  time: ICAL.Time,
  prop?: ICAL.Property | null,
): Date => {
  const tzid = prop?.getParameter("tzid");
  return resolveTime(time, Array.isArray(tzid) ? tzid[0] : tzid);
};
