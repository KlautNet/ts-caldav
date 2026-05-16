import ICAL from "ical.js";
import { Event, Todo } from "../models";
import { PartialBy } from "./types";

const addAlarms = (component: ICAL.Component, alarms?: Event["alarms"]) => {
  if (!alarms) return;

  for (const alarm of alarms) {
    const valarm = new ICAL.Component("valarm");
    valarm.addPropertyWithValue("trigger", alarm.trigger);
    valarm.addPropertyWithValue("action", alarm.action);

    if (alarm.action === "DISPLAY" && alarm.description) {
      valarm.addPropertyWithValue("description", alarm.description);
    } else if (alarm.action === "EMAIL") {
      if (alarm.summary) valarm.addPropertyWithValue("summary", alarm.summary);
      if (alarm.description)
        valarm.addPropertyWithValue("description", alarm.description);
      for (const attendee of alarm.attendees) {
        valarm.addPropertyWithValue("attendee", attendee);
      }
    }

    component.addSubcomponent(valarm);
  }
};

const addCustomFields = (
  component: ICAL.Component,
  customFields?: Record<string, string | string[]>,
) => {
  if (!customFields) return;

  for (const [key, value] of Object.entries(customFields)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      component.addPropertyWithValue(key.toLowerCase(), v);
    }
  }
};

export const buildEventICSData = (
  event: PartialBy<Event, "uid" | "etag" | "href">,
  uid: string,
  prodId: string,
): string => {
  const vcalendar = new ICAL.Component(["vcalendar", [], []]);
  vcalendar.addPropertyWithValue("version", "2.0");
  vcalendar.addPropertyWithValue("prodid", prodId);

  const vevent = new ICAL.Component("vevent");
  const e = new ICAL.Event(vevent);
  e.uid = uid;
  vevent.addPropertyWithValue(
    "dtstamp",
    ICAL.Time.fromJSDate(new Date(), true),
  );

  if (event.wholeDay) {
    const startDateStr = event.start.toISOString().split("T")[0];
    const endDateStr = event.end
      ? event.end.toISOString().split("T")[0]
      : startDateStr;

    const endExclusive = new Date(endDateStr + "T00:00:00Z");
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

    e.startDate = ICAL.Time.fromDateString(startDateStr);
    e.endDate = ICAL.Time.fromDateString(
      endExclusive.toISOString().split("T")[0],
    );
  } else {
    const start = ICAL.Time.fromJSDate(event.start, true);
    const end = ICAL.Time.fromJSDate(event.end, true);

    if (event.startTzid) {
      const prop = vevent.addPropertyWithValue("dtstart", start);
      prop.setParameter("tzid", event.startTzid);
    } else {
      e.startDate = start;
    }

    if (event.endTzid) {
      const prop = vevent.addPropertyWithValue("dtend", end);
      prop.setParameter("tzid", event.endTzid);
    } else {
      e.endDate = end;
    }
  }

  e.summary = event.summary;
  e.description = event.description || "";
  e.location = event.location || "";

  if (event.recurrenceRule) {
    const r = event.recurrenceRule;
    const rruleProps: Record<string, string | number> = {};
    if (r.freq) rruleProps.FREQ = r.freq;
    if (r.interval) rruleProps.INTERVAL = r.interval;
    if (r.count) rruleProps.COUNT = r.count;
    if (event.wholeDay && r.until) {
      rruleProps.UNTIL = ICAL.Time.fromDateString(
        r.until.toISOString().split("T")[0],
      ).toString();
    } else if (r.until) {
      rruleProps.UNTIL = ICAL.Time.fromJSDate(r.until, true).toString();
    }

    if (r.byday) rruleProps.BYDAY = r.byday.join(",");
    if (r.bymonthday) rruleProps.BYMONTHDAY = r.bymonthday.join(",");
    if (r.bymonth) rruleProps.BYMONTH = r.bymonth.join(",");
    vevent.addPropertyWithValue("rrule", rruleProps);
  }

  addCustomFields(vevent, event.customFields);
  addAlarms(vevent, event.alarms);

  vcalendar.addSubcomponent(vevent);
  return vcalendar.toString();
};

export const buildTodoICSData = (
  todo: PartialBy<Todo, "uid" | "etag" | "href">,
  uid: string,
  prodId: string,
): string => {
  const vcalendar = new ICAL.Component(["vcalendar", [], []]);
  vcalendar.addPropertyWithValue("version", "2.0");
  vcalendar.addPropertyWithValue("prodid", prodId);

  const vtodo = new ICAL.Component("vtodo");
  vtodo.addPropertyWithValue("uid", uid);
  vtodo.addPropertyWithValue(
    "dtstamp",
    ICAL.Time.fromJSDate(new Date(), true),
  );

  if (todo.start)
    vtodo.addPropertyWithValue("dtstart", ICAL.Time.fromJSDate(todo.start, true));
  if (todo.due)
    vtodo.addPropertyWithValue("due", ICAL.Time.fromJSDate(todo.due, true));
  if (todo.completed)
    vtodo.addPropertyWithValue(
      "completed",
      ICAL.Time.fromJSDate(todo.completed, true),
    );
  vtodo.addPropertyWithValue("summary", todo.summary);
  if (todo.description) vtodo.addPropertyWithValue("description", todo.description);
  if (todo.location) vtodo.addPropertyWithValue("location", todo.location);
  if (todo.status) vtodo.addPropertyWithValue("status", todo.status);
  if (todo.sortOrder !== undefined)
    vtodo.addPropertyWithValue("X-APPLE-SORT-ORDER", todo.sortOrder);

  addCustomFields(vtodo, todo.customFields);
  addAlarms(vtodo, todo.alarms);

  vcalendar.addSubcomponent(vtodo);
  return vcalendar.toString();
};

