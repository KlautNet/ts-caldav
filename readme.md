# ts-caldav

[![npm version](https://img.shields.io/npm/v/ts-caldav.svg)](https://www.npmjs.com/package/ts-caldav)
[![Run Tests](https://github.com/KlautNet/ts-caldav/actions/workflows/test.yml/badge.svg)](https://github.com/KlautNet/ts-caldav/actions/workflows/test.yml)

> A lightweight, promise-based TypeScript CalDAV client for syncing calendar data in browser, Node.js, or React Native environments.

**ts-caldav** helps you interact with CalDAV servers, allowing you to fetch calendars, manage events (including recurring events), and synchronize changes with minimal effort. Great for building calendar apps or integrations.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Known Working Servers](#known-working-servers)
- [API Documentation](#api-documentation)
- [Timezone Support](#timezone-support)
- [Recurrence Support](#recurrence-support)
- [Error Handling](#error-handling)
- [Auth Notes](#auth-notes)
- [Example: Sync Local Calendar](#example-use-case-sync-local-calendar)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- Credential validation with CalDAV servers
- Automatic CalDAV endpoint discovery
- Fetch calendar homes and individual calendars (with color support)
- List, create (including recurring), update, and delete events and todos (VTODO)
- Edit or remove a single occurrence of a recurring series, or that occurrence
  and every later one
- Optional server-side expansion of recurring events into individual occurrences
- Detect changes using `getctag` and `etag`
- Efficient sync with diff-based updates
- Unified error handling via a single `CalDAVError` type
- Built for TypeScript, with full type safety

## Installation

```bash
npm install ts-caldav
# or
pnpm install ts-caldav
# or
yarn add ts-caldav
```

> **Requirements:** ts-caldav bundles no HTTP-client dependency — it uses the
> runtime's built-in web APIs (`fetch`, `AbortController`, `URL`, `btoa`). It
> therefore runs on any runtime that provides them, including:
>
> - **Node.js 18+** (where `fetch` became a global)
> - **modern browsers**
> - **React Native** (`fetch`/`AbortController` are built in)
> - **edge runtimes** — Cloudflare Workers, Deno, Bun, Vercel Edge
>
> The `engines.node` field (`>=18`) only constrains Node itself and does not
> restrict browser, React Native, or edge deployments. The optional `undici`
> fallback for `rejectUnauthorized: false` is Node-only and loaded lazily, so it
> never affects other runtimes. (Basic auth relies on `btoa`; on older React
> Native versions without it, add a small `btoa` polyfill or use OAuth.)

## Quick Start

```ts
import { CalDAVClient } from "ts-caldav";

const client = await CalDAVClient.create({
  baseUrl: "https://caldav.example.com",
  auth: {
    type: "basic",
    username: "myuser",
    password: "mypassword",
  }
});

// List calendars
const calendars = await client.getCalendars();

// Fetch events
const events = await client.getEvents(calendars[0].url);
```

## Known Working Servers

| Provider      | Endpoint Example |
|:--------------|:------------------|
| **Google**    | `https://apidata.googleusercontent.com/` |
| **iCloud**    | `https://caldav.icloud.com/` |
| **Yahoo**     | `https://caldav.calendar.yahoo.com` |
| **GMX**       | `https://caldav.gmx.net` |
| **Fastmail**  | `https://caldav.fastmail.com` |
| **Nextcloud** | `https://your-host/remote.php/dav` |
| **Baikal**    | `https://your-host` (or `https://your-host/dav.php`) |
| **Radicale**  | `https://your-host` |

> **Note:** Some servers may require enabling CalDAV support or generating app-specific passwords, especially iCloud and Fastmail.

## API Documentation

### `CalDAVClient.create(options)`

Creates and validates a new CalDAV client instance.

```ts
const client = await CalDAVClient.create({
  baseUrl: "https://caldav.example.com",
  auth: {
    type: "basic",
    username: "john",
    password: "secret",
  },
  logRequests: true,
});
```

#### Options

| Option               | Type                              | Default             | Description                                                                                                      |
| -------------------- | --------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `baseUrl`            | `string`                          | —                   | Base URL of the CalDAV server. Required.                                                                          |
| `auth`               | `{ type: "basic", ... }` \| `{ type: "oauth", accessToken }` | — | Credentials. Required.                                                               |
| `requestTimeout`     | `number` (ms)                     | `5000`              | Aborts a request after this many milliseconds. Set `0` to disable.                                               |
| `logRequests`        | `boolean`                         | `false`             | Logs each request method, URL, and response status via `console.debug`.                                          |
| `prodId`             | `string`                          | ts-caldav default   | `PRODID` written into generated iCalendar data.                                                                  |
| `headers`            | `Record<string, string>`          | `{}`                | Extra headers merged into every request.                                                                         |
| `rejectUnauthorized` | `boolean`                         | `true`              | Set `false` to allow self-signed / invalid TLS certificates. See the note below.                                |

> **`rejectUnauthorized: false` and native `fetch`:** ts-caldav uses the runtime's
> built-in `fetch`, which has no per-request TLS toggle. To disable certificate
> verification in **Node.js**, install [`undici`](https://www.npmjs.com/package/undici)
> (`npm i undici`) — ts-caldav will use it automatically — or set the
> `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable. If neither is available
> the option can't take effect and a warning is logged rather than failing
> silently. Only use this against servers you control.

### `CalDAVClient.createFromCache(options, cache)`

Restores a client from cached state without re-fetching calendar home or validating credentials.

```ts
const cache = client.exportCache();
const restored = await CalDAVClient.createFromCache({
  baseUrl: "https://caldav.example.com",
  auth: {
    type: "basic",
    username: "john",
    password: "secret",
  }
}, cache);
```

### `getCalendars(): Promise<Calendar[]>`

Returns an array of available calendars.

### `getEvents(calendarUrl: string, options?): Promise<Event[]>`

Fetches events within a given time range (defaults to 3 weeks ahead). When `all` is true and no range is provided, fetches all events.

```ts
const events = await client.getEvents(calendarUrl, {
  start: new Date(),
  end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  all: false
});
```

Pass `expand: true` (only valid together with a `start`/`end` range) to have the
server expand recurring events into their individual occurrences instead of
returning the master event with its recurrence rule:

```ts
const occurrences = await client.getEvents(calendarUrl, {
  start: new Date(),
  end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  expand: true,
});
```

The same `options` (including `expand`) apply to `getTodos`.

### `createEvent(calendarUrl, eventData)`

Supports full-day, recurring, and timezone-aware events.

```ts
await client.createEvent(calendar.url, {
  summary: "Team Sync",
  start: new Date("2025-07-01T09:00:00"),
  end: new Date("2025-07-01T10:00:00"),
  startTzid: "Europe/Berlin",
  endTzid: "Europe/Berlin",
  status: "CONFIRMED",
  alarms: [
    { action: "DISPLAY", trigger: "-PT30M", description: "Popup reminder" },
    { action: "AUDIO", trigger: "-PT15M" },
    {
      action: "EMAIL",
      trigger: "-PT10M",
      summary: "Email Reminder",
      description: "Meeting coming up",
      attendees: ["mailto:test@example.com"],
    },
  ],
});
```

If `startTzid`/`endTzid` omitted, event stored in UTC.  
With a `TZID`, the value is written as the wall-clock time in that zone
(`DTSTART;TZID=Europe/Berlin:20250701T090000`), converted from the `Date`
instant using the runtime's `Intl` zone data. A zone name the runtime does not
know (for example a Windows zone name) falls back to UTC without a `TZID`.  
To use full timezone definitions, include your own `VTIMEZONE` in raw iCal.

> **ETag notice:** Some CalDAV servers, such as Yahoo, do not return an ETag header when creating events. Because ETag is required to safely update events, calling `updateEvent` on strict CalDAV servers may fail unless the ETag is retrieved via PROPFIND. Use `getETag()` to fetch it manually.

### `deleteEvent(calendarUrl, event, etag?)`

Deletes an event, optionally using an ETag for safe deletion.

`event` may be the event itself (or any object with an `href`), or a bare UID
string. Prefer passing the event: servers such as Nextcloud store an item under
a filename unrelated to its UID, so a UID alone cannot be turned into the item's
URL. When only a UID is given and no item exists at `<calendar>/<uid>.ics`, the
href is looked up by UID before deleting.

```ts
const [event] = await client.getEvents(calendarUrl);
await client.deleteEvent(calendarUrl, event); // uses event.href and event.etag
```

### `updateOccurrence(calendarUrl, event, occurrenceStart, changes)`

Changes a single occurrence of a recurring series without touching the rest of
it. An override component (same UID, plus a `RECURRENCE-ID`) is written into the
series resource; calling it again for the same occurrence patches that override
instead of adding a second one.

`occurrenceStart` is the occurrence's **original** start, as generated by the
recurrence rule. It keeps identifying the occurrence after an override moves it,
so keep passing the original value rather than the new one.

```ts
await client.updateOccurrence(
  calendarUrl,
  event, // or { href } / { uid }
  new Date("2026-10-19T09:00:00Z"),
  { summary: "Moved this week", start: new Date("2026-10-19T14:00:00Z") },
);
```

### `deleteOccurrence(calendarUrl, event, occurrenceStart, options?)`

Removes one occurrence of a recurring series (`EXDATE`), or — with
`{ scope: "thisAndFuture" }` — that occurrence and every later one, by
truncating the series with `UNTIL`.

Cutting at or before the first occurrence would leave an empty series, so the
resource is deleted instead; the returned `seriesDeleted` says which happened.

```ts
// Just this one
await client.deleteOccurrence(calendarUrl, event, occurrenceStart);

// This one and everything after it
const { seriesDeleted } = await client.deleteOccurrence(
  calendarUrl,
  event,
  occurrenceStart,
  { scope: "thisAndFuture" },
);
```

Both methods read the series resource, amend it and write it back, so overrides
and anything else stored alongside the series are preserved. They reject
non-recurring events — use `updateEvent`/`deleteEvent` for those.

### `syncChanges(calendarUrl, previousCtag, localEventRefs)`

Compares remote state using `getctag`/`etag` and returns:

- `changed`
- `newCtag`
- `newEvents`
- `updatedEvents`
- `deletedEvents`

### `getEventsByHref(calendarUrl, hrefs)`

Fetch `.ics` data for specific events.

### `getETag(href)`

Fetch the current ETag for an event.

```ts
const etag = await client.getETag("/calendars/user/calendar-id/event-id.ics");
await client.updateEvent(calendarUrl, {
  uid: "event-id",
  href: "/calendars/user/calendar-id/event-id.ics",
  etag,
  summary: "Updated summary",
  start: new Date(),
  end: new Date(Date.now() + 60 * 60 * 1000),
});
```

> Automatically strips weak validator prefixes (e.g., `W/"..."`).

## Todo API

### `getTodos(calendarUrl: string, options?): Promise<Todo[]>`

Fetches todos within a given range or all.

### `getTodosByHref(calendarUrl: string, hrefs: string[]): Promise<Todo[]>`

Fetches full `.ics` data for specific todos.

### `createTodo(calendarUrl: string, todoData)`

Creates a new todo.

```ts
await client.createTodo(calendar.url, {
  summary: "Buy groceries",
  due: new Date("2025-08-12T18:00:00"),
  alarms: [{ action: "DISPLAY", trigger: "-PT1H", description: "Reminder" }]
});
```

### `updateTodo(calendarUrl: string, todo)`

Updates an existing todo.

### `deleteTodo(calendarUrl: string, todo, etag?)`

Deletes a todo. Like `deleteEvent`, `todo` may be the todo itself (preferred, so
its `href` and `etag` are used) or a bare UID string.

### `syncTodoChanges(calendarUrl, previousCtag, localTodoRefs)`

Compares remote todo list state with local references using `getctag` and `etag`.
Returns:

- `changed`
- `newCtag`
- `newTodos`
- `updatedTodos`
- `deletedTodos`

## Timezone Support

```ts
await client.createEvent(calendar.url, {
  summary: "Flight to SF",
  start: new Date("2025-07-01T15:00:00"),
  end: new Date("2025-07-01T18:00:00"),
  startTzid: "Europe/Berlin",
  endTzid: "America/Los_Angeles",
});
```

When fetching, `startTzid`/`endTzid` will be parsed for correct interpretation and normalization.
A `TZID` the resource carries no `VTIMEZONE` for is resolved with the
runtime's `Intl` zone data, so `start`/`end` are the same instants whatever
the process's own time zone is.

## Recurrence Support

Supports `freq`, `interval`, `count`, `until`, `byday`, `bymonthday`, `bymonth`.

```ts
recurrenceRule: {
  freq: "MONTHLY",
  interval: 1,
  byday: ["FR"],
  until: new Date("2025-12-31"),
}
```

### Exceptions and overrides

A recurring series lives in one calendar resource: a master component plus one
override component per occurrence that differs from the rule. `getEvents`
returns each component it finds, so a series with an override comes back as two
`Event`s sharing a `uid`:

- the **master** carries `recurrenceRule`, plus `exdates`/`rdates` for
  occurrences removed from or added to the series;
- an **override** carries `recurrenceId` — the original start of the occurrence
  it replaces — and the fields that differ for it.

```ts
const components = await client.getEvents(calendarUrl, range);
const series = components.filter((e) => e.uid === uid);

const master = series.find((e) => !e.recurrenceId);
const overrides = series.filter((e) => e.recurrenceId);
```

Use [`updateOccurrence`](#updateoccurrencecalendarurl-event-occurrencestart-changes)
and [`deleteOccurrence`](#deleteoccurrencecalendarurl-event-occurrencestart-options)
to edit a series occurrence by occurrence; `updateEvent` rewrites the whole
resource and drops any override in it.

## Error Handling

Every failure thrown from a public method is a `CalDAVError`. It exposes an
optional `status` (the HTTP status code, when the failure came from a response)
and, for wrapped lower-level failures, the original error as `cause`.

```ts
import { CalDAVClient, CalDAVError } from "ts-caldav";

try {
  await client.getEvents(calendarUrl);
} catch (err) {
  if (err instanceof CalDAVError) {
    console.error(err.message, err.status); // e.g. "HTTP 404", 404
    console.error(err.cause); // underlying error, if any
  }
}
```

Request timeouts and network failures are wrapped in `CalDAVError` too, so a
single `catch` is enough.

## Auth Notes

- Basic Auth & OAuth2 supported
- Works with Google, iCloud, Fastmail, Nextcloud, Radicale

## Example Use Case: Sync Local Calendar

```ts
const result = await client.syncChanges(calendar.url, lastCtag, localEventRefs);
if (result.changed) {
  const newEvents = await client.getEventsByHref(calendar.url, [
    ...result.newEvents,
    ...result.updatedEvents,
  ]);
  updateLocalDatabase(newEvents, result.deletedEvents);
  saveNewCtag(result.newCtag);
}
```

## Limitations

- No WebDAV sync-token support yet; synchronization currently uses `getctag` plus ETag diffing.
- Component support is currently focused on `VEVENT` and `VTODO`.
- Occurrence edits apply to a single occurrence (`"this"`) or drop the tail of a
  series (`"thisAndFuture"`). Changing an occurrence *and every later one* is not
  supported yet — split the series manually by truncating it and creating a new
  event for the remainder.
- Recurrence rules are not expanded locally; use `expand` to have the server
  return individual occurrences.

## Roadmap

- Add deterministic mocked request fixtures for common server response shapes.
- Add WebDAV sync-token support with `getctag` diffing as a fallback.
- Expand component support after the `VEVENT` and `VTODO` APIs are stable.
- Continue hardening provider compatibility for Google, iCloud, Nextcloud, Fastmail, and Radicale.

## Development

```bash
git clone https://github.com/KlautNet/ts-caldav.git
cd ts-caldav
pnpm install
pnpm build
pnpm test
```

## Contributing

Contributions welcome! See [CONTRIBUTING](./contributing.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./license.txt) file for details.
