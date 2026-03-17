import { parseEvents, parseTodos } from "../src/utils/parser";

const makeTodoResponse = (ics: string) => `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/dav/calendars/test/todo1.ics</href>
    <propstat>
      <prop>
        <getetag>"abc123"</getetag>
        <calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${ics}</calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

const makeEventResponse = (ics: string) => makeTodoResponse(ics);

// ── VTODO fixtures ────────────────────────────────────────────────────────────

const BASE_TODO_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:test-uid-1
SUMMARY:My Task
DTSTAMP:20260317T120000Z
END:VTODO
END:VCALENDAR`;

const RELATED_TO_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:test-uid-2
SUMMARY:Child Task
DTSTAMP:20260317T120000Z
RELATED-TO;RELTYPE=PARENT:parent-uid-123
END:VTODO
END:VCALENDAR`;

const MULTI_RELATED_TO_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:test-uid-3
SUMMARY:Multi Parent Task
DTSTAMP:20260317T120000Z
RELATED-TO;RELTYPE=PARENT:parent-uid-1
RELATED-TO;RELTYPE=PARENT:parent-uid-2
END:VTODO
END:VCALENDAR`;

const MIXED_TODO_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:test-uid-4
SUMMARY:Full Featured Task
DTSTAMP:20260317T120000Z
CATEGORIES:Work,Important
PRIORITY:1
X-OC-HIDESUBTASKS:0
RELATED-TO;RELTYPE=PARENT:parent-uid-abc
END:VTODO
END:VCALENDAR`;

// ── VEVENT fixtures ───────────────────────────────────────────────────────────

const BASE_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-uid-1
SUMMARY:My Event
DTSTART:20260317T100000Z
DTEND:20260317T110000Z
DTSTAMP:20260317T120000Z
END:VEVENT
END:VCALENDAR`;

const CUSTOM_EVENT_ICS = `BEGIN:VCALENDAR
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

const MULTI_CATEGORIES_EVENT_ICS = `BEGIN:VCALENDAR
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

// ── Todo tests ────────────────────────────────────────────────────────────────

describe("parseTodos – customFields", () => {
  test("typed Todo fields are not present in customFields", async () => {
    const todos = await parseTodos(makeTodoResponse(BASE_TODO_ICS));
    expect(todos).toHaveLength(1);
    expect(todos[0].customFields?.["uid"]).toBeUndefined();
    expect(todos[0].customFields?.["summary"]).toBeUndefined();
  });

  test("single RELATED-TO is a string", async () => {
    const todos = await parseTodos(makeTodoResponse(RELATED_TO_ICS));
    expect(todos).toHaveLength(1);
    expect(todos[0].customFields?.["related-to"]).toBe("parent-uid-123");
  });

  test("multiple RELATED-TO becomes an array", async () => {
    const todos = await parseTodos(makeTodoResponse(MULTI_RELATED_TO_ICS));
    expect(todos).toHaveLength(1);
    const rel = todos[0].customFields?.["related-to"];
    expect(Array.isArray(rel)).toBe(true);
    expect(rel).toEqual(["parent-uid-1", "parent-uid-2"]);
  });

  test("various custom fields are captured", async () => {
    const todos = await parseTodos(makeTodoResponse(MIXED_TODO_ICS));
    expect(todos).toHaveLength(1);
    const { customFields } = todos[0];
    expect(customFields?.["priority"]).toBe("1");
    expect(customFields?.["x-oc-hidesubtasks"]).toBe("0");
    expect(customFields?.["related-to"]).toBe("parent-uid-abc");
  });
});

// ── Event tests ───────────────────────────────────────────────────────────────

describe("parseEvents – customFields", () => {
  test("typed Event fields are not present in customFields", async () => {
    const events = await parseEvents(makeEventResponse(BASE_EVENT_ICS));
    expect(events).toHaveLength(1);
    expect(events[0].customFields?.["uid"]).toBeUndefined();
    expect(events[0].customFields?.["summary"]).toBeUndefined();
    expect(events[0].customFields?.["dtstart"]).toBeUndefined();
    expect(events[0].customFields?.["dtend"]).toBeUndefined();
  });

  test("custom event fields are captured", async () => {
    const events = await parseEvents(makeEventResponse(CUSTOM_EVENT_ICS));
    expect(events).toHaveLength(1);
    const { customFields } = events[0];
    expect(customFields?.["color"]).toBe("blue");
    expect(customFields?.["x-google-conference"]).toBe(
      "https://meet.google.com/abc-defg-hij"
    );
    expect(customFields?.["transp"]).toBe("OPAQUE");
  });

  test("multiple CATEGORIES becomes an array", async () => {
    const events = await parseEvents(
      makeEventResponse(MULTI_CATEGORIES_EVENT_ICS)
    );
    expect(events).toHaveLength(1);
    const cats = events[0].customFields?.["categories"];
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toEqual(["Work", "Personal"]);
  });

  test("customFields is omitted when no extra properties", async () => {
    const events = await parseEvents(makeEventResponse(BASE_EVENT_ICS));
    // dtstamp is the only non-typed field here — customFields should exist but
    // not contain typed fields
    expect(events[0].customFields?.["uid"]).toBeUndefined();
  });
});
