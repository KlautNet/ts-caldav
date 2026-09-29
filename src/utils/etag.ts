/**
 * ETag helpers shared by the write paths.
 *
 * A weak ETag (`W/"..."`) is not a usable `If-Match` validator — RFC 9110
 * §13.1.1 requires the strong comparison function there — so callers must
 * either drop it or fall back to `*`.
 */

export const isWeak = (etag?: string): boolean => {
  return !!etag && (etag.startsWith('W/"') || etag.startsWith("W/"));
};

export const cleanEtag = (etag?: string): string | undefined => {
  if (!etag) return undefined;
  return etag.replace(/^W\//, "").trim();
};

/**
 * The `If-Match` value to send for a conditional write: the strong ETag when
 * there is one, otherwise `*`, which only requires that the resource exists.
 */
export const ifMatchValue = (etag?: string): string =>
  etag && !isWeak(etag) ? (cleanEtag(etag) as string) : "*";
