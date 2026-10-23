import { afterEach, describe, expect, test, vi } from "vitest";
import HttpClient from "../../src/http-client";
import { CalDAVError } from "../../src/errors";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HttpClient", () => {
  test("resolves relative request URLs against the base URL", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient("https://example.test/base/", {
      type: "basic",
      username: "test",
      password: "test",
    });

    await client.request({ method: "PROPFIND", url: "/test/calendar/" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/test/calendar/",
      expect.any(Object),
    );
  });

  test("aborts requests after the configured timeout", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient(
      "https://example.test/",
      {
        type: "basic",
        username: "test",
        password: "test",
      },
      true,
      {},
      25,
    );

    const request = client.request({ method: "PROPFIND", url: "/slow/" });
    const assertion = expect(request).rejects.toThrow(
      "Request timed out after 25ms: PROPFIND https://example.test/slow/",
    );

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  test("throws a CalDAVError carrying the status on a failed response", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient("https://example.test/", {
      type: "basic",
      username: "test",
      password: "test",
    });

    const error = await client
      .request({ method: "PROPFIND", url: "/missing/" })
      .catch((e) => e);

    expect(error).toBeInstanceOf(CalDAVError);
    expect(error.status).toBe(404);
    expect(error.responseBody).toBe("nope");
    expect(error.precondition).toBeUndefined();
  });

  test("keeps the response body and the DAV:error precondition (#31)", async () => {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:no-uid-conflict>
    <D:href>/calendars/user/default/other.ics</D:href>
  </C:no-uid-conflict>
</D:error>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 412 })));

    const client = new HttpClient("https://example.test/", {
      type: "basic",
      username: "test",
      password: "test",
    });

    const error = await client
      .request({ method: "PUT", url: "/calendars/user/default/x.ics" })
      .catch((e) => e);

    expect(error.status).toBe(412);
    expect(error.responseBody).toBe(body);
    expect(error.precondition).toBe("no-uid-conflict");
  });

  test("a vendor error body is kept even without a recognisable precondition", async () => {
    const body = `<D:error xmlns:D="DAV:" xmlns:OX="http://ox.io/ns/"><OX:code>CAL-4121</OX:code><OX:error_desc>Concurrent modification</OX:error_desc></D:error>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 412 })));

    const client = new HttpClient("https://example.test/", {
      type: "basic",
      username: "test",
      password: "test",
    });

    const error = await client.request({ method: "PUT", url: "/x.ics" }).catch((e) => e);

    expect(error.responseBody).toContain("CAL-4121");
    expect(error.precondition).toBe("code");
  });

  test("wraps network failures as CalDAVError with the cause preserved", async () => {
    const cause = new TypeError("fetch failed");
    const fetchMock = vi.fn(async () => {
      throw cause;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient("https://example.test/", {
      type: "basic",
      username: "test",
      password: "test",
    });

    const error = await client
      .request({ method: "PROPFIND", url: "/down/" })
      .catch((e) => e);

    expect(error).toBeInstanceOf(CalDAVError);
    expect(error.cause).toBe(cause);
  });

  test("does not attach a dispatcher or warn on the default secure path", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient("https://example.test/", {
      type: "basic",
      username: "test",
      password: "test",
    });

    await client.request({ method: "PROPFIND", url: "/calendar/" });

    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      dispatcher?: unknown;
    };
    expect(init.dispatcher).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test("warns when rejectUnauthorized is false but no TLS bypass is available", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    // undici is not installed in the test runtime, so the dispatcher build
    // fails and the client must surface a warning instead of silently
    // ignoring the option.
    const client = new HttpClient(
      "https://example.test/",
      { type: "basic", username: "test", password: "test" },
      false,
    );

    await client.request({ method: "PROPFIND", url: "/calendar/" });

    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      dispatcher?: unknown;
    };
    expect(init.dispatcher).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("rejectUnauthorized"),
    );
  });

  test("logs request method, URL, and status when enabled", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient(
      "https://example.test/",
      {
        type: "basic",
        username: "test",
        password: "secret",
      },
      true,
      {},
      0,
      true,
    );

    await client.request({ method: "OPTIONS", url: "/calendar/" });

    expect(debug).toHaveBeenCalledWith(
      "[ts-caldav] OPTIONS https://example.test/calendar/",
    );
    expect(debug).toHaveBeenCalledWith(
      "[ts-caldav] OPTIONS https://example.test/calendar/ -> 200",
    );
    expect(debug.mock.calls.flat().join("\n")).not.toContain("secret");
  });
});
