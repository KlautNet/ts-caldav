import ICAL from "ical.js";
import { Event, Todo } from "../models";
import { normalizeIcs } from "../utils/ics";
import { parseEventComponent, parseTodoComponent } from "../utils/parser";
import {
  buildEventComponent,
  buildEventICSData,
  buildTodoComponent,
  buildTodoICSData,
} from "./ics-builders";
import { PartialBy } from "./types";

/** Model fields and the iCalendar properties they are written to. */
type Group<T> = { fields: (keyof T)[]; props: string[] };

const EVENT_GROUPS: Group<Event>[] = [
  { fields: ["summary"], props: ["summary"] },
  { fields: ["description"], props: ["description"] },
  { fields: ["location"], props: ["location"] },
  { fields: ["status"], props: ["status"] },
  { fields: ["start", "startTzid", "wholeDay"], props: ["dtstart"] },
  { fields: ["end", "endTzid", "wholeDay"], props: ["dtend", "duration"] },
  { fields: ["recurrenceRule", "wholeDay"], props: ["rrule"] },
  { fields: ["recurrenceId", "wholeDay"], props: ["recurrence-id"] },
  { fields: ["exdates", "wholeDay"], props: ["exdate"] },
  { fields: ["rdates", "wholeDay"], props: ["rdate"] },
];

const TODO_GROUPS: Group<Todo>[] = [
  { fields: ["summary"], props: ["summary"] },
  { fields: ["description"], props: ["description"] },
  { fields: ["location"], props: ["location"] },
  { fields: ["status"], props: ["status"] },
  { fields: ["start"], props: ["dtstart"] },
  { fields: ["due"], props: ["due"] },
  { fields: ["completed"], props: ["completed"] },
  { fields: ["sortOrder"], props: ["x-apple-sort-order"] },
];

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.length === 0);

const same = (a: unknown, b: unknown): boolean => {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => same(value, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) =>
      same(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }
  return a === b;
};

const lowerKeys = (fields?: Record<string, string | string[]>) =>
  Object.fromEntries(
    Object.entries(fields ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );

const replaceProps = (
  target: ICAL.Component,
  source: ICAL.Component,
  name: string,
) => {
  target.removeAllProperties(name);
  for (const prop of source.getAllProperties(name)) {
    target.addProperty(new ICAL.Property(prop.toJSON()));
  }
};

/**
 * Keeps each stored property whose value is still listed (with its
 * parameters), removes the others and adds the new values.
 */
const amendCustomField = (
  target: ICAL.Component,
  name: string,
  value: string | string[] | undefined,
) => {
  const remaining = value === undefined ? [] : Array.isArray(value) ? [...value] : [value];
  for (const prop of target.getAllProperties(name)) {
    const index = remaining.indexOf(String(prop.getFirstValue()));
    if (index === -1) target.removeProperty(prop);
    else remaining.splice(index, 1);
  }
  for (const v of remaining) target.addPropertyWithValue(name, v);
};

/**
 * Writes `item` into the component it was read from: properties of fields
 * that changed are rebuilt, everything else is kept as stored.
 */
const amend = <T extends Event | Todo>(
  item: T,
  uid: string,
  componentName: "vevent" | "vtodo",
  groups: Group<T>[],
  parse: (component: ICAL.Component) => Partial<T>,
  build: (item: T, uid: string) => ICAL.Component,
): string | undefined => {
  let vcalendar: ICAL.Component;
  try {
    vcalendar = new ICAL.Component(ICAL.parse(normalizeIcs(item.ics!)));
  } catch {
    return undefined;
  }

  const candidates = vcalendar
    .getAllSubcomponents(componentName)
    .filter((component) => component.getFirstPropertyValue("uid") === uid)
    .map((component) => ({ component, stored: parse(component) }));
  const match = candidates.find(({ stored }) =>
    same(
      (stored as Partial<Event>).recurrenceId,
      (item as Partial<Event>).recurrenceId,
    ),
  );
  if (!match) return undefined;

  const { component: target, stored } = match;
  const fresh = build(item, uid);

  for (const { fields, props } of groups) {
    // A DURATION depends on the start, so a new start rewrites the end too.
    const dependsOnStart =
      props.includes("dtend") && !target.hasProperty("dtend");
    const changed =
      fields.some((field) => !same(item[field], stored[field])) ||
      (dependsOnStart && !same(item["start" as keyof T], stored["start" as keyof T]));
    if (changed) props.forEach((name) => replaceProps(target, fresh, name));
  }

  const storedFields = lowerKeys(stored.customFields);
  const itemFields = lowerKeys(item.customFields);
  for (const name of new Set([
    ...Object.keys(storedFields),
    ...Object.keys(itemFields),
  ])) {
    if (!same(storedFields[name], itemFields[name])) {
      amendCustomField(target, name, itemFields[name]);
    }
  }

  if (!same(item.alarms, stored.alarms)) {
    for (const alarm of target.getAllSubcomponents("valarm")) {
      target.removeSubcomponent(alarm);
    }
    for (const alarm of fresh.getAllSubcomponents("valarm")) {
      target.addSubcomponent(new ICAL.Component(alarm.toJSON()));
    }
  }

  replaceProps(target, fresh, "dtstamp");
  replaceProps(target, fresh, "sequence");
  if (target.hasProperty("last-modified")) {
    target.updatePropertyWithValue(
      "last-modified",
      ICAL.Time.fromJSDate(new Date(), true),
    );
  }

  return vcalendar.toString();
};

/**
 * Like `buildEventICSData`, but when the event carries the resource it was
 * read from (`ics`), only the changed fields are rewritten in it.
 */
export const amendEventICSData = (
  event: PartialBy<Event, "etag" | "href">,
  uid: string,
  prodId: string,
): string =>
  (event.ics &&
    amend(
      event as Event,
      uid,
      "vevent",
      EVENT_GROUPS,
      parseEventComponent,
      buildEventComponent,
    )) ||
  buildEventICSData(event, uid, prodId);

/** The todo counterpart of `amendEventICSData`. */
export const amendTodoICSData = (
  todo: PartialBy<Todo, "etag" | "href">,
  uid: string,
  prodId: string,
): string =>
  (todo.ics &&
    amend(
      todo as Todo,
      uid,
      "vtodo",
      TODO_GROUPS,
      parseTodoComponent,
      buildTodoComponent,
    )) ||
  buildTodoICSData(todo, uid, prodId);
