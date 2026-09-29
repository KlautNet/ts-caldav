import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ICAL from "ical.js";
import { CalDAVClient } from "../../src/client";
import { parseEvents } from "../../src/utils/parser";

const wrapCalendarData = (ics: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/calendars/u/default/evt-1.ics</href>
    <propstat>
      <prop>
        <getetag>"e1"</getetag>
        <C:calendar-data>${ics}</C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

const CTAG_RESPONSE = `<multistatus xmlns="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <response><propstat><prop><cs:getctag>ctag-1</cs:getctag></prop></propstat></response>
</multistatus>`;

// Sanity-check: verify the CTAG_RESPONSE is parseable and returns a value, so
// a malformed mock doesn't silently let every builder test pass.
test("CTAG mock XML is correctly structured", async () => {
  const result = await makeClient().updateEvent(CAL, { ...BASE_EVENT });
  expect(result.newCtag).toBe("ctag-1");
});

let capturedICS = "";

beforeEach(() => {
  capturedICS = "";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        capturedICS = init.body as string;
        return new Response(null, { status: 204, headers: { etag: '"e1"' } });
      }
      return new Response(CTAG_RESPONSE, { status: 207 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeClient() {
  return CalDAVClient.createFromCache(
    {
      baseUrl: "https://example.com",
      auth: { type: "basic", username: "u", password: "p" },
    },
    { userPrincipal: "/principals/u/", calendarHome: "/calendars/u/" },
  );
}

const CAL = "https://example.com/calendars/u/default/";

const BASE_EVENT = {
  uid: "evt-1",
  href: "https://example.com/calendars/u/default/evt-1.ics",
  etag: '"e0"',
  start: new Date("2026-03-15T10:00:00Z"),
  end: new Date("2026-03-15T11:00:00Z"),
  summary: "Test Event",
};

const BASE_TODO = {
  uid: "todo-1",
  href: "https://example.com/calendars/u/default/todo-1.ics",
  summary: "Test Todo",
};

function vevent() {
  const vcal = new ICAL.Component(ICAL.parse(capturedICS));
  return vcal.getFirstSubcomponent("vevent")!;
}

function vtodo() {
  const vcal = new ICAL.Component(ICAL.parse(capturedICS));
  return vcal.getFirstSubcomponent("vtodo")!;
}

// ── VEVENT – DTSTAMP ──────────────────────────────────────────────────────────

describe("buildICSData – DTSTAMP", () => {
  test("appears exactly once", async () => {
    await makeClient().updateEvent(CAL, { ...BASE_EVENT });
    expect(vevent().getAllProperties("dtstamp")).toHaveLength(1);
  });

  // Verifies parser+builder combination: dtstamp/created/last-modified/sequence
  // no longer reach customFields after the parser fix, so buildICSData never
  // sees them and cannot emit them twice. Parser coverage lives in parser.test.ts.
});

// ── VEVENT – core fields ──────────────────────────────────────────────────────

describe("buildICSData – core fields", () => {
  test("UID, SUMMARY, DTSTART, DTEND are present", async () => {
    await makeClient().updateEvent(CAL, { ...BASE_EVENT });
    const v = vevent();
    expect(v.getFirstPropertyValue("uid")).toBe("evt-1");
    expect(v.getFirstPropertyValue("summary")).toBe("Test Event");
    expect(v.getFirstProperty("dtstart")).toBeTruthy();
    expect(v.getFirstProperty("dtend")).toBeTruthy();
  });

  test("whole-day event uses DATE values (not DATETIME)", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      wholeDay: true,
      start: new Date("2026-03-15T00:00:00Z"),
      end: new Date("2026-03-16T00:00:00Z"),
    });
    const dtstart = vevent().getFirstProperty("dtstart")!;
    expect((dtstart.getFirstValue() as ICAL.Time).isDate).toBe(true);
  });

  test("TZID parameter is set for timezone-aware events", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      startTzid: "Europe/Berlin",
      endTzid: "Europe/Berlin",
    });
    const v = vevent();
    expect(v.getFirstProperty("dtstart")?.getParameter("tzid")).toBe(
      "Europe/Berlin",
    );
    expect(v.getFirstProperty("dtend")?.getParameter("tzid")).toBe(
      "Europe/Berlin",
    );
  });

  test("a TZID value is the wall-clock time in that zone, not UTC with a Z (#27)", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      start: new Date("2026-09-28T11:00:00Z"),
      end: new Date("2026-09-28T12:00:00Z"),
      startTzid: "Europe/Vienna",
      endTzid: "Europe/Vienna",
    });
    const lines = capturedICS.split(/\r?\n/);
    expect(lines).toContain("DTSTART;TZID=Europe/Vienna:20260928T130000");
    expect(lines).toContain("DTEND;TZID=Europe/Vienna:20260928T140000");
  });

  test("a TZID value follows the zone's winter offset", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      start: new Date("2026-01-28T11:00:00Z"),
      end: new Date("2026-01-28T12:00:00Z"),
      startTzid: "Europe/Vienna",
      endTzid: "America/New_York",
    });
    const lines = capturedICS.split(/\r?\n/);
    expect(lines).toContain("DTSTART;TZID=Europe/Vienna:20260128T120000");
    expect(lines).toContain("DTEND;TZID=America/New_York:20260128T070000");
  });

  test("an unknown TZID falls back to plain UTC without the parameter", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      start: new Date("2026-09-28T11:00:00Z"),
      end: new Date("2026-09-28T12:00:00Z"),
      startTzid: "W. Europe Standard Time",
      endTzid: "W. Europe Standard Time",
    });
    const lines = capturedICS.split(/\r?\n/);
    expect(lines).toContain("DTSTART:20260928T110000Z");
    expect(lines).toContain("DTEND:20260928T120000Z");
  });

  test("createEvent writes TZID values the same way", async () => {
    await makeClient().createEvent(CAL, {
      summary: "Team Sync",
      start: new Date("2026-09-28T11:00:00Z"),
      end: new Date("2026-09-28T12:00:00Z"),
      startTzid: "Europe/Vienna",
      endTzid: "Europe/Vienna",
    });
    const lines = capturedICS.split(/\r?\n/);
    expect(lines).toContain("DTSTART;TZID=Europe/Vienna:20260928T130000");
    expect(lines.some((l) => /^DT(START|END).*Z$/.test(l))).toBe(false);
  });

  test("a TZID event round-trips through the parser at the same instant", async () => {
    const start = new Date("2026-09-28T11:00:00Z");
    const end = new Date("2026-09-28T12:00:00Z");
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      start,
      end,
      startTzid: "Europe/Vienna",
      endTzid: "Europe/Vienna",
    });

    const [parsed] = await parseEvents(wrapCalendarData(capturedICS));
    expect(parsed.start.toISOString()).toBe(start.toISOString());
    expect(parsed.end.toISOString()).toBe(end.toISOString());
    expect(parsed.startTzid).toBe("Europe/Vienna");
  });
});

// ── VEVENT – status ───────────────────────────────────────────────────────────

describe("buildICSData – status", () => {
  test("STATUS is emitted when set", async () => {
    await makeClient().updateEvent(CAL, { ...BASE_EVENT, status: "CONFIRMED" });
    expect(vevent().getFirstPropertyValue("status")).toBe("CONFIRMED");
  });

  test("STATUS is omitted when unset", async () => {
    await makeClient().updateEvent(CAL, { ...BASE_EVENT });
    expect(vevent().getFirstProperty("status")).toBeNull();
  });
});

// ── VEVENT – recurrence exceptions ────────────────────────────────────────────

describe("buildICSData – recurrence exceptions", () => {
  test("EXDATE and RDATE are emitted as date-time value lists", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      recurrenceRule: { freq: "WEEKLY" },
      exdates: [
        new Date("2026-10-12T09:00:00Z"),
        new Date("2026-11-02T09:00:00Z"),
      ],
      rdates: [new Date("2026-11-07T09:00:00Z")],
    });

    const v = vevent();
    expect(
      v
        .getFirstProperty("exdate")!
        .getValues()
        .map((t) => (t as ICAL.Time).toICALString()),
    ).toEqual(["20261012T090000Z", "20261102T090000Z"]);
    expect(
      (v.getFirstProperty("rdate")!.getFirstValue() as ICAL.Time).toICALString(),
    ).toBe("20261107T090000Z");
  });

  test("RECURRENCE-ID is emitted for an override", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      recurrenceId: new Date("2026-10-19T09:00:00Z"),
    });

    expect(
      (
        vevent().getFirstProperty("recurrence-id")!.getFirstValue() as ICAL.Time
      ).toICALString(),
    ).toBe("20261019T090000Z");
  });

  test("whole-day series use DATE values for exceptions", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      wholeDay: true,
      start: new Date("2026-10-05T00:00:00Z"),
      end: new Date("2026-10-06T00:00:00Z"),
      exdates: [new Date("2026-10-12T00:00:00Z")],
    });

    const exdate = vevent().getFirstProperty("exdate")!;
    expect((exdate.getFirstValue() as ICAL.Time).isDate).toBe(true);
    expect((exdate.getFirstValue() as ICAL.Time).toICALString()).toBe(
      "20261012",
    );
  });
});

// ── VEVENT – custom fields ────────────────────────────────────────────────────

describe("buildICSData – custom fields", () => {
  test("scalar custom field is emitted", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      customFields: { "x-my-field": "hello", color: "red" },
    });
    const v = vevent();
    expect(v.getFirstPropertyValue("x-my-field")).toBe("hello");
    expect(v.getFirstPropertyValue("color")).toBe("red");
  });

  test("array custom field emits multiple properties", async () => {
    await makeClient().updateEvent(CAL, {
      ...BASE_EVENT,
      customFields: { categories: ["Work", "Personal"] },
    });
    const cats = vevent()
      .getAllProperties("categories")
      .map((p) => p.getFirstValue());
    expect(cats).toEqual(["Work", "Personal"]);
  });
});

// ── VTODO – DTSTAMP ───────────────────────────────────────────────────────────

describe("buildTodoICSData – DTSTAMP", () => {
  test("appears exactly once", async () => {
    await makeClient().updateTodo(CAL, { ...BASE_TODO });
    expect(vtodo().getAllProperties("dtstamp")).toHaveLength(1);
  });
});

// ── VTODO – core fields ───────────────────────────────────────────────────────

describe("buildTodoICSData – core fields", () => {
  test("UID and SUMMARY are present", async () => {
    await makeClient().updateTodo(CAL, { ...BASE_TODO });
    const v = vtodo();
    expect(v.getFirstPropertyValue("uid")).toBe("todo-1");
    expect(v.getFirstPropertyValue("summary")).toBe("Test Todo");
  });

  test("DUE is emitted when set", async () => {
    await makeClient().updateTodo(CAL, {
      ...BASE_TODO,
      due: new Date("2026-03-20T12:00:00Z"),
    });
    expect(vtodo().getFirstProperty("due")).toBeTruthy();
  });

  test("COMPLETED is emitted when set", async () => {
    await makeClient().updateTodo(CAL, {
      ...BASE_TODO,
      completed: new Date("2026-03-18T09:00:00Z"),
    });
    expect(vtodo().getFirstProperty("completed")).toBeTruthy();
  });
});
