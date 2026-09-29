import ICAL from "ical.js";
import { CalDAVError } from "../errors";
import { HttpResponse } from "../http-client";
import {
  OccurrenceChanges,
  OccurrenceRef,
  OccurrenceResult,
  OccurrenceScope,
} from "../models";
import { normalizeSlashEnd } from "../utils/common";
import { ifMatchValue } from "../utils/etag";
import { resolvePropertyTime } from "../utils/timezone";
import { occurrenceTime } from "./ics-builders";

export type OccurrenceDeps = {
  fetchIcs: (href: string) => Promise<{ ics: string; etag: string }>;
  putIcs: (
    href: string,
    ics: string,
    headers?: Record<string, string>,
  ) => Promise<HttpResponse>;
  deleteResource: (href: string, etag?: string) => Promise<void>;
  getCtagAfterWrite: (calendarUrl: string) => Promise<string>;
  absolutize: (urlOrPath: string) => string;
  resolveHrefByUid?: (
    calendarUrl: string,
    uid: string,
  ) => Promise<string | undefined>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Loads the calendar resource holding a series. A known href is used directly;
 * otherwise `<calendar>/<uid>.ics` is tried first and, when the server named
 * the resource itself, the href is looked up by UID.
 */
const loadResource = async (
  calendarUrl: string,
  ref: OccurrenceRef,
  deps: OccurrenceDeps,
): Promise<{ href: string; ics: string; etag: string }> => {
  if (ref.href) {
    const href = deps.absolutize(ref.href);
    return { href, ...(await deps.fetchIcs(href)) };
  }

  if (!ref.uid) {
    throw new CalDAVError(
      "Either 'uid' or 'href' is required to modify an occurrence.",
    );
  }

  const guessed = deps.absolutize(
    `${normalizeSlashEnd(calendarUrl)}/${ref.uid}.ics`,
  );
  try {
    return { href: guessed, ...(await deps.fetchIcs(guessed)) };
  } catch (error) {
    if (!(error instanceof CalDAVError && error.status === 404)) throw error;
    const resolved = deps.resolveHrefByUid
      ? await deps.resolveHrefByUid(calendarUrl, ref.uid).catch(() => undefined)
      : undefined;
    if (!resolved) throw error;
    const href = deps.absolutize(resolved);
    return { href, ...(await deps.fetchIcs(href)) };
  }
};

/**
 * The instant a component's date-time property denotes, in epoch
 * milliseconds. A `TZID` the resource does not define a `VTIMEZONE` for is
 * resolved from the runtime's zone data rather than read as local time.
 */
const instantOf = (
  vevent: ICAL.Component,
  name: "dtstart" | "dtend" | "recurrence-id",
): number | undefined => {
  const prop = vevent.getFirstProperty(name);
  const value = prop?.getFirstValue();
  return value instanceof ICAL.Time
    ? resolvePropertyTime(value, prop).getTime()
    : undefined;
};

const isOverride = (vevent: ICAL.Component): boolean =>
  instantOf(vevent, "recurrence-id") !== undefined;

const isWholeDayComponent = (vevent: ICAL.Component): boolean => {
  const dtstart = vevent.getFirstProperty("dtstart")?.getFirstValue();
  return dtstart instanceof ICAL.Time ? dtstart.isDate : false;
};

/**
 * Marks a component as modified: servers and clients use DTSTAMP/SEQUENCE to
 * recognise that a component changed (RFC 5545 §3.8.7.2, §3.8.7.4).
 */
const touch = (vevent: ICAL.Component) => {
  vevent.removeAllProperties("dtstamp");
  vevent.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));

  const sequence = vevent.getFirstPropertyValue("sequence");
  const current = typeof sequence === "number" ? sequence : 0;
  vevent.removeAllProperties("sequence");
  vevent.addPropertyWithValue("sequence", current + 1);
};

/**
 * Collects EXDATE/RDATE values, normalising date-times to UTC so they can be
 * compared as instants and written back into one property regardless of the
 * `TZID` each original property carried.
 */
const collectTimes = (
  vevent: ICAL.Component,
  name: "exdate" | "rdate",
): ICAL.Time[] => {
  const times: ICAL.Time[] = [];
  for (const prop of vevent.getAllProperties(name)) {
    for (const value of prop.getValues()) {
      const time =
        value instanceof ICAL.Time
          ? value
          : value instanceof ICAL.Period
            ? value.start
            : undefined;
      if (!time) continue;
      times.push(
        time.isDate
          ? time
          : ICAL.Time.fromJSDate(resolvePropertyTime(time, prop), true),
      );
    }
  }
  return times;
};

const writeTimes = (
  vevent: ICAL.Component,
  name: "exdate" | "rdate",
  times: ICAL.Time[],
  wholeDay: boolean,
) => {
  vevent.removeAllProperties(name);
  if (!times.length) return;

  const prop = new ICAL.Property(name, vevent);
  prop.resetType(wholeDay ? "date" : "date-time");
  prop.setValues(times);
  vevent.addProperty(prop);
};

/**
 * Finds the master component — the one without a RECURRENCE-ID — and rejects
 * resources that hold no recurring series, where occurrence-level edits are
 * meaningless.
 */
const requireSeries = (
  vcalendar: ICAL.Component,
): { master: ICAL.Component; overrides: ICAL.Component[] } => {
  const vevents = vcalendar.getAllSubcomponents("vevent");
  if (!vevents.length) {
    throw new CalDAVError("The calendar resource contains no VEVENT.");
  }

  const master = vevents.find((vevent) => !isOverride(vevent));
  if (!master) {
    throw new CalDAVError(
      "The calendar resource contains no master component to modify.",
    );
  }

  const isRecurring =
    !!master.getFirstProperty("rrule") || !!master.getFirstProperty("rdate");
  if (!isRecurring) {
    throw new CalDAVError(
      "The event is not a recurring series. Use updateEvent/deleteEvent instead.",
    );
  }

  return {
    master,
    overrides: vevents.filter(isOverride),
  };
};

/**
 * Truncates a series so it stops before `cutoff`, converting a COUNT-limited
 * rule to an UNTIL-limited one (the two are mutually exclusive per RFC 5545
 * §3.3.10).
 */
const truncateBefore = (
  master: ICAL.Component,
  cutoff: Date,
  wholeDay: boolean,
) => {
  const rruleProp = master.getFirstProperty("rrule");
  if (!rruleProp) return;

  const recur = rruleProp.getFirstValue() as ICAL.Recur;
  const until = wholeDay
    ? occurrenceTime(new Date(cutoff.getTime() - MS_PER_DAY), true)
    : ICAL.Time.fromJSDate(new Date(cutoff.getTime() - 1000), true);

  recur.count = null;
  recur.until = until;
  rruleProp.setValue(recur);
};

const applyChanges = (
  vevent: ICAL.Component,
  changes: OccurrenceChanges,
  wholeDay: boolean,
) => {
  const setText = (name: string, value: string | undefined) => {
    if (value === undefined) return;
    vevent.removeAllProperties(name);
    if (value !== "") vevent.addPropertyWithValue(name, value);
  };

  setText("summary", changes.summary);
  setText("description", changes.description);
  setText("location", changes.location);
  setText("status", changes.status);

  if (changes.start) {
    vevent.removeAllProperties("dtstart");
    vevent.addPropertyWithValue(
      "dtstart",
      occurrenceTime(changes.start, wholeDay),
    );
  }
  if (changes.end) {
    vevent.removeAllProperties("dtend");
    vevent.addPropertyWithValue("dtend", occurrenceTime(changes.end, wholeDay));
  }
};

/**
 * Removes one occurrence of a recurring series, or that occurrence and every
 * later one.
 *
 * `"this"` adds the occurrence to EXDATE and drops any override for it.
 * `"thisAndFuture"` truncates the series instead; when the cut lands on or
 * before the first occurrence, the whole resource is deleted.
 */
export const deleteOccurrence = async (
  calendarUrl: string,
  ref: OccurrenceRef,
  occurrenceStart: Date,
  deps: OccurrenceDeps,
  scope: OccurrenceScope = "this",
): Promise<OccurrenceResult> => {
  const { href, ics, etag } = await loadResource(calendarUrl, ref, deps);
  const vcalendar = new ICAL.Component(ICAL.parse(ics));
  const { master, overrides } = requireSeries(vcalendar);

  const wholeDay = isWholeDayComponent(master);
  const target = occurrenceTime(occurrenceStart, wholeDay).toJSDate().getTime();
  const matches = (time: ICAL.Time) => time.toJSDate().getTime() === target;

  if (scope === "thisAndFuture") {
    const masterStart = instantOf(master, "dtstart")!;

    // Cutting at (or before) the first occurrence leaves nothing behind.
    if (masterStart >= target) {
      await deps.deleteResource(href, ref.etag ?? etag);
      return {
        href,
        etag: "",
        newCtag: await deps.getCtagAfterWrite(calendarUrl),
        seriesDeleted: true,
      };
    }

    truncateBefore(master, new Date(target), wholeDay);
    for (const override of overrides) {
      if (instantOf(override, "recurrence-id")! >= target) {
        vcalendar.removeSubcomponent(override);
      }
    }
    for (const name of ["exdate", "rdate"] as const) {
      const kept = collectTimes(master, name).filter(
        (time) => time.toJSDate().getTime() < target,
      );
      writeTimes(master, name, kept, wholeDay);
    }
  } else {
    for (const override of overrides) {
      if (instantOf(override, "recurrence-id") === target) {
        vcalendar.removeSubcomponent(override);
      }
    }

    // An occurrence added by an RDATE is removed by dropping that RDATE.
    const rdates = collectTimes(master, "rdate");
    const keptRdates = rdates.filter((time) => !matches(time));
    const wasRdate = keptRdates.length !== rdates.length;
    if (wasRdate) writeTimes(master, "rdate", keptRdates, wholeDay);

    // Anything the RRULE generates needs an EXDATE on top. Whether the rule
    // also produces a date that an RDATE listed is not worth expanding the
    // series to find out: a redundant EXDATE is ignored (RFC 5545 §3.8.5.1),
    // while a missing one would leave the occurrence in place.
    const needsExdate = !wasRdate || !!master.getFirstProperty("rrule");
    const exdates = collectTimes(master, "exdate");
    if (needsExdate && !exdates.some(matches)) {
      writeTimes(
        master,
        "exdate",
        [...exdates, occurrenceTime(occurrenceStart, wholeDay)],
        wholeDay,
      );
    }
  }

  touch(master);
  const response = await deps.putIcs(href, vcalendar.toString(), {
    "If-Match": ifMatchValue(ref.etag ?? etag),
  });

  return {
    href,
    etag: response.headers["etag"] || "",
    newCtag: await deps.getCtagAfterWrite(calendarUrl),
    seriesDeleted: false,
  };
};

/**
 * Changes a single occurrence of a recurring series by writing an override
 * component (same UID, plus a RECURRENCE-ID) into the series resource. An
 * existing override for that occurrence is patched rather than duplicated.
 */
export const updateOccurrence = async (
  calendarUrl: string,
  ref: OccurrenceRef,
  occurrenceStart: Date,
  changes: OccurrenceChanges,
  deps: OccurrenceDeps,
): Promise<OccurrenceResult> => {
  const { href, ics, etag } = await loadResource(calendarUrl, ref, deps);
  const vcalendar = new ICAL.Component(ICAL.parse(ics));
  const { master, overrides } = requireSeries(vcalendar);

  const wholeDay = isWholeDayComponent(master);
  const target = occurrenceTime(occurrenceStart, wholeDay).toJSDate().getTime();

  let override = overrides.find(
    (component) => instantOf(component, "recurrence-id") === target,
  );

  if (!override) {
    // A new override starts as a copy of the master so it carries the series'
    // own fields, minus everything that defines the recurrence itself.
    override = new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON())));
    for (const name of ["rrule", "exdate", "rdate", "recurrence-id"]) {
      override.removeAllProperties(name);
    }

    const masterStart = instantOf(master, "dtstart")!;
    const masterEnd = instantOf(master, "dtend");
    const duration = masterEnd !== undefined ? masterEnd - masterStart : 0;

    override.addPropertyWithValue(
      "recurrence-id",
      occurrenceTime(occurrenceStart, wholeDay),
    );
    override.removeAllProperties("dtstart");
    override.addPropertyWithValue(
      "dtstart",
      occurrenceTime(occurrenceStart, wholeDay),
    );
    if (duration > 0) {
      override.removeAllProperties("dtend");
      override.addPropertyWithValue(
        "dtend",
        occurrenceTime(new Date(occurrenceStart.getTime() + duration), wholeDay),
      );
    }

    vcalendar.addSubcomponent(override);
  }

  // Overriding an occurrence that was previously excluded only takes effect if
  // the exclusion goes away — EXDATE wins over everything else.
  const exdates = collectTimes(master, "exdate");
  const keptExdates = exdates.filter(
    (time) => time.toJSDate().getTime() !== target,
  );
  if (keptExdates.length !== exdates.length) {
    writeTimes(master, "exdate", keptExdates, wholeDay);
    touch(master);
  }

  applyChanges(override, changes, wholeDay);
  touch(override);

  const response = await deps.putIcs(href, vcalendar.toString(), {
    "If-Match": ifMatchValue(ref.etag ?? etag),
  });

  return {
    href,
    etag: response.headers["etag"] || "",
    newCtag: await deps.getCtagAfterWrite(calendarUrl),
    seriesDeleted: false,
  };
};
