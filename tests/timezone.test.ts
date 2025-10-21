import { CalDAVClient } from "../src/client";
import dotenv from "dotenv";

dotenv.config();

describe("Timezone Event Handling", () => {
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
  let timezoneEventUid: string;

  test("Create event with Europe/Berlin time zone", async () => {
    const berlinStart = new Date("2025-07-01T09:00:00");
    const berlinEnd = new Date("2025-07-01T10:00:00");

    const res = await client.createEvent(calendarUrl, {
      start: berlinStart,
      end: berlinEnd,
      summary: "Berlin TZ Event",
      startTzid: "Europe/Berlin",
      endTzid: "Europe/Berlin",
    });

    timezoneEventUid = res.uid;
    expect(res.uid).toBeDefined();
  });

  test("Fetch and verify Europe/Berlin time zone", async () => {
    const events = await client.getEvents(calendarUrl, {
      start: new Date("2025-06-30T00:00:00Z"),
      end: new Date("2025-07-02T00:00:00Z"),
    });

    const event = events.find((e) => e.uid === timezoneEventUid);
    expect(event).toBeDefined();
    expect(event?.startTzid).toBe("Europe/Berlin");
    expect(event?.endTzid).toBe("Europe/Berlin");
  });

  test("Create event in UTC", async () => {
    const utcStart = new Date("2025-08-01T12:00:00Z");
    const utcEnd = new Date("2025-08-01T13:00:00Z");

    const res = await client.createEvent(calendarUrl, {
      start: utcStart,
      end: utcEnd,
      summary: "UTC Event",
    });

    timezoneEventUid = res.uid;
    expect(res.uid).toBeDefined();
  });

  test("Fetch and verify UTC event (no TZID)", async () => {
    const events = await client.getEvents(calendarUrl, {
      start: new Date("2025-08-01T00:00:00Z"),
      end: new Date("2025-08-02T00:00:00Z"),
    });

    const event = events.find((e) => e.uid === timezoneEventUid);
    expect(event).toBeDefined();
    expect(["Etc/UTC", undefined]).toContain(event?.startTzid);
    expect(["Etc/UTC", undefined]).toContain(event?.endTzid);
  });

  // test("Clean up timezone events", async () => {
  //   await client.deleteEvent(calendarUrl, timezoneEventUid);
  // });
});
