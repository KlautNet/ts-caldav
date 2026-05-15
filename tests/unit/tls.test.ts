import { describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const baseOptions = {
  baseUrl: "https://caldav.example.com",
  auth: { type: "basic" as const, username: "user", password: "pass" },
};

const fakeCache = {
  userPrincipal: "/principals/user",
  calendarHome: "/calendars/user",
};

describe("rejectUnauthorized option", () => {
  test("client constructs without error when option is not set", () => {
    expect(() =>
      CalDAVClient.createFromCache(baseOptions, fakeCache),
    ).not.toThrow();
  });

  test("client constructs without error when rejectUnauthorized: false", () => {
    expect(() =>
      CalDAVClient.createFromCache(
        { ...baseOptions, rejectUnauthorized: false },
        fakeCache,
      ),
    ).not.toThrow();
  });
});
