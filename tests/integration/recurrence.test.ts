import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.CALDAV_BASE_URL;

describe.skipIf(skip)("CalDAV – recurring events", () => {
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
    calendarUrl = calendars[0].url;
  });

  test("weekly recurrence round-trips", async () => {
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Weekly Recurrence",
      recurrenceRule: { freq: "WEEKLY", interval: 1, count: 5 },
    });

    const events = await client.getEvents(calendarUrl, {
      start: new Date(Date.now() - 7 * 86_400_000),
      end: new Date(Date.now() + 30 * 86_400_000),
    });
    const found = events.find((e) => e.uid === uid);
    expect(found?.recurrenceRule?.freq).toBe("WEEKLY");
    expect(found?.recurrenceRule?.count).toBe(5);

    await client.deleteEvent(calendarUrl, uid);
  });

  test("daily byday recurrence round-trips", async () => {
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Weekdays",
      recurrenceRule: {
        freq: "DAILY",
        interval: 1,
        count: 10,
        byday: ["MO", "TU", "WE", "TH", "FR"],
      },
    });

    const events = await client.getEvents(calendarUrl, {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const found = events.find((e) => e.uid === uid);
    expect(found?.recurrenceRule?.freq).toBe("DAILY");
    expect(found?.recurrenceRule?.byday).toEqual(["MO", "TU", "WE", "TH", "FR"]);

    await client.deleteEvent(calendarUrl, uid);
  });
});
