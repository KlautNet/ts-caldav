import axios from "axios";
import { CalDAVClient } from "../src/client";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

let capturedPutHeaders: Record<string, string> = {};

beforeEach(() => {
  capturedPutHeaders = {};

  const fakeHttpClient = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    put: jest.fn(
      (
        _url: string,
        _data: unknown,
        config: { headers?: Record<string, string> },
      ) => {
        capturedPutHeaders = config?.headers ?? {};
        return Promise.resolve({ headers: { etag: '"new-etag"' }, data: "" });
      },
    ),
    request: jest.fn(() => {
      return Promise.resolve({
        headers: {},
        data: `<multistatus xmlns="DAV:" xmlns:cs="http://calendarserver.org/ns/">
                 <response><propstat><prop><getctag>ctag1</getctag></prop></propstat></response>
               </multistatus>`,
      });
    }),
  } as unknown as ReturnType<typeof axios.create>;

  mockedAxios.create.mockReturnValue(fakeHttpClient);
});

function makeClient(): CalDAVClient {
  return CalDAVClient.createFromCache(
    {
      baseUrl: "https://example.com",
      auth: { type: "basic", username: "user", password: "pass" },
    },
    { userPrincipal: "/principals/user/", calendarHome: "/calendars/user/" },
  );
}

const calendarUrl = "https://example.com/calendars/user/default/";

const baseTodo = {
  uid: "test-uid-1",
  href: "https://example.com/calendars/user/default/test-uid-1.ics",
  summary: "Test Todo",
  due: new Date("2026-03-20"),
};

describe("updateTodo — If-Match header behaviour", () => {
  test('weak etag (W/"...") does NOT send If-Match', async () => {
    const client = makeClient();
    await client.updateTodo(calendarUrl, { ...baseTodo, etag: 'W/"abc123"' });
    expect(capturedPutHeaders["If-Match"]).toBeUndefined();
  });

  test('strong etag ("...") DOES send If-Match', async () => {
    const client = makeClient();
    await client.updateTodo(calendarUrl, { ...baseTodo, etag: '"abc123"' });
    expect(capturedPutHeaders["If-Match"]).toBe('"abc123"');
  });

  test("missing etag does NOT send If-Match", async () => {
    const client = makeClient();
    await client.updateTodo(calendarUrl, { ...baseTodo });
    expect(capturedPutHeaders["If-Match"]).toBeUndefined();
  });
});
