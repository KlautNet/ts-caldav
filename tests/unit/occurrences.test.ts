import { describe, expect, test, vi } from "vitest";
import ICAL from "ical.js";
import { CalDAVError } from "../../src/errors";
import {
  OccurrenceDeps,
  deleteOccurrence,
  updateOccurrence,
} from "../../src/protocol/occurrences";

const calendarUrl = "https://example.test/calendars/user/default/";
const href = `${calendarUrl}series-1.ics`;

const SERIES = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VEVENT",
  "UID:series-1",
  "SUMMARY:Weekly",
  "DTSTAMP:20261001T120000Z",
  "DTSTART:20261005T090000Z",
  "DTEND:20261005T100000Z",
  "RRULE:FREQ=WEEKLY;COUNT=6",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const SINGLE = SERIES.replace("RRULE:FREQ=WEEKLY;COUNT=6\r\n", "");

const FIRST = new Date("2026-10-05T09:00:00Z");
const SECOND = new Date("2026-10-12T09:00:00Z");
const THIRD = new Date("2026-10-19T09:00:00Z");

/** Captures what would be written, so assertions run against the real ICS. */
const harness = (ics = SERIES) => {
  const written: string[] = [];
  const deleted: string[] = [];

  const deps: OccurrenceDeps = {
    fetchIcs: vi.fn(async () => ({ ics, etag: '"e1"' })),
    putIcs: vi.fn(async (_href: string, body: string) => {
      written.push(body);
      return { status: 204, headers: { etag: '"e2"' }, data: "", url: _href };
    }),
    deleteResource: vi.fn(async (target: string) => {
      deleted.push(target);
    }),
    getCtagAfterWrite: vi.fn(async () => "ctag-2"),
    absolutize: (urlOrPath: string) => urlOrPath,
  };

  const result = () => {
    const vcalendar = new ICAL.Component(ICAL.parse(written.at(-1)!));
    const vevents = vcalendar.getAllSubcomponents("vevent");
    return {
      vevents,
      master: vevents.find((v) => !v.getFirstProperty("recurrence-id"))!,
      overrides: vevents.filter((v) => !!v.getFirstProperty("recurrence-id")),
    };
  };

  return { deps, written, deleted, result };
};

const icalStrings = (component: ICAL.Component, name: string) =>
  component
    .getFirstProperty(name)!
    .getValues()
    .map((value) => (value as ICAL.Time).toICALString());

describe("deleteOccurrence – scope 'this'", () => {
  test("excludes the occurrence with EXDATE and keeps the rule intact", async () => {
    const { deps, result } = harness();

    const outcome = await deleteOccurrence(
      calendarUrl,
      { href },
      SECOND,
      deps,
    );
    expect(outcome).toMatchObject({
      href,
      etag: '"e2"',
      newCtag: "ctag-2",
      seriesDeleted: false,
    });

    const { master, vevents } = result();
    expect(vevents).toHaveLength(1);
    expect(icalStrings(master, "exdate")).toEqual(["20261012T090000Z"]);
    expect(master.getFirstPropertyValue("rrule")?.toString()).toBe(
      "FREQ=WEEKLY;COUNT=6",
    );
  });

  test("appends to an existing EXDATE rather than replacing it", async () => {
    const { deps, result } = harness(
      SERIES.replace(
        "RRULE:FREQ=WEEKLY;COUNT=6",
        "RRULE:FREQ=WEEKLY;COUNT=6\r\nEXDATE:20261012T090000Z",
      ),
    );

    await deleteOccurrence(calendarUrl, { href }, THIRD, deps);

    expect(icalStrings(result().master, "exdate")).toEqual([
      "20261012T090000Z",
      "20261019T090000Z",
    ]);
  });

  test("does not add the same exclusion twice", async () => {
    const { deps, result } = harness(
      SERIES.replace(
        "RRULE:FREQ=WEEKLY;COUNT=6",
        "RRULE:FREQ=WEEKLY;COUNT=6\r\nEXDATE:20261012T090000Z",
      ),
    );

    await deleteOccurrence(calendarUrl, { href }, SECOND, deps);

    expect(icalStrings(result().master, "exdate")).toEqual([
      "20261012T090000Z",
    ]);
  });

  test("drops the RDATE of an occurrence that only an RDATE created", async () => {
    // No RRULE: dropping the RDATE removes the occurrence outright, so an
    // EXDATE would only get in the way of adding that date back later.
    const { deps, result } = harness(
      SERIES.replace("RRULE:FREQ=WEEKLY;COUNT=6", "RDATE:20261107T090000Z"),
    );

    await deleteOccurrence(
      calendarUrl,
      { href },
      new Date("2026-11-07T09:00:00Z"),
      deps,
    );

    const { master } = result();
    expect(master.getFirstProperty("rdate")).toBeNull();
    expect(master.getFirstProperty("exdate")).toBeNull();
  });

  test("also excludes an RDATE occurrence when a rule could regenerate it", async () => {
    const { deps, result } = harness(
      SERIES.replace(
        "RRULE:FREQ=WEEKLY;COUNT=6",
        "RRULE:FREQ=WEEKLY;COUNT=6\r\nRDATE:20261107T090000Z",
      ),
    );

    await deleteOccurrence(
      calendarUrl,
      { href },
      new Date("2026-11-07T09:00:00Z"),
      deps,
    );

    const { master } = result();
    expect(master.getFirstProperty("rdate")).toBeNull();
    expect(icalStrings(master, "exdate")).toEqual(["20261107T090000Z"]);
  });

  test("removes the override for an occurrence it excludes", async () => {
    const withOverride = SERIES.replace(
      "END:VCALENDAR",
      [
        "BEGIN:VEVENT",
        "UID:series-1",
        "RECURRENCE-ID:20261019T090000Z",
        "DTSTART:20261019T140000Z",
        "DTEND:20261019T150000Z",
        "SUMMARY:Moved",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    const { deps, result } = harness(withOverride);

    await deleteOccurrence(calendarUrl, { href }, THIRD, deps);

    const { vevents, master } = result();
    expect(vevents).toHaveLength(1);
    expect(icalStrings(master, "exdate")).toEqual(["20261019T090000Z"]);
  });
});

describe("deleteOccurrence – scope 'thisAndFuture'", () => {
  test("converts COUNT to an UNTIL that stops before the occurrence", async () => {
    const { deps, result } = harness();

    await deleteOccurrence(calendarUrl, { href }, THIRD, deps, "thisAndFuture");

    const rrule = result().master.getFirstPropertyValue("rrule")!.toString();
    expect(rrule).toContain("UNTIL=20261019T085959Z");
    expect(rrule).not.toContain("COUNT");
  });

  test("deletes the resource when the cut lands on the first occurrence", async () => {
    const { deps, deleted, written } = harness();

    const outcome = await deleteOccurrence(
      calendarUrl,
      { href },
      FIRST,
      deps,
      "thisAndFuture",
    );

    expect(outcome).toMatchObject({ seriesDeleted: true, etag: "" });
    expect(deleted).toEqual([href]);
    expect(written).toHaveLength(0);
  });

  test("drops overrides and exception dates at or after the cut", async () => {
    const withExtras = SERIES.replace(
      "RRULE:FREQ=WEEKLY;COUNT=6",
      "RRULE:FREQ=WEEKLY;COUNT=6\r\nEXDATE:20261012T090000Z,20261102T090000Z",
    ).replace(
      "END:VCALENDAR",
      [
        "BEGIN:VEVENT",
        "UID:series-1",
        "RECURRENCE-ID:20261026T090000Z",
        "DTSTART:20261026T140000Z",
        "SUMMARY:Later",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    const { deps, result } = harness(withExtras);

    await deleteOccurrence(calendarUrl, { href }, THIRD, deps, "thisAndFuture");

    const { master, overrides } = result();
    expect(overrides).toHaveLength(0);
    expect(icalStrings(master, "exdate")).toEqual(["20261012T090000Z"]);
  });
});

describe("updateOccurrence", () => {
  test("creates an override carrying RECURRENCE-ID and the changes", async () => {
    const { deps, result } = harness();

    await updateOccurrence(
      calendarUrl,
      { href },
      THIRD,
      {
        summary: "Moved instance",
        start: new Date("2026-10-19T14:00:00Z"),
        end: new Date("2026-10-19T15:00:00Z"),
      },
      deps,
    );

    const { master, overrides } = result();
    expect(overrides).toHaveLength(1);

    const override = overrides[0];
    expect(
      (
        override.getFirstProperty("recurrence-id")!.getFirstValue() as ICAL.Time
      ).toICALString(),
    ).toBe("20261019T090000Z");
    expect(override.getFirstPropertyValue("summary")).toBe("Moved instance");
    expect(
      (override.getFirstProperty("dtstart")!.getFirstValue() as ICAL.Time)
        .toICALString(),
    ).toBe("20261019T140000Z");
    expect(override.getFirstPropertyValue("uid")).toBe("series-1");

    // An override must not carry the recurrence definition itself.
    expect(override.getFirstProperty("rrule")).toBeNull();
    // ...and the master keeps it.
    expect(master.getFirstPropertyValue("summary")).toBe("Weekly");
    expect(master.getFirstProperty("rrule")).toBeTruthy();
  });

  test("keeps the master's duration when only the start moves", async () => {
    const { deps, result } = harness();

    await updateOccurrence(calendarUrl, { href }, THIRD, {}, deps);

    const override = result().overrides[0];
    expect(
      (override.getFirstProperty("dtend")!.getFirstValue() as ICAL.Time)
        .toICALString(),
    ).toBe("20261019T100000Z");
  });

  test("patches an existing override instead of adding a second one", async () => {
    const { deps, written, result } = harness();

    await updateOccurrence(calendarUrl, { href }, THIRD, { summary: "A" }, deps);
    // Feed the written resource back in, as a second call against the server would.
    const second = harness(written.at(-1)!);
    await updateOccurrence(
      calendarUrl,
      { href },
      THIRD,
      { summary: "B" },
      second.deps,
    );

    expect(result().overrides).toHaveLength(1);
    const overrides = second.result().overrides;
    expect(overrides).toHaveLength(1);
    expect(overrides[0].getFirstPropertyValue("summary")).toBe("B");
  });

  test("lifts a prior exclusion for the occurrence it overrides", async () => {
    const { deps, result } = harness(
      SERIES.replace(
        "RRULE:FREQ=WEEKLY;COUNT=6",
        "RRULE:FREQ=WEEKLY;COUNT=6\r\nEXDATE:20261012T090000Z,20261019T090000Z",
      ),
    );

    await updateOccurrence(
      calendarUrl,
      { href },
      THIRD,
      { summary: "Back on" },
      deps,
    );

    const { master, overrides } = result();
    expect(icalStrings(master, "exdate")).toEqual(["20261012T090000Z"]);
    expect(overrides[0].getFirstPropertyValue("summary")).toBe("Back on");
  });

  test("bumps SEQUENCE so clients notice the change", async () => {
    const { deps, written } = harness();

    await updateOccurrence(calendarUrl, { href }, THIRD, { summary: "A" }, deps);
    const second = harness(written.at(-1)!);
    await updateOccurrence(
      calendarUrl,
      { href },
      THIRD,
      { summary: "B" },
      second.deps,
    );

    expect(
      second.result().overrides[0].getFirstPropertyValue("sequence"),
    ).toBe(2);
  });
});

// A series that carries a TZID but no VTIMEZONE, as updateEvent writes it.
// The occurrence to touch is given as an instant and must match the
// wall-clock times regardless of the process's own zone (#27).
const ZONED_SERIES = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VEVENT",
  "UID:series-1",
  "SUMMARY:Weekly",
  "DTSTAMP:20261001T120000Z",
  "DTSTART;TZID=Europe/Vienna:20261005T110000",
  "DTEND;TZID=Europe/Vienna:20261005T120000",
  "RRULE:FREQ=WEEKLY;COUNT=6",
  "EXDATE;TZID=Europe/Vienna:20261026T110000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:series-1",
  "SUMMARY:Moved",
  "DTSTAMP:20261001T120000Z",
  "RECURRENCE-ID;TZID=Europe/Vienna:20261019T110000",
  "DTSTART;TZID=Europe/Vienna:20261019T150000",
  "DTEND;TZID=Europe/Vienna:20261019T160000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("occurrences with a TZID but no VTIMEZONE", () => {
  test("deleteOccurrence matches the override by instant and writes a UTC EXDATE", async () => {
    const { deps, result } = harness(ZONED_SERIES);

    // 11:00 Vienna on 2026-10-19 (CEST) is 09:00Z.
    await deleteOccurrence(calendarUrl, { href }, THIRD, deps);

    const { master, overrides } = result();
    expect(overrides).toHaveLength(0);
    // The existing EXDATE is 11:00 Vienna on 2026-10-26, after the switch
    // to CET, so 10:00Z.
    expect(icalStrings(master, "exdate")).toEqual([
      "20261026T100000Z",
      "20261019T090000Z",
    ]);
  });

  test("updateOccurrence patches the existing override rather than adding one", async () => {
    const { deps, result } = harness(ZONED_SERIES);

    await updateOccurrence(calendarUrl, { href }, THIRD, { summary: "B" }, deps);

    const { overrides } = result();
    expect(overrides).toHaveLength(1);
    expect(overrides[0].getFirstPropertyValue("summary")).toBe("B");
  });

  test("updateOccurrence keeps the master's duration for a new override", async () => {
    const { deps, result } = harness(ZONED_SERIES);

    await updateOccurrence(calendarUrl, { href }, SECOND, {}, deps);

    const override = result().overrides.find(
      (v) =>
        (v.getFirstProperty("recurrence-id")!.getFirstValue() as ICAL.Time)
          .toICALString() === "20261012T090000Z",
    )!;
    expect(
      (override.getFirstProperty("dtend")!.getFirstValue() as ICAL.Time)
        .toICALString(),
    ).toBe("20261012T100000Z");
  });

  test("thisAndFuture compares the master's start as an instant", async () => {
    const { deps, deleted } = harness(ZONED_SERIES);

    await deleteOccurrence(calendarUrl, { href }, FIRST, deps, "thisAndFuture");

    expect(deleted).toEqual([href]);
  });
});

describe("occurrence preconditions", () => {
  test("a non-recurring event is rejected", async () => {
    const { deps } = harness(SINGLE);

    await expect(
      deleteOccurrence(calendarUrl, { href }, FIRST, deps),
    ).rejects.toThrow(/not a recurring series/);
  });

  test("a reference without uid or href is rejected", async () => {
    const { deps } = harness();

    await expect(
      deleteOccurrence(calendarUrl, {}, FIRST, deps),
    ).rejects.toThrow(/'uid' or 'href'/);
  });

  test("a uid-only reference falls back to a lookup when the guess 404s", async () => {
    const realHref = `${calendarUrl}server-chosen.ics`;
    const { deps } = harness();
    deps.fetchIcs = vi.fn(async (target: string) => {
      if (target !== realHref) throw new CalDAVError("HTTP 404", 404);
      return { ics: SERIES, etag: '"e1"' };
    });
    deps.resolveHrefByUid = vi.fn(async () => realHref);

    await expect(
      deleteOccurrence(calendarUrl, { uid: "series-1" }, SECOND, deps),
    ).resolves.toMatchObject({ href: realHref, seriesDeleted: false });
    expect(deps.resolveHrefByUid).toHaveBeenCalledWith(calendarUrl, "series-1");
  });
});
