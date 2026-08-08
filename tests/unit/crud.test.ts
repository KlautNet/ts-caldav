import { describe, expect, test, vi } from "vitest";
import { createItem, updateItem } from "../../src/protocol/crud";

const calendarUrl = "https://example.test/calendars/user/default/";
const data = { uid: "event-1" };
const build = vi.fn(() => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");

describe("createItem", () => {
  test("accepts any successful PUT status", async () => {
    const put = vi.fn(
      async (
        _href: string,
        _ics: string,
        _headers: Record<string, string> | undefined,
        validate: ((status: number) => boolean) | undefined,
      ) => {
        expect(validate?.(200)).toBe(true);
        return {
          status: 200,
          headers: { etag: '"event-etag"' },
          data: "",
          url: `${calendarUrl}event-1.ics`,
        };
      },
    );

    await expect(
      createItem(calendarUrl, data, build, "event", put, async () => "ctag-2"),
    ).resolves.toEqual({
      uid: "event-1",
      href: `${calendarUrl}event-1.ics`,
      etag: '"event-etag"',
      newCtag: "ctag-2",
    });
  });

  test("does not reject a committed PUT when the CTag lookup fails", async () => {
    const put = vi.fn(async () => ({
      status: 201,
      headers: {},
      data: "",
      url: `${calendarUrl}event-1.ics`,
    }));

    await expect(
      createItem(calendarUrl, data, build, "event", put, async () => {
        throw new Error("getctag is not supported");
      }),
    ).resolves.toEqual({
      uid: "event-1",
      href: `${calendarUrl}event-1.ics`,
      etag: "",
      newCtag: "",
    });
  });
});

describe("updateItem", () => {
  const item = { uid: "event-1", href: `${calendarUrl}event-1.ics` };
  const absolutize = (urlOrPath: string) => urlOrPath;

  test("returns the refreshed CTag when the lookup succeeds", async () => {
    const put = vi.fn(async () => ({
      status: 204,
      headers: { etag: '"event-etag-2"' },
      data: "",
      url: item.href,
    }));

    await expect(
      updateItem(
        calendarUrl,
        item,
        build,
        "event",
        put,
        async () => "ctag-2",
        absolutize,
      ),
    ).resolves.toEqual({
      uid: "event-1",
      href: item.href,
      etag: '"event-etag-2"',
      newCtag: "ctag-2",
    });
  });

  test("does not reject a committed PUT when the CTag lookup fails", async () => {
    const put = vi.fn(async () => ({
      status: 204,
      headers: { etag: '"event-etag-2"' },
      data: "",
      url: item.href,
    }));

    await expect(
      updateItem(
        calendarUrl,
        item,
        build,
        "event",
        put,
        async () => {
          throw new Error("getctag is not supported");
        },
        absolutize,
      ),
    ).resolves.toEqual({
      uid: "event-1",
      href: item.href,
      etag: '"event-etag-2"',
      newCtag: "",
    });
  });
});
