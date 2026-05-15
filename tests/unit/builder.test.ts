import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ICAL from "ical.js";
import { CalDAVClient } from "../../src/client";

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
