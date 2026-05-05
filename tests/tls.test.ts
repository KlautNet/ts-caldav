import { CalDAVClient } from "../src/client";

jest.mock("https", () => ({
  Agent: jest.fn().mockImplementation(() => ({})),
}));

const mockHttps = jest.requireMock("https");

const baseOptions = {
  baseUrl: "https://caldav.example.com",
  auth: { type: "basic" as const, username: "user", password: "pass" },
};

const fakeCache = {
  userPrincipal: "/principals/user",
  calendarHome: "/calendars/user",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("rejectUnauthorized option", () => {
  test("does not create an https.Agent when option is not set", () => {
    CalDAVClient.createFromCache(baseOptions, fakeCache);
    expect(mockHttps.Agent).not.toHaveBeenCalled();
  });

  test("creates an https.Agent with rejectUnauthorized: false when set", () => {
    CalDAVClient.createFromCache(
      { ...baseOptions, rejectUnauthorized: false },
      fakeCache,
    );
    expect(mockHttps.Agent).toHaveBeenCalledWith({ rejectUnauthorized: false });
  });
});
