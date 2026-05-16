import { CalDAVError } from "../errors";
import HttpClient from "../http-client";
import { Calendar } from "../models";
import { parseCalendars } from "../utils/parser";

type CalendarDeps = {
  calendarHome: string | null;
  httpClient: Pick<HttpClient, "request">;
  resolveUrl: (path: string) => string;
};

export const getCalendars = async ({
  calendarHome,
  httpClient,
  resolveUrl,
}: CalendarDeps): Promise<Calendar[]> => {
  if (!calendarHome) throw new CalDAVError("Calendar home not found.");

  const requestBody = `
    <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
      <d:prop>
        <d:resourcetype/>
        <d:displayname/>
        <cs:getctag/>
        <c:supported-calendar-component-set/>
        <apple:calendar-color/>
      </d:prop>
    </d:propfind>`;

  const response = await httpClient.request({
    method: "PROPFIND",
    url: calendarHome,
    data: requestBody,
    headers: {
      Depth: "1",
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const calendars = await parseCalendars(response.data);
  return calendars.map((cal) => ({
    ...cal,
    url: resolveUrl(cal.url),
  }));
};

