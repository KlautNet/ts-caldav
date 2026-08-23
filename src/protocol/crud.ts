import { v4 as uuidv4 } from "uuid";
import { CalDAVError } from "../errors";
import { DeleteTarget } from "../models";
import HttpClient, { HttpResponse } from "../http-client";
import { normalizeSlashEnd } from "../utils/common";
import { PartialBy } from "./types";

type BuildFn<T> = (data: T, uid: string) => string;

type IcsPutFn = (
  href: string,
  ics: string,
  headers?: Record<string, string>,
  validate?: (status: number) => boolean,
) => Promise<HttpResponse>;

const isWeak = (etag?: string): boolean => {
  return !!etag && (etag.startsWith('W/"') || etag.startsWith("W/"));
};

const cleanEtag = (etag?: string): string | undefined => {
  if (!etag) return undefined;
  return etag.replace(/^W\//, "").trim();
};

/**
 * Fetches the ctag after a write that has already committed. CTag is optional
 * sync metadata and is not supported consistently by CalDAV servers, so a
 * failed follow-up lookup must not turn a successful write into an error.
 * Returns "" when unavailable; callers needing a guaranteed-fresh value can
 * call getCtag themselves and handle that error separately.
 */
const getCtagAfterWrite = async (
  calendarUrl: string,
  getCtag: (calendarUrl: string) => Promise<string>,
): Promise<string> => {
  try {
    return await getCtag(calendarUrl);
  } catch {
    return "";
  }
};

export const createItem = async <
  T extends { uid?: string; href?: string; etag?: string },
>(
  calendarUrl: string,
  data: PartialBy<T, "uid" | "href" | "etag">,
  buildFn: BuildFn<PartialBy<T, "uid" | "href" | "etag">>,
  itemType: "event" | "todo",
  mkIcsPut: IcsPutFn,
  getCtag: (calendarUrl: string) => Promise<string>,
): Promise<{ uid: string; href: string; etag: string; newCtag: string }> => {
  if (!calendarUrl)
    throw new CalDAVError(`Calendar URL is required to create a ${itemType}.`);

  const base = normalizeSlashEnd(calendarUrl);
  const uid = data.uid || uuidv4();
  const href = `${base}/${uid}.ics`;
  const ics = buildFn(data, uid);

  try {
    const response = await mkIcsPut(
      href,
      ics,
      { "If-None-Match": "*" },
      (s) => s >= 200 && s < 300,
    );
    const etag = response.headers["etag"] || "";
    const newCtag = await getCtagAfterWrite(calendarUrl, getCtag);
    return { uid, href: `${base}/${uid}.ics`, etag, newCtag };
  } catch (error) {
    if (error instanceof CalDAVError && error.status === 412) {
      throw new CalDAVError(
        `${itemType[0].toUpperCase() + itemType.slice(1)} with the specified uid already exists.`,
        412,
        { cause: error },
      );
    }
    throw new CalDAVError(
      `Failed to create ${itemType}.`,
      error instanceof CalDAVError ? error.status : undefined,
      { cause: error },
    );
  }
};

export const updateItem = async <
  T extends { uid: string; href: string; etag?: string },
>(
  calendarUrl: string,
  item: T,
  buildFn: BuildFn<T>,
  itemType: "event" | "todo",
  mkIcsPut: IcsPutFn,
  getCtag: (calendarUrl: string) => Promise<string>,
  absolutize: (urlOrPath: string) => string,
): Promise<{ uid: string; href: string; etag: string; newCtag: string }> => {
  if (!item.uid || !item.href) {
    throw new CalDAVError(
      `Both 'uid' and 'href' are required to update a ${itemType}.`,
    );
  }

  const ics = buildFn(item, item.uid);

  const ifMatch = cleanEtag(item.etag);
  const extraHeaders: Record<string, string> = {};
  if (ifMatch && !isWeak(item.etag)) {
    extraHeaders["If-Match"] = ifMatch;
  }

  try {
    const response = await mkIcsPut(absolutize(item.href), ics, extraHeaders);
    const newEtag = response.headers["etag"] || "";
    const newCtag = await getCtagAfterWrite(calendarUrl, getCtag);
    return { uid: item.uid, href: item.href, etag: newEtag, newCtag };
  } catch (error) {
    if (error instanceof CalDAVError && error.status === 412) {
      throw new CalDAVError(
        `${itemType[0].toUpperCase() + itemType.slice(1)} with the specified uid does not match.`,
        412,
        { cause: error },
      );
    }
    throw new CalDAVError(
      `Failed to update ${itemType}.`,
      error instanceof CalDAVError ? error.status : undefined,
      { cause: error },
    );
  }
};

export const deleteItem = async (
  calendarUrl: string,
  target: DeleteTarget,
  itemType: "event" | "todo",
  httpClient: Pick<HttpClient, "delete">,
  etag?: string,
  deps?: {
    absolutize?: (urlOrPath: string) => string;
    resolveHrefByUid?: (
      calendarUrl: string,
      uid: string,
    ) => Promise<string | undefined>;
  },
): Promise<void> => {
  const ref = typeof target === "string" ? { uid: target } : target;
  if (!ref.href && !ref.uid) {
    throw new CalDAVError(
      `Either 'uid' or 'href' is required to delete a ${itemType}.`,
    );
  }

  const absolutize = deps?.absolutize ?? ((urlOrPath: string) => urlOrPath);
  const base = normalizeSlashEnd(calendarUrl);

  // A known href always wins: `${base}/${uid}.ics` is only ever a guess, and it
  // is wrong for every item the server named itself (Nextcloud's web UI, for
  // one, uses an unrelated filename).
  const href = ref.href ? absolutize(ref.href) : `${base}/${ref.uid}.ics`;

  // Weak ETags are not usable as an If-Match validator (RFC 9110 §13.1.1), so
  // fall back to "*" instead of letting the server reject the request with 412.
  const validator = etag ?? ref.etag;
  const ifMatch =
    validator && !isWeak(validator) ? (cleanEtag(validator) as string) : "*";

  const send = (url: string) =>
    httpClient.delete(url, {
      headers: { "If-Match": ifMatch },
      validateStatus: (s) => s === 204 || s === 200,
    });

  try {
    await send(href);
  } catch (error) {
    const guessed404 =
      !ref.href &&
      ref.uid &&
      error instanceof CalDAVError &&
      error.status === 404 &&
      deps?.resolveHrefByUid;

    if (guessed404) {
      const resolved = await deps!
        .resolveHrefByUid!(calendarUrl, ref.uid!)
        .catch(() => undefined);
      if (resolved && absolutize(resolved) !== href) {
        try {
          await send(absolutize(resolved));
          return;
        } catch (retryError) {
          throw new CalDAVError(
            `Failed to delete ${itemType}.`,
            retryError instanceof CalDAVError ? retryError.status : undefined,
            { cause: retryError },
          );
        }
      }
    }

    throw new CalDAVError(
      `Failed to delete ${itemType}.`,
      error instanceof CalDAVError ? error.status : undefined,
      { cause: error },
    );
  }
};
