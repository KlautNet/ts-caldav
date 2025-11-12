import { XMLParser } from "fast-xml-parser";
import {
  Alarm,
  Calendar,
  Event,
  RecurrenceRule,
  SupportedComponent,
  Todo,
} from "../models";
import ICAL from "ical.js";

const normalizeParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

function parseRecurrence(recur: ICAL.Recur): RecurrenceRule {
  const freqMap = {
    DAILY: "DAILY",
    WEEKLY: "WEEKLY",
    MONTHLY: "MONTHLY",
    YEARLY: "YEARLY",
  } as const;
  const freq = freqMap[recur.freq as keyof typeof freqMap] || undefined;

  const byday = recur.parts.BYDAY
    ? recur.parts.BYDAY.map((day: string) => day)
    : undefined;
  const bymonthday = recur.parts.BYMONTHDAY
    ? recur.parts.BYMONTHDAY.map((day: number) => day)
    : undefined;
  const bymonth = recur.parts.BYMONTH
    ? recur.parts.BYMONTH.map((month: number) => month)
    : undefined;

  return {
    freq,
    interval: recur.interval,
    count: recur.count ? recur.count : undefined,
    until: recur.until ? recur.until.toJSDate() : undefined,
    byday,
    bymonthday,
    bymonth,
  };
}

const toArray = <T>(value: T | T[] | undefined): T[] =>
  Array.isArray(value) ? value : value ? [value] : [];

export const parseCalendars = async (
  responseData: string,
  baseUrl?: string
): Promise<Calendar[]> => {
  const calendars: Calendar[] = [];

  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });

  const jsonData = parser.parse(responseData);
  const responses = toArray(jsonData?.multistatus?.response);

  for (const res of responses) {
    const propstats = toArray(res?.propstat);

    const okPropstat = propstats.find(
      (p) =>
        typeof p?.status === "string" &&
        p.status.toLowerCase().includes("200 ok")
    );
    if (!okPropstat) continue;

    const prop = okPropstat.prop;
    const compArray = toArray(prop?.["supported-calendar-component-set"]?.comp);

    const supportedComponents = compArray
      .map((c) => c.name)
      .filter((name): name is SupportedComponent =>
        [
          "VEVENT",
          "VTODO",
          "VJOURNAL",
          "VFREEBUSY",
          "VTIMEZONE",
          "VAVAILABILITY",
        ].includes(name)
      );

    if (
      !supportedComponents.includes("VEVENT") &&
      !supportedComponents.includes("VTODO")
    )
      continue;

    calendars.push({
      displayName: prop?.displayname ?? "",
      url: baseUrl ? new URL(res.href, baseUrl).toString() : res.href,
      ctag: prop?.getctag,
      supportedComponents,
      color: prop?.["calendar-color"],
    });
  }

  return calendars;
};

export const parseEvents = async (
  responseData: string,
  baseUrl?: string
): Promise<Event[]> => {
  const events: Event[] = [];
  const parser = new XMLParser({ removeNSPrefix: true });
  const jsonData = parser.parse(responseData);
  let response = jsonData["multistatus"]?.["response"];
  if (!response) return events;

  if (!Array.isArray(response)) response = [response];

  for (const obj of response) {
    const eventData = obj["propstat"]?.["prop"];
    if (!eventData) continue;

    const rawCalendarData = eventData["calendar-data"];
    if (!rawCalendarData) continue;

    const cleanedCalendarData = rawCalendarData.replace(/&#13;/g, "\r");

    try {
      const jcalData = ICAL.parse(cleanedCalendarData);
      const vcalendar = new ICAL.Component(jcalData);

      const vevents = vcalendar.getAllSubcomponents("vevent");
      for (const vevent of vevents) {
        const icalEvent = new ICAL.Event(vevent);

        const dtStartProp = vevent.getFirstProperty("dtstart");
        const dtEndProp = vevent.getFirstProperty("dtend");

        const isWholeDay = icalEvent.startDate.isDate;
        const startDate = icalEvent.startDate.toJSDate();
        const endDate = icalEvent.endDate?.toJSDate() ?? startDate;

        const adjustedEnd = isWholeDay ? new Date(endDate.getTime()) : endDate;

        const startTzid = normalizeParam(dtStartProp?.getParameter("tzid"));
        const endTzid = normalizeParam(dtEndProp?.getParameter("tzid"));

        const rruleProp = vevent.getFirstProperty("rrule");
        let recurrenceRule: RecurrenceRule | undefined;
        if (rruleProp) {
          const rruleValue = rruleProp.getFirstValue();
          if (rruleValue) {
            const recur = ICAL.Recur.fromString(rruleValue.toString());
            recurrenceRule = parseRecurrence(recur);
          }
        }

        const alarms: Alarm[] = [];
        const valarms = vevent.getAllSubcomponents("valarm") || [];

        for (const valarm of valarms) {
          const action = valarm.getFirstPropertyValue("action");
          const trigger = valarm.getFirstPropertyValue("trigger")?.toString();

          if (!action || !trigger) continue;

          if (action === "DISPLAY") {
            alarms.push({
              action: "DISPLAY",
              trigger,
              description: valarm
                .getFirstPropertyValue("description")
                ?.toString(),
            });
          } else if (action === "EMAIL") {
            const attendees =
              valarm
                .getAllProperties("attendee")
                ?.map((p) => p.getFirstValue())
                .filter((v): v is string => typeof v === "string") || [];

            alarms.push({
              action: "EMAIL",
              trigger,
              description: valarm
                .getFirstPropertyValue("description")
                ?.toString(),
              summary: valarm.getFirstPropertyValue("summary")?.toString(),
              attendees,
            });
          } else if (action === "AUDIO") {
            alarms.push({ action: "AUDIO", trigger });
          }
        }

        const status = vevent.getFirstPropertyValue("status")?.toString();

        events.push({
          uid: icalEvent.uid,
          summary: icalEvent.summary || "Untitled Event",
          start: startDate,
          end: adjustedEnd,
          description: icalEvent.description || undefined,
          location: icalEvent.location || undefined,
          status: status || undefined,
          etag: eventData["getetag"] || "",
          href: baseUrl
            ? new URL(obj["href"], baseUrl).toString()
            : obj["href"],
          wholeDay: isWholeDay,
          recurrenceRule,
          startTzid,
          endTzid,
          alarms,
        });
      }
    } catch (error) {
      console.error("Error parsing event data:", error);
    }
  }

  return events;
};

export const parseTodos = async (
  responseData: string,
  baseUrl?: string
): Promise<Todo[]> => {
  const todos: Todo[] = [];
  const parser = new XMLParser({ removeNSPrefix: true });
  const jsonData = parser.parse(responseData);
  let response = jsonData["multistatus"]?.["response"];
  if (!response) return todos;

  if (!Array.isArray(response)) response = [response];

  for (const obj of response) {
    const todoData = obj["propstat"]?.["prop"];
    if (!todoData) continue;

    const rawCalendarData = todoData["calendar-data"];
    if (!rawCalendarData) continue;

    const cleanedCalendarData = rawCalendarData.replace(/&#13;/g, "\r\n");

    try {
      const jcalData = ICAL.parse(cleanedCalendarData);
      const vcalendar = new ICAL.Component(jcalData);

      const vtodos = vcalendar.getAllSubcomponents("vtodo");
      for (const vtodo of vtodos) {
        const uid = vtodo.getFirstPropertyValue("uid") as string;
        const summary =
          (vtodo.getFirstPropertyValue("summary") as string) || "Untitled Todo";
        const description = vtodo.getFirstPropertyValue("description") as
          | string
          | undefined;
        const location = vtodo.getFirstPropertyValue("location") as
          | string
          | undefined;
        const status = vtodo.getFirstPropertyValue("status") as
          | string
          | undefined;

        const sortOrderRaw = vtodo.getFirstPropertyValue(
          "x-apple-sort-order"
        ) as string | number | null | undefined;
        const sortOrder =
          sortOrderRaw !== undefined && sortOrderRaw !== null
            ? Number(sortOrderRaw)
            : undefined;

        const dtStartProp = vtodo.getFirstProperty("dtstart");
        const dueProp = vtodo.getFirstProperty("due");
        const completedProp = vtodo.getFirstProperty("completed");

        const start = dtStartProp
          ? (dtStartProp.getFirstValue() as ICAL.Time).toJSDate()
          : undefined;
        const due = dueProp
          ? (dueProp.getFirstValue() as ICAL.Time).toJSDate()
          : undefined;
        const completed = completedProp
          ? (completedProp.getFirstValue() as ICAL.Time).toJSDate()
          : undefined;

        const alarms: Alarm[] = [];
        const valarms = vtodo.getAllSubcomponents("valarm") || [];

        for (const valarm of valarms) {
          const action = valarm.getFirstPropertyValue("action");
          const trigger = valarm.getFirstPropertyValue("trigger")?.toString();

          if (!action || !trigger) continue;

          if (action === "DISPLAY") {
            alarms.push({
              action: "DISPLAY",
              trigger,
              description: valarm
                .getFirstPropertyValue("description")
                ?.toString(),
            });
          } else if (action === "EMAIL") {
            const attendees =
              valarm
                .getAllProperties("attendee")
                ?.map((p) => p.getFirstValue())
                .filter((v): v is string => typeof v === "string") || [];

            alarms.push({
              action: "EMAIL",
              trigger,
              description: valarm
                .getFirstPropertyValue("description")
                ?.toString(),
              summary: valarm.getFirstPropertyValue("summary")?.toString(),
              attendees,
            });
          } else if (action === "AUDIO") {
            alarms.push({ action: "AUDIO", trigger });
          }
        }

        todos.push({
          uid,
          summary,
          start,
          due,
          completed,
          status,
          description,
          location,
          etag: todoData["getetag"] || "",
          href: baseUrl
            ? new URL(obj["href"], baseUrl).toString()
            : obj["href"],
          alarms,
          sortOrder,
        });
      }
    } catch (error) {
      console.error("Error parsing todo data:", error);
    }
  }

  return todos;
};
