import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.CALDAV_BASE_URL;

describe.skipIf(skip)("CalDAV – timezone handling", () => {
  let client: CalDAVClient;
  let calendarUrl: string;

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

  test("Europe/Berlin TZID round-trips", async () => {
    const { uid, href } = await client.createEvent(calendarUrl, {
      start: new Date("2025-07-01T09:00:00"),
      end: new Date("2025-07-01T10:00:00"),
      summary: "Berlin TZ Event",
      startTzid: "Europe/Berlin",
      endTzid: "Europe/Berlin",
    });

    const events = await client.getEvents(calendarUrl, {
      start: new Date("2025-06-30T00:00:00Z"),
      end: new Date("2025-07-02T00:00:00Z"),
    });
    const found = events.find((e) => e.uid === uid);
    expect(found?.startTzid).toBe("Europe/Berlin");
    expect(found?.endTzid).toBe("Europe/Berlin");

    await client.deleteEvent(calendarUrl, uid);
    void href;
  });

  test("UTC event has no TZID (or Etc/UTC)", async () => {
    const { uid } = await client.createEvent(calendarUrl, {
      start: new Date("2025-08-01T12:00:00Z"),
      end: new Date("2025-08-01T13:00:00Z"),
      summary: "UTC Event",
    });

    const events = await client.getEvents(calendarUrl, {
      start: new Date("2025-08-01T00:00:00Z"),
      end: new Date("2025-08-02T00:00:00Z"),
    });
    const found = events.find((e) => e.uid === uid);
    expect(["Etc/UTC", undefined]).toContain(found?.startTzid);
    expect(["Etc/UTC", undefined]).toContain(found?.endTzid);

    await client.deleteEvent(calendarUrl, uid);
  });
});
