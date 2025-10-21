import { CalDAVClient } from "../src/client";
import { CalDAVClientCache } from "../src/models";
import dotenv from "dotenv";

dotenv.config();

let cache: CalDAVClientCache;

describe("CalDAVClient Cache Operations", () => {
  test("Export cache from client", async () => {
    const client = await CalDAVClient.create({
      baseUrl: process.env.CALDAV_BASE_URL!,
      auth: {
        type: "basic",
        username: process.env.CALDAV_USERNAME!,
        password: process.env.CALDAV_PASSWORD!,
      },
      requestTimeout: 30000,
    });

    cache = client.exportCache();

    expect(cache).toBeDefined();
    expect(cache.userPrincipal).toBeDefined();
    expect(cache.calendarHome).toBeDefined();
  });

  test("Create client from cache", async () => {
    const client = CalDAVClient.createFromCache(
      {
        baseUrl: process.env.CALDAV_BASE_URL!,
        auth: {
          type: "basic",
          username: process.env.CALDAV_USERNAME!,
          password: process.env.CALDAV_PASSWORD!,
        },
        requestTimeout: 30000,
      },
      cache
    );

    // verify the client functions by invoking a method that calls the server
    const calendars = await client.getCalendars();

    expect(calendars).toBeDefined();
    expect(Array.isArray(calendars)).toBe(true);
    expect(client).toBeInstanceOf(CalDAVClient);
    expect(client.userPrincipal).toBe(cache.userPrincipal);
    expect(client.calendarHome).toBe(cache.calendarHome);
    expect(client).toBeDefined();
    expect(client.getCalendarHome()).toBe(cache.calendarHome);
  });
});
