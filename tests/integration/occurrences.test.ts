import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";
import { Event } from "../../src/models";

const skip = !process.env.CALDAV_BASE_URL;

describe.skipIf(skip)("CalDAV – recurring event occurrences", () => {
  let client: CalDAVClient;
  let calendarUrl: string;

  // A fixed weekly series keeps every expected occurrence a known value.
  const FIRST = new Date("2026-10-05T09:00:00Z");
  const SECOND = new Date("2026-10-12T09:00:00Z");
  const THIRD = new Date("2026-10-19T09:00:00Z");
  const FOURTH = new Date("2026-10-26T09:00:00Z");
  const window = {
    start: new Date("2026-10-01T00:00:00Z"),
    end: new Date("2026-12-01T00:00:00Z"),
  };

  beforeAll(async () => {
    client = await CalDAVClient.create({
      baseUrl: process.env.CALDAV_BASE_URL!,
      auth: {
        type: "basic",
        username: process.env.CALDAV_USERNAME!,
        password: process.env.CALDAV_PASSWORD!,
      },
      requestTimeout: 30000,
    });
    const calendars = await client.getCalendars();
    calendarUrl =
      calendars.find((c) => c.supportedComponents.includes("VEVENT"))?.url ??
      calendars[0].url;
  });

  const createSeries = async (summary: string) =>
    client.createEvent(calendarUrl, {
      summary,
      start: FIRST,
      end: new Date(FIRST.getTime() + 3_600_000),
      recurrenceRule: { freq: "WEEKLY", count: 6 },
    });

  const componentsOf = async (uid: string): Promise<Event[]> => {
    const events = await client.getEvents(calendarUrl, {
      ...window,
      expand: false,
    });
    return events.filter((event) => event.uid === uid);
  };

  const masterOf = async (uid: string) =>
    (await componentsOf(uid)).find((event) => !event.recurrenceId);

  test("deleting one occurrence excludes it from the series", async () => {
    const { uid, href } = await createSeries("occurrence – exdate");

    const result = await client.deleteOccurrence(calendarUrl, { href }, SECOND);
    expect(result.seriesDeleted).toBe(false);

    const master = await masterOf(uid);
    expect(master?.exdates?.map((d) => d.toISOString())).toContain(
      SECOND.toISOString(),
    );
    // The rest of the series is untouched.
    expect(master?.recurrenceRule?.count).toBe(6);

    await client.deleteEvent(calendarUrl, { uid, href });
  });

  test("updating one occurrence writes an override for it", async () => {
    const { uid, href } = await createSeries("occurrence – override");
    const movedTo = new Date("2026-10-19T14:00:00Z");

    await client.updateOccurrence(calendarUrl, { href }, THIRD, {
      summary: "moved instance",
      start: movedTo,
      end: new Date(movedTo.getTime() + 3_600_000),
    });

    const components = await componentsOf(uid);
    expect(components).toHaveLength(2);

    const override = components.find((event) => event.recurrenceId);
    expect(override?.recurrenceId?.toISOString()).toBe(THIRD.toISOString());
    expect(override?.summary).toBe("moved instance");
    expect(override?.start.toISOString()).toBe(movedTo.toISOString());

    // The master keeps its own summary and rule.
    const master = components.find((event) => !event.recurrenceId);
    expect(master?.summary).toBe("occurrence – override");
    expect(master?.recurrenceRule?.freq).toBe("WEEKLY");

    await client.deleteEvent(calendarUrl, { uid, href });
  });

  test("updating the same occurrence twice patches the existing override", async () => {
    const { uid, href } = await createSeries("occurrence – patch");

    await client.updateOccurrence(calendarUrl, { href }, THIRD, {
      summary: "first",
    });
    await client.updateOccurrence(calendarUrl, { href }, THIRD, {
      summary: "second",
    });

    const components = await componentsOf(uid);
    expect(components).toHaveLength(2);
    expect(components.find((e) => e.recurrenceId)?.summary).toBe("second");

    await client.deleteEvent(calendarUrl, { uid, href });
  });

  test("deleting an overridden occurrence drops the override with it", async () => {
    const { uid, href } = await createSeries("occurrence – override removal");

    await client.updateOccurrence(calendarUrl, { href }, THIRD, {
      summary: "override",
    });
    await client.deleteOccurrence(calendarUrl, { href }, THIRD);

    const components = await componentsOf(uid);
    expect(components).toHaveLength(1);
    expect(components[0].exdates?.map((d) => d.toISOString())).toContain(
      THIRD.toISOString(),
    );

    await client.deleteEvent(calendarUrl, { uid, href });
  });

  test("thisAndFuture truncates the series before the occurrence", async () => {
    const { uid, href } = await createSeries("occurrence – truncate");

    const result = await client.deleteOccurrence(calendarUrl, { href }, FOURTH, {
      scope: "thisAndFuture",
    });
    expect(result.seriesDeleted).toBe(false);

    const master = await masterOf(uid);
    expect(master?.recurrenceRule?.count).toBeUndefined();
    expect(master?.recurrenceRule?.until?.getTime()).toBe(
      FOURTH.getTime() - 1000,
    );

    await client.deleteEvent(calendarUrl, { uid, href });
  });

  test("thisAndFuture from the first occurrence deletes the whole series", async () => {
    const { uid, href } = await createSeries("occurrence – full removal");

    const result = await client.deleteOccurrence(calendarUrl, { href }, FIRST, {
      scope: "thisAndFuture",
    });
    expect(result.seriesDeleted).toBe(true);
    expect(await componentsOf(uid)).toHaveLength(0);
  });

  test("a uid-only reference resolves the series", async () => {
    const { uid, href } = await createSeries("occurrence – by uid");

    await expect(
      client.deleteOccurrence(calendarUrl, { uid }, SECOND),
    ).resolves.toMatchObject({ seriesDeleted: false });

    await client.deleteEvent(calendarUrl, { uid, href });
  });

  test("occurrence edits are rejected for a non-recurring event", async () => {
    const { uid, href } = await client.createEvent(calendarUrl, {
      summary: "occurrence – single",
      start: FIRST,
      end: new Date(FIRST.getTime() + 3_600_000),
    });

    await expect(
      client.deleteOccurrence(calendarUrl, { href }, FIRST),
    ).rejects.toThrow(/not a recurring series/);

    await client.deleteEvent(calendarUrl, { uid, href });
  });
});
