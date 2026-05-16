import { CalDAVError } from "../errors";
import HttpClient, { HttpError } from "../http-client";
import { formatDate } from "../utils/encode";
import {
  asString,
  getDavResponses,
  getFirstSuccessfulProp,
  parseDavXml,
} from "../utils/dav";

export type ComponentType = "VEVENT" | "VTODO";

type ReportFn = (
  url: string,
  body: string,
  depth?: "0" | "1",
) => Promise<string>;

type PropfindFn = (
  url: string,
  depth: "0" | "1",
  body: string,
) => Promise<unknown>;

export const getComponents = async <T>(
  calendarUrl: string,
  component: ComponentType,
  parseFn: (xml: string) => Promise<T[]>,
  report: ReportFn,
  options?: { start?: Date; end?: Date; all?: boolean },
): Promise<T[]> => {
  const now = new Date();
  const defaultEnd = new Date(now.getTime() + 3 * 7 * 24 * 60 * 60 * 1000);
  const { start = now, end = defaultEnd, all } = options || {};

  const timeRangeFilter =
    start && end && !all
      ? `<c:comp-filter name="${component}">
           <c:time-range start="${formatDate(start)}" end="${formatDate(end)}"/>
         </c:comp-filter>`
      : `<c:comp-filter name="${component}"/>`;

  const requestBody = `
    <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop>
        <d:getetag/>
        <c:calendar-data/>
      </d:prop>
      <c:filter>
        <c:comp-filter name="VCALENDAR">
          ${timeRangeFilter}
        </c:comp-filter>
      </c:filter>
    </c:calendar-query>`;

  try {
    const xml = await report(calendarUrl, requestBody, "1");
    return await parseFn(xml);
  } catch (error) {
    throw new CalDAVError(
      `Failed to retrieve ${component.toLowerCase()}s from the CalDAV server.`,
      error instanceof HttpError ? error.status : undefined,
      { cause: error },
    );
  }
};

export const getETag = async (
  href: string,
  absolutize: (urlOrPath: string) => string,
  propfind: PropfindFn,
): Promise<string> => {
  try {
    const data = await propfind(
      absolutize(href),
      "0",
      `<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`,
    );
    const etagRaw = getDavResponses(data)
      .map(getFirstSuccessfulProp)
      .find((prop) => prop?.getetag)?.getetag;
    if (!etagRaw) throw new CalDAVError("ETag not found in PROPFIND response.");
    return String(etagRaw).replace(/^W\//, "");
  } catch (error) {
    if (error instanceof CalDAVError) throw error;
    throw new CalDAVError(
      `Failed to retrieve ETag for ${href}.`,
      error instanceof HttpError ? error.status : undefined,
      { cause: error },
    );
  }
};

export const getCtag = async (
  calendarUrl: string,
  httpClient: Pick<HttpClient, "request">,
): Promise<string> => {
  const requestBody = `
    <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
      <d:prop><cs:getctag/></d:prop>
    </d:propfind>`;

  const res = await httpClient.request({
    method: "PROPFIND",
    url: calendarUrl,
    data: requestBody,
    headers: {
      Depth: "0",
    },
    validateStatus: (s) => s === 207,
  });

  const ctag = getDavResponses(parseDavXml(res.data))
    .map(getFirstSuccessfulProp)
    .find((prop) => prop?.getctag)?.getctag;

  return asString(ctag) ?? "";
};

export const getItemRefs = async (
  calendarUrl: string,
  component: ComponentType,
  report: ReportFn,
): Promise<{ href: string; etag: string }[]> => {
  const requestBody = `
    <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop><d:getetag/></d:prop>
      <c:filter>
        <c:comp-filter name="VCALENDAR">
          <c:comp-filter name="${component}"/>
        </c:comp-filter>
      </c:filter>
    </c:calendar-query>`;

  const data = await report(calendarUrl, requestBody, "1");

  const refs: { href: string; etag: string }[] = [];
  for (const response of getDavResponses(parseDavXml(data))) {
    const href = response.href;
    const etag = asString(getFirstSuccessfulProp(response)?.getetag);
    if (href && etag) refs.push({ href, etag });
  }
  return refs;
};

export const getItemsByHref = async <T>(
  calendarUrl: string,
  hrefs: string[],
  parseFn: (xml: string) => Promise<T[]>,
  report: ReportFn,
): Promise<T[]> => {
  if (!hrefs.length) return [];

  const filtered = hrefs.filter((h) => h.endsWith(".ics"));
  if (!filtered.length) return [];

  const requestBody = `
    <c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop>
        <d:getetag/>
        <c:calendar-data/>
      </d:prop>
      ${filtered.map((h) => `<d:href>${h}</d:href>`).join("")}
    </c:calendar-multiget>`;

  const xml = await report(calendarUrl, requestBody, "1");
  return await parseFn(xml);
};

