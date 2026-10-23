/** Rewrites `RRULE` `UNTIL` values from ISO extended form to the RFC 5545 basic form. */
const EXTENDED_UNTIL =
  /^(RRULE[^\r\n]*?;?UNTIL=)(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(Z?))?/gm;

export const normalizeIcs = (ics: string): string => {
  if (!ics.includes("UNTIL=")) return ics;

  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  return unfolded.replace(
    EXTENDED_UNTIL,
    (_, head, y, mo, d, h, mi, s, z) =>
      h === undefined ? `${head}${y}${mo}${d}` : `${head}${y}${mo}${d}T${h}${mi}${s}${z}`,
  );
};
