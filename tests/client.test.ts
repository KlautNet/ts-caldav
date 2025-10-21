import { CalDAVClient } from "../src/client";
import dotenv from "dotenv";

dotenv.config();

const getDateRange = () => ({
  start: new Date(Date.now() - 24 * 60 * 60 * 1000),
  end: new Date(Date.now() + 24 * 60 * 60 * 1000),
});

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

describe("CalDAVClient Credential Validation", () => {
  test("Valid credentials initialize the client successfully", async () => {
    const testClient = await CalDAVClient.create({
      baseUrl: process.env.CALDAV_BASE_URL!,
      auth: {
        type: "basic",
        username: process.env.CALDAV_USERNAME!,
        password: process.env.CALDAV_PASSWORD!,
      },
    });
    expect(testClient).toBeInstanceOf(CalDAVClient);
  });

  test("Invalid credentials throw an error", async () => {
    await expect(
      CalDAVClient.create({
        baseUrl: process.env.CALDAV_BASE_URL!,
        auth: {
          type: "basic",
          username: "invalid",
          password: "invalid",
        },
      })
    ).rejects.toThrow("Request failed with status code 401");
  });
});

describe("CalDAVClient Calendar Operations", () => {
  let eventUid: string;
  let eventHrefs: string[] = [];
  let changeTag: string = "";

  test("Fetch calendar home", () => {
    expect(client.getCalendarHome()).toBeDefined();
  });

  test("Create and fetch event", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 3600000); // +1h

    const { uid } = await client.createEvent(calendarUrl, {
      start: now,
      end,
      summary: "Test Event",
    });

    eventUid = uid;

    const events = await client.getEvents(calendarUrl, getDateRange());
    const created = events.find((e) => e.uid === uid);

    expect(created).toBeDefined();
    expect(created?.summary).toBe("Test Event");
  });

  test("Duplicate event creation fails", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 3600000);

    await expect(
      client.createEvent(calendarUrl, {
        start: now,
        end,
        summary: "Duplicate",
        uid: eventUid,
      })
    ).rejects.toThrow("already exists");
  });

  test("Delete created event", async () => {
    await client.deleteEvent(calendarUrl, eventUid);
  });

  test("Sync events and get by href", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 3600000);
    changeTag = await client.getCtag(calendarUrl);

    const res = await client.createEvent(calendarUrl, {
      start: now,
      end,
      summary: "Sync Test Event",
    });

    eventUid = res.uid;

    const sync = await client.syncChanges(calendarUrl, changeTag, []);
    eventHrefs = [...sync.newEvents, ...sync.updatedEvents];

    const fetched = await client.getEventsByHref(calendarUrl, eventHrefs);
    expect(fetched.length).toBeGreaterThan(0);
  });

  test("Whole day event", async () => {
    const today = new Date();
    const res = await client.createEvent(calendarUrl, {
      start: today,
      end: new Date(today.getTime() + 86400000),
      summary: "Whole Day",
      wholeDay: true,
    });

    const events = await client.getEvents(calendarUrl, getDateRange());
    const found = events.find((e) => e.uid === res.uid);

    expect(found).toBeDefined();
    expect(found?.wholeDay).toBe(true);

    await client.deleteEvent(calendarUrl, res.uid);
  });

  test("Clean up sync event", async () => {
    await client.deleteEvent(calendarUrl, eventUid);
  });

  test("Fetch ETag using getETag", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 3600000);

    const { uid, href } = await client.createEvent(calendarUrl, {
      start: now,
      end,
      summary: "ETag Fetch Test",
    });

    const etag = await client.getETag(href);

    expect(typeof etag).toBe("string");
    expect(etag.length).toBeGreaterThan(0);

    await client.deleteEvent(calendarUrl, uid);
  });

  test("Update event", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 3600000);

    const createRes = await client.createEvent(calendarUrl, {
      start: now,
      end,
      summary: "Original Title",
    });

    const etag = await client.getETag(createRes.href);

    const updated = await client.updateEvent(calendarUrl, {
      uid: createRes.uid,
      href: createRes.href,
      etag,
      start: now,
      end,
      summary: "Updated Title",
    });

    const events = await client.getEventsByHref(calendarUrl, [updated.href]);
    const updatedEvent = events.find((e) => e.href === updated.href);

    expect(updatedEvent).toBeDefined();
    expect(updatedEvent?.summary).toBe("Updated Title");

    await client.deleteEvent(calendarUrl, updated.uid);
  });

  test("Update event 2x", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 3600000);

    const createRes = await client.createEvent(calendarUrl, {
      start: now,
      end,
      summary: "Original Title",
    });

    const etag = await client.getETag(createRes.href);

    const updated = await client.updateEvent(calendarUrl, {
      uid: createRes.uid,
      href: createRes.href,
      etag,
      start: now,
      end,
      summary: "Updated Title",
    });

    // wait a bit to ensure the ETag changes
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const newUpdated = await client.updateEvent(calendarUrl, {
      uid: createRes.uid,
      href: createRes.href,
      etag: updated.etag,
      start: now,
      end,
      summary: "Updated Title",
    });

    const events = await client.getEventsByHref(calendarUrl, [newUpdated.href]);
    const updatedEvent = events.find((e) => e.href === newUpdated.href);

    expect(updatedEvent).toBeDefined();
    expect(updatedEvent?.summary).toBe("Updated Title");

    await client.deleteEvent(calendarUrl, newUpdated.uid);
  });
});
