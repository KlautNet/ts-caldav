import { describe, expect, test, vi } from "vitest";
import { getComponents } from "../../src/protocol/components";

const EMPTY_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"></d:multistatus>`;

describe("getComponents request body", () => {
  test("omits <C:expand> by default — recurring events are returned as their master VEVENT", async () => {
    const report = vi.fn(async () => EMPTY_MULTISTATUS);
    const parse = vi.fn(async () => []);

    await getComponents(
      "https://example.test/cal/",
      "VEVENT",
      parse,
      report,
      {
        start: new Date("2026-06-10T00:00:00Z"),
        end: new Date("2026-06-24T23:59:59Z"),
      },
    );

    expect(report).toHaveBeenCalledTimes(1);
    const body = report.mock.calls[0][1];
    expect(body).toContain("<c:calendar-data/>");
    expect(body).not.toContain("c:expand");
  });

  test("includes <C:expand> when expand:true is set together with a time range", async () => {
    const report = vi.fn(async () => EMPTY_MULTISTATUS);
    const parse = vi.fn(async () => []);

    const start = new Date("2026-06-10T00:00:00Z");
    const end = new Date("2026-06-24T23:59:59Z");

    await getComponents(
      "https://example.test/cal/",
      "VEVENT",
      parse,
      report,
      { start, end, expand: true },
    );

    const body = report.mock.calls[0][1];
    expect(body).not.toContain("<c:calendar-data/>");
    expect(body).toMatch(
      /<c:calendar-data>\s*<c:expand\s+start="20260610T000000Z"\s+end="20260624T235959Z"\/>\s*<\/c:calendar-data>/,
    );
  });

  test("ignores expand:true when no time range is in effect (all:true)", async () => {
    const report = vi.fn(async () => EMPTY_MULTISTATUS);
    const parse = vi.fn(async () => []);

    await getComponents(
      "https://example.test/cal/",
      "VEVENT",
      parse,
      report,
      {
        start: new Date("2026-06-10T00:00:00Z"),
        end: new Date("2026-06-24T23:59:59Z"),
        all: true,
        expand: true,
      },
    );

    const body = report.mock.calls[0][1];
    expect(body).toContain("<c:calendar-data/>");
    expect(body).not.toContain("c:expand");
  });
});
