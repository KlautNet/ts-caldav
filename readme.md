# ts-caldav

[![npm version](https://img.shields.io/npm/v/ts-caldav.svg)](https://www.npmjs.com/package/ts-caldav)
[![Run Tests](https://github.com/KlautNet/ts-caldav/actions/workflows/test.yml/badge.svg)](https://github.com/KlautNet/ts-caldav/actions/workflows/test.yml)

> A lightweight, promise-based TypeScript CalDAV client for syncing calendar data in browser, Node.js, or React Native environments.

**ts-caldav** helps you interact with CalDAV servers — allowing you to fetch calendars, manage events (including recurring events), and synchronize changes with minimal effort. Great for building calendar apps or integrations.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Known Working Servers](#known-working-servers)
- [API Documentation](#api-documentation)
- [Timezone Support](#timezone-support)
- [Recurrence Support](#recurrence-support)
- [Auth Notes](#auth-notes)
- [Example: Sync Local Calendar](#example-use-case-sync-local-calendar)
- [Limitations](#limitations)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- Credential validation with CalDAV servers
- Fetch calendar homes and individual calendars
- List, create (including recurring), and delete events
- Detect event changes using `getctag` and `etag`
- Efficient sync with diff-based event updates
- Built for TypeScript, with full type safety

## Installation

```bash
npm install ts-caldav
# or
pnpm install ts-caldav
# or
yarn add ts-caldav
```

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

> 💡 **Note:** Some servers may require enabling CalDAV support or generating app-specific passwords (especially iCloud and Fastmail).

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

### `createEvent(calendarUrl, eventData)`

Supports full-day, recurring, and timezone-aware events.

```ts
await client.createEvent(calendar.url, {
  summary: "Team Sync",
  start: new Date("2025-07-01T09:00:00"),
  end: new Date("2025-07-01T10:00:00"),
  startTzid: "Europe/Berlin",
  endTzid: "Europe/Berlin",
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
To use full timezone definitions, include your own `VTIMEZONE` in raw iCal.

> ⚠️ **ETag Notice:** Some CalDAV servers like Yahoo do not return an ETag header when creating events. Because ETag is required to safely update events, calling updateEvent on strict CalDAV servers may fail unless the ETag is manually retrieved via PROPFIND. You can use the getETag() function to manually fetch the ETag

### `deleteEvent(calendarUrl, eventUid, etag?)`

Delete by UID, optionally using ETag for safe deletion.

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

> ℹ️ Automatically strips weak validator prefixes (e.g., `W/"..."`).

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

### `deleteTodo(calendarUrl: string, todoUid, etag?)`

Deletes a todo by UID.

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

- No WebDAV sync-token (uses getctag diffing)
- Limited to VEVENT and VTODO components

## Roadmap

- Mock requests to prevent flaiky tests
- VCARD and VJOURNAL support

## Development

```bash
git clone https://github.com/yourname/ts-caldav.git
cd ts-caldav
npm install
npm run build
```

## Contributing

Contributions welcome! See [CONTRIBUTING](./contributing.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./license.txt) file for details.
