import { CalDAVError } from "../errors";
import HttpClient from "../http-client";
import { getHrefFromProp } from "../utils/dav";

type DiscoveryDeps = {
  baseUrl: string;
  httpClient: Pick<HttpClient, "request">;
  propfind: (url: string, depth: "0" | "1", body: string) => Promise<unknown>;
  absolutize: (urlOrPath: string) => string;
  resolveUrl: (path: string) => string;
};

const DISCOVERY_CANDIDATES = [
  "/",
  "/dav",
  "/caldav",
  "/caldav.php",
  "/remote.php/dav",
];

const followRedirectOnce = async (
  httpClient: Pick<HttpClient, "request">,
  url: string,
): Promise<string> => {
  try {
    const res = await httpClient.request({
      method: "GET",
      url,
      redirect: "manual",
      validateStatus: (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers["location"];
      if (!loc) throw new Error(`Redirect without Location from ${url}`);
      return new URL(loc, url).toString();
    }
    return url;
  } catch {
    return url;
  }
};

export const tryDiscoveryRoots = async (
  deps: DiscoveryDeps,
): Promise<string> => {
  try {
    const wk = deps.absolutize("/.well-known/caldav");
    const redirected = await followRedirectOnce(deps.httpClient, wk);

    const res = await deps.httpClient.request({
      method: "OPTIONS",
      url: redirected,
      validateStatus: (s) => s < 400,
    });

    if (res.status < 400) return redirected;
  } catch {
    /* fall through to candidates if .well-known 404s or fails */
  }

  for (const p of DISCOVERY_CANDIDATES) {
    try {
      const abs = deps.absolutize(p);
      const res = await deps.httpClient.request({
        method: "OPTIONS",
        url: abs,
        validateStatus: () => true,
      });

      const allow = String(res.headers["allow"] || "").toUpperCase();
      const dav = String(res.headers["dav"] || "").toLowerCase();
      const looksDav = allow.includes("PROPFIND") || dav.includes("1");

      if (res.status < 400 && looksDav) return abs;
    } catch {
      /* try next */
    }
  }

  return deps.baseUrl;
};

export const discoverCalendarHome = async (
  deps: DiscoveryDeps,
): Promise<{ userPrincipal: string; calendarHome: string }> => {
  const discoveryRoot = await tryDiscoveryRoots(deps);

  const cupXml = `
    <d:propfind xmlns:d="DAV:">
      <d:prop><d:current-user-principal/></d:prop>
    </d:propfind>`;
  const cup = await deps.propfind(discoveryRoot, "0", cupXml);

  const principalHref = getHrefFromProp(cup, "current-user-principal");
  if (!principalHref) {
    throw new CalDAVError(
      "User principal not found: credentials rejected or server misconfigured.",
    );
  }
  const userPrincipal = deps.absolutize(deps.resolveUrl(principalHref));

  const chsXml = `
    <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop><c:calendar-home-set/></d:prop>
    </d:propfind>`;
  const chs = await deps.propfind(userPrincipal, "0", chsXml);

  const homeHref = getHrefFromProp(chs, "calendar-home-set");
  if (!homeHref) {
    throw new CalDAVError("calendar-home-set not found for principal.");
  }
  const calendarHome = deps.absolutize(deps.resolveUrl(homeHref));

  try {
    await deps.propfind(
      calendarHome,
      "0",
      `<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>`,
    );
  } catch (e) {
    throw new CalDAVError(
      `Authenticated but failed to access calendar home at ${calendarHome}.`,
      undefined,
      { cause: e },
    );
  }

  return { userPrincipal, calendarHome };
};

