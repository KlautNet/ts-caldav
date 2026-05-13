import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.ICLOUD_USERNAME;

describe.skipIf(skip)("iCloud CalDAV – sync", () => {
  let client: CalDAVClient;
  let calendarUrl: string;
  let testEventUid: string;
  let originalCtag: string;

  beforeAll(async () => {
    client = await CalDAVClient.create({
      baseUrl: "https://caldav.icloud.com",
      auth: {
        type: "basic",
        username: process.env.ICLOUD_USERNAME!,
        password: process.env.ICLOUD_PASSWORD!,
      },
    });
    const calendars = await client.getCalendars();
    calendarUrl = calendars[1].url;
    originalCtag = await client.getCtag(calendarUrl);
  });

  test("create event", async () => {
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "iCloud Sync Test Event",
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
      "iCloud Sync Test Event",
    );
  });

  test("delete event", async () => {
    const events = await client.getEvents(calendarUrl);
    const target = events.find((e) => e.uid === testEventUid);
    expect(target).toBeDefined();
    await client.deleteEvent(calendarUrl, target!.uid, target!.etag);
  });

  test("update event twice with new etag each time", async () => {
    const now = new Date();
    const { uid, href } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "iCloud Update Test",
    });
    const etag1 = await client.getETag(href);
    const res2 = await client.updateEvent(calendarUrl, {
      uid,
      href,
      etag: etag1,
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Updated Once",
    });
    await new Promise((r) => setTimeout(r, 2000));
    await client.updateEvent(calendarUrl, {
      uid,
      href,
      etag: res2.etag,
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Updated Twice",
    });
    const [final] = await client.getEventsByHref(calendarUrl, [href]);
    expect(final.summary).toBe("Updated Twice");
    await client.deleteEvent(calendarUrl, uid, final.etag);
  });
});
