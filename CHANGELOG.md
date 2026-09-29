# Changelog

All notable changes to this project are documented here. This project adheres
to [Semantic Versioning](https://semver.org/). While the package is pre-`1.0`,
minor releases may carry notable internal changes worth reviewing.

## 0.5.0

### Added

- **Occurrence-level editing for recurring events.** `updateOccurrence` changes
  a single occurrence by writing an override component (same UID, plus a
  `RECURRENCE-ID`) into the series resource, and `deleteOccurrence` removes one
  occurrence via `EXDATE` — or, with `{ scope: "thisAndFuture" }`, that
  occurrence and every later one by truncating the rule with `UNTIL`. Both read
  the resource, amend it and write it back, so existing overrides survive; a
  `thisAndFuture` cut at the first occurrence deletes the series outright and
  reports `seriesDeleted`.
- **`RECURRENCE-ID`, `EXDATE` and `RDATE` are parsed and written.** `Event`
  gains `recurrenceId` (set on an override, carrying the original start of the
  occurrence it replaces), plus `exdates` and `rdates` on the master. They
  previously landed in `customFields` on read and were dropped on write.
- New public types: `OccurrenceScope`, `OccurrenceChanges`, `OccurrenceRef` and
  `OccurrenceResult`.

### Fixed

- **Timezone-aware events are no longer written as UTC with a `TZID`** (#27).
  `createEvent` and `updateEvent` wrote `DTSTART;TZID=Europe/Vienna:...T110000Z`,
  a UTC value carrying a `TZID` parameter, which RFC 5545 forbids. Clients
  resolve that ambiguity differently: iOS Calendar honoured the `TZID` and
  showed the event shifted by the zone's offset. The value is now the
  wall-clock time in the zone (`...T130000`), converted with the runtime's
  `Intl` zone data; a `TZID` the runtime does not know (e.g. a Windows zone
  name) falls back to plain UTC without the parameter.
- **A `TZID` without a matching `VTIMEZONE` is read in that zone, not in the
  process's local zone** (#27). ical.js resolves a `TZID` only through a
  `VTIMEZONE` embedded in the resource, so `DTSTART;TZID=Europe/Vienna:...`
  from a server that stores none parsed as a floating time and `getEvents`
  returned an instant that depended on the server process's `TZ`. Start, end,
  `RECURRENCE-ID`, `EXDATE` and `RDATE` now resolve through the same `Intl`
  data, and `updateOccurrence` / `deleteOccurrence` match occurrences the same
  way.
- **`Event.status` is now written to the `VEVENT`** (#26). `createEvent` and
  `updateEvent` silently dropped the field, so a status set on an event never
  reached the server (`getEvents` then read it back as `undefined`). The VTODO
  builder already emitted `STATUS`; the VEVENT builder now does too.
- **`deleteEvent` / `deleteTodo` no longer fail on items the server named
  itself** (#25). The delete URL was always built as `<calendar>/<uid>.ics`,
  which 404s for every item stored under a server-chosen filename — Nextcloud's
  web UI, for one, uses a filename unrelated to the event UID. The item's own
  `href` is now used when available, and a UID-only call that 404s falls back to
  looking the href up by UID.
- **A weak ETag is no longer sent as an `If-Match` validator on delete** (#25),
  which servers reject with `412`. This matches how `updateEvent` / `updateTodo`
  already handled weak ETags.

### Changed

- `deleteEvent(calendarUrl, event, etag?)` and `deleteTodo(calendarUrl, todo,
  etag?)` accept the item itself (or any object with `href`/`uid`/`etag`) in
  addition to a bare UID string, and default the `If-Match` validator to the
  passed item's ETag. Existing UID-string calls keep working. The new
  `DeleteTarget` type is exported from the package entry point.

## 0.4.0

### Changed

- **HTTP layer migrated from `axios` to the runtime's native `fetch`.** `axios`
  is no longer a dependency. The public API (methods, arguments, return types,
  and `CalDAVError`) is unchanged, but a few behavioral details differ — see
  below. Node.js **18 or newer** is now required (added `engines.node >= 18`),
  since native `fetch` is used.
- `CalDAVOptions.headers` is now typed as `Record<string, string>` instead of
  the axios-specific `AxiosHeaders`. Plain header objects continue to work
  unchanged; only code that explicitly typed headers as `AxiosHeaders` needs
  updating.
- **Unified error handling: every failure thrown from a public method is now a
  `CalDAVError`** with an optional `.status` (HTTP status code) and `.cause`
  (the underlying error). Previously some read paths (e.g. `getCalendars`,
  `getCtag`, `syncChanges`) could surface an axios error or an internal
  transport error. Timeouts and network failures are wrapped too. Replace any
  `axios.isAxiosError(...)` checks with `error instanceof CalDAVError`.

### Fixed

- **Sub-path `baseUrl` no longer doubles the path segment on `getEvents` /
  `getTodos` / multiget** (#23). Under axios, a `baseUrl` such as Baikal's
  `http://host/dav.php/` combined with an absolute calendar href like
  `/dav.php/calendars/user/default/` produced a doubled
  `…/dav.php/dav.php/…` REPORT URL (404). The `fetch` layer resolves URLs with
  WHATWG `new URL(url, baseUrl)`, which replaces the whole path for an
  absolute-path href, so the request now hits the calendar exactly once. The
  resulting `CalDAVError` also carries the real `.status`/`.cause` instead of a
  generic message, making such issues diagnosable.
- **`rejectUnauthorized: false` works again.** During the initial `fetch`
  migration this option was accepted but silently ignored. It is now honored in
  Node.js via an [`undici`](https://www.npmjs.com/package/undici) dispatcher
  (install `undici`, or set `NODE_TLS_REJECT_UNAUTHORIZED=0`). On runtimes where
  TLS verification cannot be disabled (browsers, React Native, or Node without
  `undici`), a warning is logged instead of the option being silently dropped.

### Added

- Opt-in server-side expansion of recurring events/todos via the
  `expand?: boolean` option on `getEvents()` and `getTodos()`.
- `/dav.php` added to the auto-discovery candidate roots, so Baikal / sabre/dav
  deployments are discovered without manually pinning `baseUrl` to the sub-path.
- New exported types: `AuthOptions`, `CalDAVClientCache`, `EventRef`,
  `EventStatus`, `TodoRef`, `TodoStatus`, `SupportedComponent`,
  `SyncChangesResult`, `SyncTodosResult`, `VTimezone`, and the `EVENT_STATUSES`
  / `TODO_STATUSES` constants.

### Internal

- Extracted the monolithic client into `protocol/` and `utils/` modules.
- Added request timeouts and optional request logging (`requestTimeout`,
  `logRequests`).
