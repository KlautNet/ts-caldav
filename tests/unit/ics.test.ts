import { describe, expect, test } from "vitest";
import ICAL from "ical.js";
import { normalizeIcs } from "../../src/utils/ics";

const vevent = (rrule: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:s\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:20300902T100000Z\r\nDTEND:20300902T110000Z\r\n${rrule}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

const untilOf = (ics: string) =>
  new ICAL.Component(ICAL.parse(ics))
    .getFirstSubcomponent("vevent")!
    .getFirstPropertyValue<ICAL.Recur>("rrule")!
    .until!.toString();

describe("normalizeIcs – UNTIL written in extended ISO form (#29)", () => {
  test("rewrites a date UNTIL to the basic form", () => {
    const fixed = normalizeIcs(vevent("RRULE:FREQ=WEEKLY;UNTIL=2030-12-30"));

    expect(fixed).toContain("RRULE:FREQ=WEEKLY;UNTIL=20301230\r\n");
    expect(untilOf(fixed)).toBe("2030-12-30");
  });

  test("rewrites a date-time UNTIL that ical.js would otherwise reject", () => {
    const broken = vevent("RRULE:FREQ=WEEKLY;UNTIL=2030-12-30T10:00:00Z");
    expect(() => untilOf(broken)).toThrow(/Could not extract integer/);

    expect(untilOf(normalizeIcs(broken))).toBe("2030-12-30T10:00:00Z");
  });

  test("handles an UNTIL that is not the last part, and a folded line", () => {
    const folded = vevent(
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;BYMONTHDAY=1;BYMONTH=3;UNTIL=2030-1\r\n 2-30T10:00:00Z;WKST=SU",
    );

    const fixed = normalizeIcs(folded);
    expect(fixed).toContain("UNTIL=20301230T100000Z;WKST=SU");
    expect(untilOf(fixed)).toBe("2030-12-30T10:00:00Z");
  });

  test("leaves well-formed data untouched", () => {
    for (const ics of [
      vevent("RRULE:FREQ=WEEKLY;UNTIL=20301230T100000Z"),
      vevent("RRULE:FREQ=WEEKLY;COUNT=3"),
      vevent("DESCRIPTION:ends 2030-12-30T10:00:00Z, UNTIL=2030-12-30 is just text"),
    ]) {
      expect(normalizeIcs(ics)).toBe(ics);
    }
  });
});
