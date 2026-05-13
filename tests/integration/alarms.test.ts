import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.CALDAV_BASE_URL;

describe.skipIf(skip)("CalDAV – alarm handling", () => {
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

  test("event alarms round-trip correctly", async () => {
    const now = new Date();
    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end: new Date(now.getTime() + 3_600_000),
      summary: "Meeting with Alarms",
      alarms: [
        { action: "DISPLAY", trigger: "-PT30M", description: "Popup reminder" },
        { action: "AUDIO", trigger: "-PT15M" },
      ],
    });

    const events = await client.getEvents(calendarUrl, {
      start: new Date(Date.now() - 86_400_000),
      end: new Date(Date.now() + 86_400_000),
    });

    const evt = events.find((e) => e.uid === uid);
    expect(evt?.alarms?.length).toBeGreaterThanOrEqual(2);

    const actions = evt!.alarms!.map((a) => a.action).sort();
    expect(actions).toEqual(["AUDIO", "DISPLAY"]);

    await client.deleteEvent(calendarUrl, uid);
  });
});
