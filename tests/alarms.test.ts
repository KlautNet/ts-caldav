import { CalDAVClient } from "../src/client";
import dotenv from "dotenv";

dotenv.config();

describe("Alarm Handling", () => {
  let client: CalDAVClient;
  let calendarUrl: string;
  let alarmUid: string;

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

  test("Create event with multiple alarms", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 3600000); // 1 hour later

    const res = await client.createEvent(calendarUrl, {
      start: now,
      end,
      summary: "Meeting with Alarms",
      alarms: [
        {
          action: "DISPLAY",
          trigger: "-PT30M",
          description: "Popup reminder",
        },
        {
          action: "AUDIO",
          trigger: "-PT15M",
        },
      ],
    });

    alarmUid = res.uid;
    expect(alarmUid).toBeDefined();
  });

  test("Verify event alarms are parsed correctly", async () => {
    const events = await client.getEvents(calendarUrl, {
      start: new Date(Date.now() - 86400000),
      end: new Date(Date.now() + 86400000),
    });

    const evt = events.find((e) => e.uid === alarmUid);
    expect(evt).toBeDefined();
    expect(evt!.alarms).toBeDefined();
    expect(evt!.alarms!.length).toBeGreaterThanOrEqual(2);

    const actions = evt!.alarms!.map((a) => a.action).sort();
    expect(actions).toEqual(["AUDIO", "DISPLAY"].sort());
  });

  test("Delete event with alarms", async () => {
    await client.deleteEvent(calendarUrl, alarmUid);
  });
});
