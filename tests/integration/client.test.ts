import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.CALDAV_BASE_URL;

describe.skipIf(skip)("CalDAV – credential validation", () => {
  test("valid credentials initialize the client successfully", async () => {
    const client = await CalDAVClient.create({
      baseUrl: process.env.CALDAV_BASE_URL!,
      auth: {
        type: "basic",
        username: process.env.CALDAV_USERNAME!,
        password: process.env.CALDAV_PASSWORD!,
      },
    });
    expect(client).toBeInstanceOf(CalDAVClient);
  });

  test("invalid credentials throw an error", async () => {
    await expect(
      CalDAVClient.create({
        baseUrl: process.env.CALDAV_BASE_URL!,
        auth: { type: "basic", username: "invalid", password: "invalid" },
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(skip)("CalDAV – event operations", () => {
  let client: CalDAVClient;
  let calendarUrl: string;

  const range = () => ({
    start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  beforeAll(async () => {
    client = await CalDAVClient.create({
      baseUrl: process.env.CALDAV_BASE_URL!,
      auth: {
        type: "basic",
        username: process.env.CALDAV_USERNAME!,
        password: process.env.CALDAV_PASSWORD!,
      },
      requestTimeout: 30000,
    });
    const calendars = await client.getCalendars();
    calendarUrl =
      calendars.find((c) => c.supportedComponents.includes("VEVENT"))?.url ??
      calendars[0].url;
  });

  test("getCalendarHome returns a value", () => {
    expect(client.getCalendarHome()).toBeDefined();
  });

  test("create and fetch event", async () => {
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Integration Test Event",
    });
    const events = await client.getEvents(calendarUrl, range());
    const found = events.find((e) => e.uid === uid);
    expect(found?.summary).toBe("Integration Test Event");
    await client.deleteEvent(calendarUrl, uid);
  });

  test("duplicate uid is rejected", async () => {
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Original",
    });
    await expect(
      client.createEvent(calendarUrl, {
        start: now,
        end: new Date(now.getTime() + 3_600_000),
        summary: "Duplicate",
        uid,
      }),
    ).rejects.toThrow("already exists");
    await client.deleteEvent(calendarUrl, uid);
  });

  test("whole-day event round-trips", async () => {
    const today = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: today,
      end: new Date(today.getTime() + 86_400_000),
      summary: "Whole Day",
      wholeDay: true,
    });
    const events = await client.getEvents(calendarUrl, range());
    const found = events.find((e) => e.uid === uid);
    expect(found?.wholeDay).toBe(true);
    await client.deleteEvent(calendarUrl, uid);
  });

  test("sync and getEventsByHref", async () => {
    const ctag = await client.getCtag(calendarUrl);
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Sync Test",
    });
    const sync = await client.syncChanges(calendarUrl, ctag, []);
    const fetched = await client.getEventsByHref(calendarUrl, sync.newEvents);
    expect(fetched.length).toBeGreaterThan(0);
    await client.deleteEvent(calendarUrl, uid);
  });

  test("getETag returns a non-empty string", async () => {
    const now = new Date();
    const { uid, href } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "ETag Test",
    });
    const etag = await client.getETag(href);
    expect(typeof etag).toBe("string");
    expect(etag.length).toBeGreaterThan(0);
    await client.deleteEvent(calendarUrl, uid);
  });

  test("update event", async () => {
    const now = new Date();
    const { uid, href } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Before Update",
    });
    const etag = await client.getETag(href);
    const { href: updatedHref } = await client.updateEvent(calendarUrl, {
      uid,
      href,
      etag,
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "After Update",
    });
    const [updated] = await client.getEventsByHref(calendarUrl, [updatedHref]);
    expect(updated.summary).toBe("After Update");
    await client.deleteEvent(calendarUrl, uid);
  });

  test("round-trip update (parse → spread → updateEvent) does not produce duplicate DTSTAMP", async () => {
    const now = new Date();
    const { uid, href } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Round-trip Before",
    });
    const [existing] = await client.getEventsByHref(calendarUrl, [href]);
    await client.updateEvent(calendarUrl, {
      ...existing,
      summary: "Round-trip After",
    });
    const [updated] = await client.getEventsByHref(calendarUrl, [href]);
    expect(updated.summary).toBe("Round-trip After");
    await client.deleteEvent(calendarUrl, uid);
  });

  test("update event twice with new etag each time", async () => {
    const now = new Date();
    const { uid, href } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "First",
    });
    const etag1 = await client.getETag(href);
    const res2 = await client.updateEvent(calendarUrl, {
      uid,
      href,
      etag: etag1,
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Second",
    });
    await new Promise((r) => setTimeout(r, 2000));
    await client.updateEvent(calendarUrl, {
      uid,
      href,
      etag: res2.etag,
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Third",
    });
    const [final] = await client.getEventsByHref(calendarUrl, [href]);
    expect(final.summary).toBe("Third");
    await client.deleteEvent(calendarUrl, uid);
  });
});
