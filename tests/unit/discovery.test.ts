import { afterEach, describe, expect, test, vi } from "vitest";
import { CalDAVClient } from "../../src/client";

const currentUserPrincipal = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">
  <response>
    <propstat>
      <prop>
        <current-user-principal><href>/test/</href></current-user-principal>
      </prop>
    </propstat>
  </response>
</multistatus>`;

const calendarHomeSet = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">
  <response>
    <propstat>
      <prop>
        <calendar-home-set><href>/test/</href></calendar-home-set>
      </prop>
    </propstat>
  </response>
</multistatus>`;

const displayName = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">
  <response>
    <propstat>
      <prop><displayname>Test</displayname></prop>
    </propstat>
  </response>
</multistatus>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CalDAV discovery", () => {
  test("handles well-known redirects manually", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://example.test/.well-known/caldav") {
        return new Response("Redirected to /", {
          status: 301,
          headers: { Location: "/" },
        });
      }

      if (init?.method === "OPTIONS" && url === "https://example.test/") {
        return new Response(null, {
          status: 200,
          headers: { Allow: "OPTIONS, PROPFIND", DAV: "1, 2, calendar-access" },
        });
      }

      if (
        init?.method === "PROPFIND" &&
        url === "https://example.test/" &&
        String(init.body).includes("current-user-principal")
      ) {
        return new Response(currentUserPrincipal, { status: 207 });
      }

      if (
        init?.method === "PROPFIND" &&
        url === "https://example.test/test/" &&
        String(init.body).includes("calendar-home-set")
      ) {
        return new Response(calendarHomeSet, { status: 207 });
      }

      if (
        init?.method === "PROPFIND" &&
        url === "https://example.test/test/" &&
        String(init.body).includes("displayname")
      ) {
        return new Response(displayName, { status: 207 });
      }

      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = await CalDAVClient.create({
      baseUrl: "https://example.test/",
      auth: { type: "basic", username: "test", password: "test" },
    });

    expect(client.getCalendarHome()).toBe("https://example.test/test/");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/.well-known/caldav",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
