export interface CalDAVOptions {
  baseUrl: string;
  auth: AuthOptions;
  requestTimeout?: number;
  logRequests?: boolean;
  prodId?: string;
  headers?: Record<string, string>;
  rejectUnauthorized?: boolean;
}

export type AuthOptions =
  | { type: "basic"; username: string; password: string }
  | { type: "oauth"; accessToken: string };

export type SupportedComponent =
  | "VEVENT"
  | "VTODO"
  | "VJOURNAL"
  | "VFREEBUSY"
  | "VTIMEZONE";

export type RecurrenceRule = {
  freq?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  count?: number;
  until?: Date;
  wkst?: string;
  byday?: string[];
  bymonthday?: number[];
  bymonth?: number[];
};

export type Alarm =
  | {
      action: "DISPLAY";
      trigger: string;
      description?: string;
    }
  | {
      action: "EMAIL";
      trigger: string;
      description?: string;
      summary?: string;
      attendees: string[];
    }
  | {
      action: "AUDIO";
      trigger: string;
    };

export interface EventRef {
  href: string;
  etag: string;
}

export interface SyncChangesResult {
  changed: boolean;
  newCtag: string;
  newEvents: string[];
  updatedEvents: string[];
  deletedEvents: string[];
}

export interface Calendar {
  displayName: string;
  url: string;
  ctag?: string;
  supportedComponents: SupportedComponent[];
  color?: string;
}

export const EVENT_STATUSES = ["TENTATIVE", "CONFIRMED", "CANCELLED"] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface Event {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  status?: EventStatus;
  etag: string;
  href: string;
  wholeDay?: boolean;
  recurrenceRule?: RecurrenceRule;
  startTzid?: string;
  endTzid?: string;
  alarms?: Alarm[];
  customFields?: Record<string, string | string[]>;
  /**
   * Set when this component overrides a single occurrence of a recurring
   * series (`RECURRENCE-ID`). It carries the *original* start of the
   * overridden occurrence, which stays fixed even when the override moves the
   * occurrence to a different time.
   */
  recurrenceId?: Date;
  /** Occurrences removed from the series (`EXDATE`). Master component only. */
  exdates?: Date[];
  /** Occurrences added to the series (`RDATE`). Master component only. */
  rdates?: Date[];
}

/**
 * Which occurrences of a recurring series an operation applies to.
 * `"this"` touches the single occurrence; `"thisAndFuture"` also drops every
 * later one by truncating the series.
 */
export type OccurrenceScope = "this" | "thisAndFuture";

/** The fields an override may change on a single occurrence. */
export type OccurrenceChanges = Partial<
  Pick<
    Event,
    | "summary"
    | "description"
    | "location"
    | "status"
    | "start"
    | "end"
    | "alarms"
    | "customFields"
  >
>;

/** Identifies the recurring series an occurrence belongs to. */
export type OccurrenceRef = { href?: string; uid?: string; etag?: string };

export type OccurrenceResult = {
  href: string;
  etag: string;
  newCtag: string;
  /** True when the operation removed the whole series resource. */
  seriesDeleted: boolean;
};

export type TodoRef = EventRef;

/**
 * Identifies an item to delete. A plain string is treated as a UID; passing the
 * item itself (or any object carrying its `href`) is preferred, since a server
 * is free to store an item under a filename unrelated to its UID.
 */
export type DeleteTarget =
  | string
  | { uid?: string; href?: string; etag?: string };

export interface VTimezone {
  tzid: string;
  raw: string;
}

export interface SyncTodosResult {
  changed: boolean;
  newCtag: string;
  newTodos: string[];
  updatedTodos: string[];
  deletedTodos: string[];
}

export const TODO_STATUSES = [
  "NEEDS-ACTION",
  "COMPLETED",
  "IN-PROCESS",
  "CANCELLED",
] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface Todo {
  uid: string;
  summary: string;
  start?: Date;
  due?: Date;
  completed?: Date;
  status?: TodoStatus;
  description?: string;
  location?: string;
  etag?: string;
  href: string;
  alarms?: Alarm[];
  sortOrder?: number;
  customFields?: Record<string, string | string[]>;
}

export interface CalDAVClientCache {
  userPrincipal: string;
  calendarHome: string;
  prodId?: string;
}
