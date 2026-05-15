import { describe, expect, test } from "vitest";
import { EVENT_STATUSES, TODO_STATUSES } from "../../src";
import type {
  Alarm,
  AuthOptions,
  CalDAVClientCache,
  CalDAVOptions,
  Calendar,
  Event,
  EventRef,
  EventStatus,
  RecurrenceRule,
  SupportedComponent,
  SyncChangesResult,
  SyncTodosResult,
  Todo,
  TodoRef,
  TodoStatus,
  VTimezone,
} from "../../src";

describe("public exports", () => {
  test("exports public model constants", () => {
    expect(EVENT_STATUSES).toContain("CONFIRMED");
    expect(TODO_STATUSES).toContain("NEEDS-ACTION");
  });

  test("exports public model types from the package entry point", () => {
    const auth: AuthOptions = {
      type: "basic",
      username: "user",
      password: "pass",
    };
    const options: CalDAVOptions = {
      baseUrl: "https://example.test/",
      auth,
      requestTimeout: 1000,
      logRequests: true,
    };
    const components: SupportedComponent[] = ["VEVENT", "VTODO"];
    const calendar: Calendar = {
      displayName: "Work",
      url: "/calendars/user/work/",
      supportedComponents: components,
    };
    const status: EventStatus = "CONFIRMED";
    const todoStatus: TodoStatus = "NEEDS-ACTION";
    const recurrenceRule: RecurrenceRule = {
      freq: "WEEKLY",
      interval: 1,
      byday: ["MO"],
    };
    const alarm: Alarm = {
      action: "DISPLAY",
      trigger: "-PT15M",
      description: "Reminder",
    };
    const event: Event = {
      uid: "event-1",
      summary: "Sync",
      start: new Date("2026-01-01T10:00:00Z"),
      end: new Date("2026-01-01T11:00:00Z"),
      etag: '"event-etag"',
      href: "/calendars/user/work/event-1.ics",
      status,
      recurrenceRule,
      alarms: [alarm],
    };
    const todo: Todo = {
      uid: "todo-1",
      summary: "Ship polish pass",
      href: "/calendars/user/work/todo-1.ics",
      status: todoStatus,
    };
    const eventRef: EventRef = { href: event.href, etag: event.etag };
    const todoRef: TodoRef = { href: todo.href, etag: todo.etag ?? "" };
    const cache: CalDAVClientCache = {
      userPrincipal: "/principals/user/",
      calendarHome: "/calendars/user/",
    };
    const timezone: VTimezone = {
      tzid: "Europe/Berlin",
      raw: "BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin\r\nEND:VTIMEZONE",
    };
    const eventSync: SyncChangesResult = {
      changed: true,
      newCtag: "ctag-2",
      newEvents: [eventRef.href],
      updatedEvents: [],
      deletedEvents: [],
    };
    const todoSync: SyncTodosResult = {
      changed: true,
      newCtag: "ctag-3",
      newTodos: [todoRef.href],
      updatedTodos: [],
      deletedTodos: [],
    };

    expect({
      options,
      calendar,
      event,
      todo,
      cache,
      timezone,
      eventSync,
      todoSync,
    }).toBeTruthy();
  });
});
