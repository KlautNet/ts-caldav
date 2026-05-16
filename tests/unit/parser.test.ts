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
