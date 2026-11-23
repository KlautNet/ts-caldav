import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ICAL from "ical.js";
import { CalDAVClient } from "../../src/client";
import { parseEvents, parseTodos } from "../../src/utils/parser";

const CAL = "https://example.com/calendars/u/default/";

const wrap = (ics: string) => `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/u/default/evt-1.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"1"</d:getetag><c:calendar-data><![CDATA[${ics}]]></c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const lines = (...l: string[]) => [...l, ""].join("\r\n");

const SERIES = lines(
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Other//EN",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Vienna",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:evt-1",
  "DTSTAMP:20260101T000000Z",
  "CREATED:20260101T000000Z",
  "DTSTART:20260601T100000Z",
  "DURATION:PT1H",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "SUMMARY:Planning",
  "SEQUENCE:2",
  "ORGANIZER;CN=Alice:mailto:alice@example.com",
  "ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:bob@example.com",
  'ATTENDEE;CN="Doe, Carol";PARTSTAT=TENTATIVE:mailto:carol@example.com',
  "CATEGORIES:Work,Planning",
  "GEO:48.2;16.37",
  "ATTACH;ENCODING=BASE64;VALUE=BINARY;FMTTYPE=text/plain:SGVsbG8=",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER;RELATED=END:-PT5M",
  "DESCRIPTION:Reminder",
  "X-WR-ALARMUID:a1",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-1",
  "DTSTAMP:20260101T000000Z",
  "RECURRENCE-ID:20260608T100000Z",
  "DTSTART:20260608T140000Z",
  "DTEND:20260608T150000Z",
  "SUMMARY:Moved",
  "END:VEVENT",
  "END:VCALENDAR",
);

let captured = "";

beforeEach(() => {
  captured = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        captured = init.body as string;
        return new Response(null, { status: 204, headers: { etag: '"2"' } });
      }
      return new Response("<d:multistatus xmlns:d=\"DAV:\"/>", { status: 207 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () =>
  CalDAVClient.createFromCache(
    {
      baseUrl: "https://example.com",
      auth: { type: "basic", username: "u", password: "p" },
    },
    { userPrincipal: "/principals/u/", calendarHome: "/calendars/u/" },
  );

const written = () => new ICAL.Component(ICAL.parse(captured));

const components = () => written().getAllSubcomponents("vevent");
const master = () =>
  components().find((c) => !c.hasProperty("recurrence-id"))!;

const params = (component: ICAL.Component, name: string) =>
  component.getAllProperties(name).map((p) => ({
    value: String(p.getFirstValue()),
    params: p.toJSON()[1],
  }));

describe("updateEvent amends the stored resource (#32)", () => {
  test("parsed events carry the resource they came from", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    // XML parsing normalises line endings (XML 1.0 §2.11).
    expect(event.ics).toBe(SERIES.replace(/\r\n/g, "\n"));
  });

  test("a summary change keeps everything the model does not cover", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    await client().updateEvent(CAL, { ...event, summary: "Planning (moved)" });

    const vevent = master();
    expect(vevent.getFirstPropertyValue("summary")).toBe("Planning (moved)");
    expect(vevent.getFirstPropertyValue("sequence")).toBe(3);
    expect(params(vevent, "attendee")).toEqual([
      {
        value: "mailto:bob@example.com",
        params: { cn: "Bob", partstat: "ACCEPTED", role: "REQ-PARTICIPANT" },
      },
      {
        value: "mailto:carol@example.com",
        params: { cn: "Doe, Carol", partstat: "TENTATIVE" },
      },
    ]);
    expect(params(vevent, "organizer")[0].params).toEqual({ cn: "Alice" });
    expect(vevent.getFirstProperty("categories")!.getValues()).toEqual([
      "Work",
      "Planning",
    ]);
    expect(vevent.getFirstPropertyValue("geo")).toEqual([48.2, 16.37]);
    const attach = vevent.getFirstProperty("attach")!;
    expect(attach.getParameter("encoding")).toBe("BASE64");
    expect(attach.type).toBe("binary");
    expect(vevent.hasProperty("created")).toBe(true);
    expect(vevent.hasProperty("duration")).toBe(true);
    expect(vevent.hasProperty("description")).toBe(false);

    const [alarm] = vevent.getAllSubcomponents("valarm");
    expect(alarm.getFirstProperty("trigger")!.getParameter("related")).toBe("END");
    expect(alarm.getFirstPropertyValue("x-wr-alarmuid")).toBe("a1");

    expect(written().getFirstSubcomponent("vtimezone")).not.toBeNull();
    expect(components()).toHaveLength(2);
  });

  test("removing an attendee keeps the parameters of the others", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    await client().updateEvent(CAL, {
      ...event,
      customFields: {
        ...event.customFields,
        attendee: ["mailto:bob@example.com", "mailto:dave@example.com"],
      },
    });

    expect(params(master(), "attendee")).toEqual([
      {
        value: "mailto:bob@example.com",
        params: { cn: "Bob", partstat: "ACCEPTED", role: "REQ-PARTICIPANT" },
      },
      { value: "mailto:dave@example.com", params: {} },
    ]);
  });

  test("deleting a custom field removes the property", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    const customFields = { ...event.customFields };
    delete customFields.geo;
    await client().updateEvent(CAL, { ...event, customFields });

    expect(master().hasProperty("geo")).toBe(false);
    expect(master().hasProperty("categories")).toBe(true);
  });

  test("a new start replaces a DURATION with the model's end", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    await client().updateEvent(CAL, {
      ...event,
      start: new Date("2026-06-01T12:00:00Z"),
      end: new Date("2026-06-01T13:00:00Z"),
    });

    const vevent = master();
    expect(String(vevent.getFirstPropertyValue("dtstart"))).toBe(
      "2026-06-01T12:00:00Z",
    );
    expect(String(vevent.getFirstPropertyValue("dtend"))).toBe(
      "2026-06-01T13:00:00Z",
    );
    expect(vevent.hasProperty("duration")).toBe(false);
  });

  test("changed alarms replace the stored ones", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    await client().updateEvent(CAL, {
      ...event,
      alarms: [{ action: "AUDIO", trigger: "-PT10M" }],
    });

    const alarms = master().getAllSubcomponents("valarm");
    expect(alarms).toHaveLength(1);
    expect(alarms[0].getFirstPropertyValue("action")).toBe("AUDIO");
  });

  test("updating an override leaves the master untouched", async () => {
    const [, override] = await parseEvents(wrap(SERIES));
    await client().updateEvent(CAL, { ...override, summary: "Moved again" });

    const [first, second] = components();
    expect(first.getFirstPropertyValue("summary")).toBe("Planning");
    expect(first.getFirstPropertyValue("sequence")).toBe(2);
    expect(second.getFirstPropertyValue("summary")).toBe("Moved again");
  });

  test("an event without ics is built from the model as before", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    await client().updateEvent(CAL, { ...event, ics: undefined });

    expect(components()).toHaveLength(1);
    expect(params(master(), "attendee")[0].params).toEqual({});
  });

  test("unreadable ics falls back to building from the model", async () => {
    const [event] = await parseEvents(wrap(SERIES));
    await client().updateEvent(CAL, { ...event, ics: "not ical" });

    expect(master().getFirstPropertyValue("summary")).toBe("Planning");
  });
});

describe("updateTodo amends the stored resource (#32)", () => {
  const TODO = lines(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Other//EN",
    "BEGIN:VTODO",
    "UID:todo-1",
    "DTSTAMP:20260101T000000Z",
    "SUMMARY:Task",
    "ATTENDEE;CN=Bob;PARTSTAT=NEEDS-ACTION:mailto:bob@example.com",
    "CATEGORIES:A,B",
    "END:VTODO",
    "END:VCALENDAR",
  );

  test("a status change keeps parameters and values", async () => {
    const [todo] = await parseTodos(wrap(TODO));
    await client().updateTodo(CAL, { ...todo, status: "COMPLETED" });

    const vtodo = written().getFirstSubcomponent("vtodo")!;
    expect(vtodo.getFirstPropertyValue("status")).toBe("COMPLETED");
    expect(params(vtodo, "attendee")[0].params).toEqual({
      cn: "Bob",
      partstat: "NEEDS-ACTION",
    });
    expect(vtodo.getFirstProperty("categories")!.getValues()).toEqual(["A", "B"]);
  });
});
