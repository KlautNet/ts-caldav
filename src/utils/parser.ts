import {
  Alarm,
  Calendar,
  Event,
  EVENT_STATUSES,
  EventStatus,
  RecurrenceRule,
  SupportedComponent,
  Todo,
  TODO_STATUSES,
  TodoStatus,
} from "../models";
import ICAL from "ical.js";
import {
  asNode,
  asString,
  getDavResponses,
  getFirstSuccessfulProp,
  parseDavXml,
  toArray,
} from "./dav";

const normalizeParam = (
  value: string | string[] | undefined,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const generateCustomFields = (
  component: ICAL.Component,
  knownProps: Set<string>,
): Record<string, string | string[]> => {
  const customFields: Record<string, string | string[]> = {};
  for (const prop of component.getAllProperties()) {
    const name = prop.name;
    if (knownProps.has(name)) continue;
    const value = prop.getFirstValue()?.toString();
    if (value == null) continue;
    const existing = customFields[name];
    if (existing === undefined) {
      customFields[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      customFields[name] = [existing, value];
    }
  }
  return customFields;
};

const parseRecurrence = (recur: ICAL.Recur): RecurrenceRule => {
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
  const wkst = recur.wkst ? recur.wkst.toString() : undefined;

  return {
    freq,
    interval: recur.interval,
    count: recur.count ? recur.count : undefined,
    until: recur.until ? recur.until.toJSDate() : undefined,
    wkst,
    byday,
    bymonthday,
    bymonth,
  };
};

export const parseCalendars = async (
  responseData: string,
  baseUrl?: string,
): Promise<Calendar[]> => {
  const calendars: Calendar[] = [];
  const responses = getDavResponses(parseDavXml(responseData));

  for (const res of responses) {
    const prop = getFirstSuccessfulProp(res);
    if (!prop) continue;

    const componentSet = asNode(prop["supported-calendar-component-set"]);
    const compArray = toArray(componentSet?.comp);

    const supportedComponents = compArray
      .map((c) => asString(asNode(c)?.name))
      .filter(
        (name): name is SupportedComponent =>
          typeof name === "string" &&
          ["VEVENT", "VTODO", "VJOURNAL", "VFREEBUSY", "VTIMEZONE"].includes(
            name,
          ),
      );

    if (
      !supportedComponents.includes("VEVENT") &&
      !supportedComponents.includes("VTODO")
    )
      continue;

    calendars.push({
      displayName: asString(prop.displayname) ?? "",
      url: baseUrl && res.href ? new URL(res.href, baseUrl).toString() : res.href ?? "",
      ctag: asString(prop.getctag),
      supportedComponents,
      color: asString(prop["calendar-color"]),
    });
  }

  return calendars;
};

const KNOWN_EVENT_PROPERTIES = new Set([
  "uid",
  "summary",
  "description",
  "location",
  "status",
  "dtstart",
  "dtend",
  "rrule",
  "dtstamp",
  "created",
  "last-modified",
  "sequence",
]);

export const parseEvents = async (
  responseData: string,
  baseUrl?: string,
): Promise<Event[]> => {
  const events: Event[] = [];
  const responses = getDavResponses(parseDavXml(responseData));

  for (const response of responses) {
    const eventData = getFirstSuccessfulProp(response);
    if (!eventData) continue;

    const rawCalendarData = asString(eventData["calendar-data"]);
    if (!rawCalendarData) continue;

    const cleanedCalendarData = rawCalendarData.replace(/&#13;/g, "\r");

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

      const rawStatus = vevent.getFirstPropertyValue("status")?.toString();
      const status = EVENT_STATUSES.includes(rawStatus as EventStatus)
        ? (rawStatus as EventStatus)
        : undefined;

      const customFields = generateCustomFields(
        vevent,
        KNOWN_EVENT_PROPERTIES,
      );

      events.push({
        uid: icalEvent.uid,
        summary: icalEvent.summary || "Untitled Event",
        start: startDate,
        end: adjustedEnd,
        description: icalEvent.description || undefined,
        location: icalEvent.location || undefined,
        status: status || undefined,
        etag: asString(eventData["getetag"]) || "",
        href:
          baseUrl && response.href
            ? new URL(response.href, baseUrl).toString()
            : response.href ?? "",
        wholeDay: isWholeDay,
        recurrenceRule,
        startTzid,
        endTzid,
        alarms,
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
      });
    }
  }

  return events;
};

const KNOWN_TODO_PROPERTIES = new Set([
  "uid",
  "summary",
  "description",
  "location",
  "status",
  "x-apple-sort-order",
  "dtstart",
  "due",
  "completed",
  "dtstamp",
  "created",
  "last-modified",
  "sequence",
]);

export const parseTodos = async (
  responseData: string,
  baseUrl?: string,
): Promise<Todo[]> => {
  const todos: Todo[] = [];
  const responses = getDavResponses(parseDavXml(responseData));

  for (const response of responses) {
    const todoData = getFirstSuccessfulProp(response);
    if (!todoData) continue;

    const rawCalendarData = asString(todoData["calendar-data"]);
    if (!rawCalendarData) continue;

    const cleanedCalendarData = rawCalendarData.replace(/&#13;/g, "\r\n");

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

      const rawStatus = vtodo.getFirstPropertyValue("status") as
        | string
        | undefined;
      const status = TODO_STATUSES.includes(rawStatus as TodoStatus)
        ? (rawStatus as TodoStatus)
        : undefined;

      const sortOrderRaw = vtodo.getFirstPropertyValue(
        "x-apple-sort-order",
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

      const customFields = generateCustomFields(vtodo, KNOWN_TODO_PROPERTIES);

      todos.push({
        uid,
        summary,
        start,
        due,
        completed,
        status,
        description,
        location,
        etag: asString(todoData["getetag"]) || "",
        href:
          baseUrl && response.href
            ? new URL(response.href, baseUrl).toString()
            : response.href ?? "",
        alarms,
        sortOrder,
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
      });
    }
  }

  return todos;
};
