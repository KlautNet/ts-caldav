import { afterEach, describe, expect, test, vi } from "vitest";
import HttpClient from "../../src/http-client";

afterEach(() => {
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
});
