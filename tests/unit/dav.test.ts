import { describe, expect, test } from "vitest";
import {
  getDavResponses,
  getFirstSuccessfulProp,
  getSuccessfulPropstats,
  parseDavXml,
} from "../../src/utils/dav";

describe("DAV XML helpers", () => {
  test("normalizes a single response with a single propstat", () => {
    const parsed = parseDavXml(`
      <multistatus xmlns="DAV:">
        <response>
          <href>/calendar/item-1.ics</href>
          <propstat>
            <prop><getetag>"one"</getetag></prop>
            <status>HTTP/1.1 200 OK</status>
          </propstat>
        </response>
      </multistatus>`);

    const responses = getDavResponses(parsed);

    expect(responses).toHaveLength(1);
    expect(responses[0].href).toBe("/calendar/item-1.ics");
    expect(getFirstSuccessfulProp(responses[0])?.getetag).toBe('"one"');
  });

  test("normalizes multiple responses", () => {
    const parsed = parseDavXml(`
      <multistatus xmlns="DAV:">
        <response>
          <href>/calendar/item-1.ics</href>
          <propstat>
            <prop><getetag>"one"</getetag></prop>
            <status>HTTP/1.1 200 OK</status>
          </propstat>
        </response>
        <response>
          <href>/calendar/item-2.ics</href>
          <propstat>
            <prop><getetag>"two"</getetag></prop>
            <status>HTTP/1.1 200 OK</status>
          </propstat>
        </response>
      </multistatus>`);

    const responses = getDavResponses(parsed);

    expect(responses.map((response) => response.href)).toEqual([
      "/calendar/item-1.ics",
      "/calendar/item-2.ics",
    ]);
    expect(
      responses.map((response) => getFirstSuccessfulProp(response)?.getetag),
    ).toEqual(['"one"', '"two"']);
  });

  test("normalizes multiple propstats and keeps only successful props", () => {
    const parsed = parseDavXml(`
      <multistatus xmlns="DAV:">
        <response>
          <href>/calendar/</href>
          <propstat>
            <prop><displayname>Hidden</displayname></prop>
            <status>HTTP/1.1 404 Not Found</status>
          </propstat>
          <propstat>
            <prop><displayname>Calendar</displayname></prop>
            <status>HTTP/1.1 200 OK</status>
          </propstat>
        </response>
      </multistatus>`);

    const [response] = getDavResponses(parsed);

    expect(response.propstats).toHaveLength(2);
    expect(getSuccessfulPropstats(response)).toHaveLength(1);
    expect(getFirstSuccessfulProp(response)?.displayname).toBe("Calendar");
  });
});
