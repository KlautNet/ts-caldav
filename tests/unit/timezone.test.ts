import { describe, expect, test } from "vitest";
import ICAL from "ical.js";
import {
  fromZonedTime,
  isKnownTimeZone,
  resolveTime,
  toZonedTime,
} from "../../src/utils/timezone";

const floating = (iso: string) => ICAL.Time.fromDateTimeString(iso);

describe("toZonedTime", () => {
  test("gives the wall-clock time in the zone, without a Z", () => {
    const summer = toZonedTime(new Date("2026-09-28T11:00:00Z"), "Europe/Vienna");
    expect(summer?.toICALString()).toBe("20260928T130000");
    expect(summer?.zone).toBe(ICAL.Timezone.localTimezone);

    const winter = toZonedTime(new Date("2026-01-28T11:00:00Z"), "Europe/Vienna");
    expect(winter?.toICALString()).toBe("20260128T120000");
  });

  test("crosses the date line when the zone offset requires it", () => {
    const time = toZonedTime(new Date("2026-06-30T23:30:00Z"), "Asia/Tokyo");
    expect(time?.toICALString()).toBe("20260701T083000");
  });

  test("is undefined for a zone the runtime does not know", () => {
    expect(toZonedTime(new Date(), "W. Europe Standard Time")).toBeUndefined();
    expect(isKnownTimeZone("W. Europe Standard Time")).toBe(false);
    expect(isKnownTimeZone("Europe/Vienna")).toBe(true);
  });
});

describe("fromZonedTime", () => {
  test("inverts toZonedTime in summer and winter", () => {
    for (const iso of ["2026-09-28T11:00:00Z", "2026-01-28T11:00:00Z"]) {
      const zoned = toZonedTime(new Date(iso), "Europe/Vienna")!;
      expect(fromZonedTime(zoned, "Europe/Vienna")?.toISOString()).toBe(
        new Date(iso).toISOString(),
      );
    }
  });

  test("handles negative offsets", () => {
    const time = fromZonedTime(floating("2026-03-15T09:00:00"), "America/New_York");
    expect(time?.toISOString()).toBe("2026-03-15T13:00:00.000Z");
  });

  test("resolves a time inside the spring-forward gap without drifting a day", () => {
    // 02:30 does not exist on 2026-03-29 in Vienna; it maps to a nearby instant.
    const time = fromZonedTime(floating("2026-03-29T02:30:00"), "Europe/Vienna");
    expect(time?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  test("is undefined for an unknown zone", () => {
    expect(fromZonedTime(floating("2026-09-28T13:00:00"), "Nowhere/City")).toBeUndefined();
  });
});

describe("resolveTime", () => {
  test("interprets a floating time in the given zone", () => {
    expect(
      resolveTime(floating("2026-09-28T13:00:00"), "Europe/Vienna").toISOString(),
    ).toBe("2026-09-28T11:00:00.000Z");
  });

  test("leaves UTC and DATE values alone", () => {
    const utc = ICAL.Time.fromDateTimeString("2026-09-28T11:00:00Z");
    expect(resolveTime(utc, "Europe/Vienna").toISOString()).toBe(
      "2026-09-28T11:00:00.000Z",
    );

    const date = ICAL.Time.fromDateString("2026-09-28");
    expect(resolveTime(date, "Europe/Vienna").getTime()).toBe(
      date.toJSDate().getTime(),
    );
  });

  test("falls back to ical.js for an unknown zone", () => {
    const time = floating("2026-09-28T13:00:00");
    expect(resolveTime(time, "Nowhere/City").getTime()).toBe(
      time.toJSDate().getTime(),
    );
  });
});
