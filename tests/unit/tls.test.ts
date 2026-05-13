import { beforeEach, describe, expect, test, vi } from "vitest";
import axios from "axios";
import { CalDAVClient } from "../../src/client";

// Test the rejectUnauthorized option by inspecting what CalDAVClient passes to
// axios.create(). Mocking the https built-in directly is unreliable in Vitest's
// Node environment when the source uses a dynamic require() inside a constructor.

vi.mock("axios", () => ({
  default: {
    create: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));

const baseOptions = {
  baseUrl: "https://caldav.example.com",
  auth: { type: "basic" as const, username: "user", password: "pass" },
};

const fakeCache = {
  userPrincipal: "/principals/user",
  calendarHome: "/calendars/user",
};

beforeEach(() => {
  vi.mocked(axios.create).mockReturnValue({
    interceptors: { request: { use: vi.fn() } },
  } as unknown as ReturnType<typeof axios.create>);
  vi.mocked(axios.create).mockClear();
});

describe("rejectUnauthorized option", () => {
  test("does not set httpsAgent on axios.create when option is not set", () => {
    CalDAVClient.createFromCache(baseOptions, fakeCache);
    const config = vi.mocked(axios.create).mock.calls[0]?.[0];
    expect(config?.httpsAgent).toBeUndefined();
  });

  test("sets httpsAgent on axios.create when rejectUnauthorized: false", () => {
    CalDAVClient.createFromCache(
      { ...baseOptions, rejectUnauthorized: false },
      fakeCache,
    );
    const config = vi.mocked(axios.create).mock.calls[0]?.[0];
    expect(config?.httpsAgent).toBeDefined();
  });
});
