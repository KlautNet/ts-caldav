import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.ACCESS_TOKEN;

describe.skipIf(skip)("Google CalDAV – OAuth sync", () => {
  let client: CalDAVClient;
  let calendarUrl: string;
  let testEventUid: string;
  let originalCtag: string;

  beforeAll(async () => {
    client = await CalDAVClient.create({
      baseUrl: "https://apidata.googleusercontent.com/",
      auth: { type: "oauth", accessToken: process.env.ACCESS_TOKEN! },
      requestTimeout: 30000,
    });
    const calendars = await client.getCalendars();
    calendarUrl = calendars[0].url;
    originalCtag = await client.getCtag(calendarUrl);
  });

  test("create event", async () => {
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Google Sync Test Event",
      description: "OAuth Google Sync Test",
    });
    testEventUid = uid;
    const events = await client.getEvents(calendarUrl);
    expect(events.find((e) => e.uid === uid)).toBeDefined();
  });

  test("syncChanges detects new event", async () => {
    const sync = await client.syncChanges(calendarUrl, originalCtag, []);
    expect(sync.changed).toBe(true);
    expect(sync.newEvents.some((h) => h.includes(testEventUid))).toBe(true);
  });

  test("getEventsByHref returns the created event", async () => {
    const sync = await client.syncChanges(calendarUrl, originalCtag, []);
    const events = await client.getEventsByHref(calendarUrl, sync.newEvents);
    expect(events.find((e) => e.uid === testEventUid)?.summary).toContain(
      "Google Sync Test Event",
    );
  });

  test("delete event", async () => {
    await client.deleteEvent(calendarUrl, testEventUid);
    const events = await client.getEvents(calendarUrl);
    expect(events.find((e) => e.uid === testEventUid)).toBeUndefined();
  });
});
