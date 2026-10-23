import { describe, expect, test, vi } from "vitest";
import { CalDAVError } from "../../src/errors";
import { createItem, deleteItem, updateItem } from "../../src/protocol/crud";

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
      sequence: 1,
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
      sequence: 1,
    });
  });
});

describe("deleteItem", () => {
  const mkClient = (
    impl: (url: string, options: { headers: Record<string, string> }) => unknown,
  ) => ({ delete: vi.fn(impl as never) });

  test("uses the item href instead of guessing from the uid", async () => {
    // Nextcloud & co. store an item under a server-chosen filename.
    const href = `${calendarUrl}nextcloud-slug-1234.ics`;
    const httpClient = mkClient(async (url) => {
      if (url !== href) throw new CalDAVError("HTTP 404", 404);
      return { status: 204, headers: {}, data: "", url };
    });

    await expect(
      deleteItem(
        calendarUrl,
        { uid: "uid-differs-from-filename", href },
        "event",
        httpClient as never,
      ),
    ).resolves.toBeUndefined();
    expect(httpClient.delete).toHaveBeenCalledTimes(1);
  });

  test("falls back to a uid lookup when the guessed href is a 404", async () => {
    const realHref = `${calendarUrl}server-chosen.ics`;
    const httpClient = mkClient(async (url) => {
      if (url !== realHref) throw new CalDAVError("HTTP 404", 404);
      return { status: 204, headers: {}, data: "", url };
    });
    const resolveHrefByUid = vi.fn(async () => realHref);

    await expect(
      deleteItem(calendarUrl, "event-1", "event", httpClient as never, undefined, {
        resolveHrefByUid,
      }),
    ).resolves.toBeUndefined();
    expect(resolveHrefByUid).toHaveBeenCalledWith(calendarUrl, "event-1");
    expect(httpClient.delete).toHaveBeenCalledTimes(2);
  });

  test("reports the original 404 when the uid cannot be resolved", async () => {
    const httpClient = mkClient(async () => {
      throw new CalDAVError("HTTP 404", 404);
    });

    await expect(
      deleteItem(calendarUrl, "event-1", "event", httpClient as never, undefined, {
        resolveHrefByUid: async () => undefined,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("does not send a weak etag as an If-Match validator", async () => {
    const httpClient = mkClient(async (url, options) => {
      if (options.headers["If-Match"] !== "*")
        throw new CalDAVError("HTTP 412", 412);
      return { status: 204, headers: {}, data: "", url };
    });

    await expect(
      deleteItem(calendarUrl, "event-1", "event", httpClient as never, 'W/"e1"'),
    ).resolves.toBeUndefined();
  });

  test("sends a strong etag as If-Match, stripped of surrounding whitespace", async () => {
    const seen: string[] = [];
    const httpClient = mkClient(async (url, options) => {
      seen.push(options.headers["If-Match"]);
      return { status: 204, headers: {}, data: "", url };
    });

    await deleteItem(calendarUrl, "event-1", "event", httpClient as never, '"e1" ');
    expect(seen).toEqual(['"e1"']);
  });

  test("takes the etag from the passed item when none is given", async () => {
    const seen: string[] = [];
    const httpClient = mkClient(async (url, options) => {
      seen.push(options.headers["If-Match"]);
      return { status: 204, headers: {}, data: "", url };
    });

    await deleteItem(
      calendarUrl,
      { uid: "event-1", href: `${calendarUrl}event-1.ics`, etag: '"e1"' },
      "event",
      httpClient as never,
    );
    expect(seen).toEqual(['"e1"']);
  });

  test("requires either a uid or an href", async () => {
    await expect(
      deleteItem(calendarUrl, {}, "event", mkClient(async () => ({})) as never),
    ).rejects.toThrow(/uid.*href/);
  });
});

describe("error wrapping", () => {
  test("a 412 on update keeps the server's body and precondition (#31)", async () => {
    const put = vi.fn(async () => {
      throw new CalDAVError("HTTP 412", 412, {
        responseBody: "<D:error><OX:code>CAL-4121</OX:code></D:error>",
        precondition: "code",
      });
    });

    const error = await updateItem(
      calendarUrl,
      { uid: "event-1", href: `${calendarUrl}event-1.ics` },
      build,
      "event",
      put,
      async () => "",
      (u) => u,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(CalDAVError);
    expect(error.message).toBe("Event with the specified uid does not match.");
    expect(error.status).toBe(412);
    expect(error.responseBody).toContain("CAL-4121");
    expect(error.precondition).toBe("code");
    expect(error.cause).toBeInstanceOf(CalDAVError);
  });

  test("a generic failure on create keeps the status and body", async () => {
    const put = vi.fn(async () => {
      throw new CalDAVError("HTTP 400", 400, { responseBody: "bad rrule" });
    });

    const error = await createItem(
      calendarUrl,
      data,
      build,
      "event",
      put,
      async () => "",
    ).catch((e) => e);

    expect(error.message).toBe("Failed to create event.");
    expect(error.status).toBe(400);
    expect(error.responseBody).toBe("bad rrule");
  });

  test("updateItem sends the item's sequence plus one to the builder", async () => {
    const seen = vi.fn((item: { sequence?: number }) => {
      return `SEQ:${item.sequence}`;
    });
    const put = vi.fn(async () => ({ status: 204, headers: {}, data: "", url: "" }));

    const result = await updateItem(
      calendarUrl,
      { uid: "event-1", href: `${calendarUrl}event-1.ics`, sequence: 4 },
      seen,
      "event",
      put,
      async () => "",
      (u) => u,
    );

    expect(seen.mock.calls[0][0].sequence).toBe(5);
    expect(result.sequence).toBe(5);
  });
});
