import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";
import type { CalDAVClientCache } from "../../src/models";

const skip = !process.env.CALDAV_BASE_URL;

describe.skipIf(skip)("CalDAV – client cache", () => {
  let cache: CalDAVClientCache;

  beforeAll(async () => {
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
  });

  test("exportCache returns principal and home", () => {
    expect(cache.userPrincipal).toBeDefined();
    expect(cache.calendarHome).toBeDefined();
  });

  test("createFromCache restores a working client", async () => {
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
      cache,
    );

    const calendars = await client.getCalendars();
    expect(Array.isArray(calendars)).toBe(true);
    expect(client.userPrincipal).toBe(cache.userPrincipal);
    expect(client.calendarHome).toBe(cache.calendarHome);
  });
});
