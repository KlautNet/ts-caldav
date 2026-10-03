import { describe, expect, test } from "vitest";
import { parseCalendars, parseEvents, parseTodos } from "../../src/utils/parser";

const wrapXml = (ics: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/dav/calendars/test/item.ics</href>
    <propstat>
      <prop>
        <getetag>"abc123"</getetag>
        <calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${ics}</calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

// ── VTODO fixtures ────────────────────────────────────────────────────────────

const BASE_TODO = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:todo-uid-1
SUMMARY:My Task
DTSTAMP:20260317T120000Z
CREATED:20260310T080000Z
LAST-MODIFIED:20260317T120000Z
SEQUENCE:2
END:VTODO
END:VCALENDAR`;

const RELATED_TO_TODO = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:todo-uid-2
SUMMARY:Child Task
DTSTAMP:20260317T120000Z
RELATED-TO;RELTYPE=PARENT:parent-uid-123
END:VTODO
END:VCALENDAR`;

const MULTI_RELATED_TO_TODO = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:todo-uid-3
SUMMARY:Multi Parent Task
DTSTAMP:20260317T120000Z
RELATED-TO;RELTYPE=PARENT:parent-uid-1
RELATED-TO;RELTYPE=PARENT:parent-uid-2
END:VTODO
END:VCALENDAR`;

const MIXED_TODO = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:todo-uid-4
SUMMARY:Full Featured Task
DTSTAMP:20260317T120000Z
CATEGORIES:Work,Important
PRIORITY:1
X-OC-HIDESUBTASKS:0
RELATED-TO;RELTYPE=PARENT:parent-uid-abc
END:VTODO
END:VCALENDAR`;

// ── VEVENT fixtures ───────────────────────────────────────────────────────────

const BASE_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-uid-1
SUMMARY:My Event
DTSTART:20260317T100000Z
DTEND:20260317T110000Z
DTSTAMP:20260317T120000Z
CREATED:20260310T080000Z
LAST-MODIFIED:20260317T120000Z
SEQUENCE:1
END:VEVENT
END:VCALENDAR`;

const CUSTOM_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-uid-2
SUMMARY:Conference Call
DTSTART:20260317T140000Z
DTEND:20260317T150000Z
DTSTAMP:20260317T120000Z
CATEGORIES:Work
COLOR:blue
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR`;

const MULTI_CATEGORIES_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-uid-3
SUMMARY:Multi-cat Event
DTSTART:20260317T160000Z
DTEND:20260317T170000Z
DTSTAMP:20260317T120000Z
CATEGORIES:Work
CATEGORIES:Personal
END:VEVENT
END:VCALENDAR`;

// ── parseTodos ────────────────────────────────────────────────────────────────

describe("parseTodos – typed fields excluded from customFields", () => {
  test("uid and summary are not in customFields", async () => {
    const [todo] = await parseTodos(wrapXml(BASE_TODO));
    expect(todo.customFields?.["uid"]).toBeUndefined();
    expect(todo.customFields?.["summary"]).toBeUndefined();
  });

  test("dtstamp, created, last-modified, sequence are not in customFields", async () => {
    const [todo] = await parseTodos(wrapXml(BASE_TODO));
    expect(todo.customFields?.["dtstamp"]).toBeUndefined();
    expect(todo.customFields?.["created"]).toBeUndefined();
    expect(todo.customFields?.["last-modified"]).toBeUndefined();
    expect(todo.customFields?.["sequence"]).toBeUndefined();
  });

  test("single RELATED-TO is a string", async () => {
    const [todo] = await parseTodos(wrapXml(RELATED_TO_TODO));
    expect(todo.customFields?.["related-to"]).toBe("parent-uid-123");
  });

  test("multiple RELATED-TO becomes an array", async () => {
    const [todo] = await parseTodos(wrapXml(MULTI_RELATED_TO_TODO));
    const rel = todo.customFields?.["related-to"];
    expect(Array.isArray(rel)).toBe(true);
    expect(rel).toEqual(["parent-uid-1", "parent-uid-2"]);
  });

  test("various custom fields are captured", async () => {
    const [todo] = await parseTodos(wrapXml(MIXED_TODO));
    expect(todo.customFields?.["priority"]).toBe("1");
    expect(todo.customFields?.["x-oc-hidesubtasks"]).toBe("0");
    expect(todo.customFields?.["related-to"]).toBe("parent-uid-abc");
  });
});

// ── parseEvents ───────────────────────────────────────────────────────────────

describe("parseEvents – typed fields excluded from customFields", () => {
  test("uid, summary, dtstart, dtend are not in customFields", async () => {
    const [event] = await parseEvents(wrapXml(BASE_EVENT));
    expect(event.customFields?.["uid"]).toBeUndefined();
    expect(event.customFields?.["summary"]).toBeUndefined();
    expect(event.customFields?.["dtstart"]).toBeUndefined();
    expect(event.customFields?.["dtend"]).toBeUndefined();
  });

  test("dtstamp, created, last-modified, sequence are not in customFields", async () => {
    const [event] = await parseEvents(wrapXml(BASE_EVENT));
    expect(event.customFields?.["dtstamp"]).toBeUndefined();
    expect(event.customFields?.["created"]).toBeUndefined();
    expect(event.customFields?.["last-modified"]).toBeUndefined();
    expect(event.customFields?.["sequence"]).toBeUndefined();
  });

  test("custom event fields are captured", async () => {
    const [event] = await parseEvents(wrapXml(CUSTOM_EVENT));
    expect(event.customFields?.["color"]).toBe("blue");
    expect(event.customFields?.["x-google-conference"]).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(event.customFields?.["transp"]).toBe("OPAQUE");
  });

  test("multiple CATEGORIES becomes an array", async () => {
    const [event] = await parseEvents(wrapXml(MULTI_CATEGORIES_EVENT));
    const cats = event.customFields?.["categories"];
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toEqual(["Work", "Personal"]);
  });

  test("event with only known fields has no customFields", async () => {
    const [event] = await parseEvents(wrapXml(BASE_EVENT));
    expect(event.customFields).toBeUndefined();
  });
});

describe("DAV response shape parsing", () => {
  test("parseEvents reads the successful propstat when error propstats are present", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/dav/calendars/test/item.ics</href>
    <propstat>
      <prop><calendar-data /></prop>
      <status>HTTP/1.1 404 Not Found</status>
    </propstat>
    <propstat>
      <prop>
        <getetag>"abc123"</getetag>
        <calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${BASE_EVENT}</calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

    const [event] = await parseEvents(xml);

    expect(event.uid).toBe("event-uid-1");
    expect(event.etag).toBe('"abc123"');
  });

  test("parseCalendars handles multiple response nodes", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/dav/calendars/test/events/</href>
    <propstat>
      <prop>
        <displayname>Events</displayname>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/dav/calendars/test/tasks/</href>
    <propstat>
      <prop>
        <displayname>Tasks</displayname>
        <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

    const calendars = await parseCalendars(xml);

    expect(calendars.map((calendar) => calendar.displayName)).toEqual([
      "Events",
      "Tasks",
    ]);
  });
});

// ── description encoding ──────────────────────────────────────────────────────

describe("parseEvents – description encoding", () => {
  test("handles encoded carriage returns in long descriptions", async () => {
    const base = "é" + "X".repeat(63);
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:1\nDESCRIPTION:${base}&#13;\n X\nDTSTART:20240101T000000Z\nDTEND:20240101T010000Z\nEND:VEVENT\nEND:VCALENDAR`;
    const xml = `<multistatus><response><href>/test.ics</href><propstat><prop><calendar-data>${ics}</calendar-data></prop></propstat></response></multistatus>`;

    const [event] = await parseEvents(xml);
    expect(event.description).toBe(base + "X");
  });
});

// ── VEVENT – recurrence exceptions ────────────────────────────────────────────

const RECURRING_SERIES = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:series-1
SUMMARY:Weekly
DTSTAMP:20261001T120000Z
DTSTART:20261005T090000Z
DTEND:20261005T100000Z
RRULE:FREQ=WEEKLY;COUNT=6
EXDATE:20261012T090000Z,20261102T090000Z
RDATE:20261107T090000Z
END:VEVENT
BEGIN:VEVENT
UID:series-1
SUMMARY:Moved instance
DTSTAMP:20261001T120000Z
RECURRENCE-ID:20261019T090000Z
DTSTART:20261019T140000Z
DTEND:20261019T150000Z
END:VEVENT
END:VCALENDAR`;

describe("parseEvents – recurrence exceptions", () => {
  test("EXDATE and RDATE values are parsed onto the master", async () => {
    const [master] = await parseEvents(wrapXml(RECURRING_SERIES));

    expect(master.exdates?.map((d) => d.toISOString())).toEqual([
      "2026-10-12T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ]);
    expect(master.rdates?.map((d) => d.toISOString())).toEqual([
      "2026-11-07T09:00:00.000Z",
    ]);
    expect(master.recurrenceId).toBeUndefined();
  });

  test("an override carries its RECURRENCE-ID", async () => {
    const [, override] = await parseEvents(wrapXml(RECURRING_SERIES));

    expect(override.recurrenceId?.toISOString()).toBe(
      "2026-10-19T09:00:00.000Z",
    );
    expect(override.start.toISOString()).toBe("2026-10-19T14:00:00.000Z");
    expect(override.uid).toBe("series-1");
  });

  test("recurrence properties do not leak into customFields", async () => {
    const [master, override] = await parseEvents(wrapXml(RECURRING_SERIES));

    expect(master.customFields).toBeUndefined();
    expect(override.customFields).toBeUndefined();
  });
});

// ── TZID without VTIMEZONE ────────────────────────────────────────────────────

// What updateEvent writes, and what a server stores when it keeps no
// VTIMEZONE: ical.js cannot resolve the TZID on its own, and must not fall
// back to the process's local zone (#27).
const ZONED_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:zoned-1
SUMMARY:Zoned
DTSTAMP:20260901T120000Z
DTSTART;TZID=Europe/Vienna:20260928T130000
DTEND;TZID=America/New_York:20260928T090000
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=Europe/Vienna:20261005T130000
END:VEVENT
BEGIN:VEVENT
UID:zoned-1
SUMMARY:Moved
DTSTAMP:20260901T120000Z
RECURRENCE-ID;TZID=Europe/Vienna:20261012T130000
DTSTART;TZID=Europe/Vienna:20261012T150000
DURATION:PT1H
END:VEVENT
END:VCALENDAR`;

describe("parseEvents – TZID without VTIMEZONE", () => {
  test("start and end are read in their own zones", async () => {
    const [master] = await parseEvents(wrapXml(ZONED_EVENT));

    expect(master.start.toISOString()).toBe("2026-09-28T11:00:00.000Z");
    expect(master.end.toISOString()).toBe("2026-09-28T13:00:00.000Z");
    expect(master.startTzid).toBe("Europe/Vienna");
    expect(master.endTzid).toBe("America/New_York");
  });

  test("EXDATE and RECURRENCE-ID honour their TZID", async () => {
    const [master, override] = await parseEvents(wrapXml(ZONED_EVENT));

    expect(master.exdates?.map((d) => d.toISOString())).toEqual([
      "2026-10-05T11:00:00.000Z",
    ]);
    expect(override.recurrenceId?.toISOString()).toBe(
      "2026-10-12T11:00:00.000Z",
    );
  });

  test("an end derived from DURATION is read in the start's zone", async () => {
    const [, override] = await parseEvents(wrapXml(ZONED_EVENT));

    expect(override.start.toISOString()).toBe("2026-10-12T13:00:00.000Z");
    expect(override.end.toISOString()).toBe("2026-10-12T14:00:00.000Z");
  });

  test("an unknown TZID keeps the previous floating behaviour", async () => {
    const ics = ZONED_EVENT.replace(
      "DTSTART;TZID=Europe/Vienna:20260928T130000",
      "DTSTART;TZID=W. Europe Standard Time:20260928T130000",
    );
    const [master] = await parseEvents(wrapXml(ics));

    expect(master.start.getTime()).toBe(
      new Date(2026, 8, 28, 13, 0, 0).getTime(),
    );
    expect(master.startTzid).toBe("W. Europe Standard Time");
  });
});

// ── character references in calendar-data ─────────────────────────────────────

describe("calendar-data line breaks sent as character references (#28)", () => {
  // Migadu sends `&#xA;`; the other forms are the same line breaks spelled
  // differently and must behave identically.
  const separators = [
    "&#xA;",
    "&#xa;",
    "&#10;",
    "&#xD;&#xA;",
    "&#13;&#10;",
    "&#13;\n",
    "&#xD;\n",
  ];

  test.each(separators)("events parse with %j", async (separator) => {
    const xml = wrapXml(BASE_EVENT.split("\n").join(separator) + separator);
    const [event] = await parseEvents(xml);

    expect(event.uid).toBe("event-uid-1");
    expect(event.start.toISOString()).toBe("2026-03-17T10:00:00.000Z");
  });

  test.each(separators)("todos parse with %j", async (separator) => {
    const xml = wrapXml(BASE_TODO.split("\n").join(separator) + separator);
    const [todo] = await parseTodos(xml);

    expect(todo.uid).toBe("todo-uid-1");
    expect(todo.summary).toBe("My Task");
  });

  test("character references inside property values are decoded", async () => {
    const ics = BASE_EVENT.replace(
      /SUMMARY:.*/,
      "SUMMARY:Caf&#xE9; &#8364;5 Bob&#39;s",
    );
    const [event] = await parseEvents(wrapXml(ics));

    expect(event.summary).toBe("Café €5 Bob's");
  });

  test("text that merely looks like a character reference is kept", async () => {
    const ics = BASE_EVENT.replace(
      /SUMMARY:.*/,
      "SUMMARY:type &amp;#13; or &amp;#xA; for a line break",
    );
    const [event] = await parseEvents(wrapXml(ics));

    expect(event.summary).toBe("type &#13; or &#xA; for a line break");
  });
});

describe("parseCalendars – numeric-looking values", () => {
  test("a numeric display name and ctag are kept as strings", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/u/2026/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>2026</d:displayname>
        <cs:getctag>1759483920</cs:getctag>
        <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

    const [calendar] = await parseCalendars(xml);

    expect(calendar.displayName).toBe("2026");
    expect(calendar.ctag).toBe("1759483920");
  });
});
