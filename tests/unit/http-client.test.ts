import { afterEach, describe, expect, test, vi } from "vitest";
import HttpClient from "../../src/http-client";

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
