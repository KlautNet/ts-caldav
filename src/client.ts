import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { encode } from "base-64";
import { XMLParser } from "fast-xml-parser";
import ICAL from "ical.js";
import { v4 as uuidv4 } from "uuid";
import {
  CalDAVClientCache,
  CalDAVOptions,
  Calendar,
  Event,
  EventRef,
  SyncChangesResult,
  SyncTodosResult,
  Todo,
  TodoRef,
} from "./models";
import { formatDate } from "./utils/encode";
import { parseCalendars, parseEvents, parseTodos } from "./utils/parser";
import { first, normalizeSlashEnd } from "./utils/common";

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

const XML_CT = "application/xml; charset=utf-8";
const ICS_CT = "text/calendar; charset=utf-8";

export class CalDAVClient {
  private httpClient: AxiosInstance;
  private prodId: string;
  private parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
  });

  public calendarHome: string | null;
  public userPrincipal: string | null;
  public requestTimeout: number;
  public baseUrl: string;

  private constructor(private options: CalDAVOptions) {
    this.httpClient = axios.create({
      baseURL: options.baseUrl,
      headers: {
        Authorization:
          options.auth.type === "basic"
            ? `Basic ${encode(
                `${options.auth.username}:${options.auth.password}`
              )}`
            : `Bearer ${options.auth.accessToken}`,
        "Content-Type": XML_CT,
      },
      timeout: options.requestTimeout || 5000,
    });

    this.prodId = options.prodId || "-//ts-caldav.//CalDAV Client//EN";
    this.calendarHome = null;
    this.userPrincipal = null;
    this.requestTimeout = options.requestTimeout || 5000;
    this.baseUrl = options.baseUrl;

    if (options.logRequests) {
      this.httpClient.interceptors.request.use((request) => {
        const base = this.baseUrl.replace(/\/+$/, "");
        const path = (request.url || "").replace(/^\/+/, "");
        console.log(
          `Request: ${request.method?.toUpperCase()} ${base}/${path}`
        );
        return request;
      });
    }
  }

  /**
   * Creates a new CalDAVClient instance and validates the provided credentials.
   * @param options - The CalDAV client options.
   * @returns A new CalDAVClient instance.
   * @throws An error if the provided credentials are invalid.
   * @example
   * ```typescript
   * const client = await CalDAVClient.create({
   *  baseUrl: "https://caldav.example.com",
   *  username: "user",
   *  password: "password",
   * });
   * ```
   */
  static async create(options: CalDAVOptions): Promise<CalDAVClient> {
    const client = new CalDAVClient(options);
    await client.discover();
    return client;
  }

  /**
   * Creates a CalDAVClient instance from a cache object.
   * This is useful for restoring a client state without re-fetching the calendar home.
   * @param options - The CalDAV client options.
   * @param cache - The cached client state.
   * @return A new CalDAVClient instance initialized with the cached state.
   * @throws An error if the cache is invalid or incomplete.
   */
  static createFromCache(
    options: CalDAVOptions,
    cache: CalDAVClientCache
  ): CalDAVClient {
    const client = new CalDAVClient(options);
    client.userPrincipal = client.resolveUrl(cache.userPrincipal);
    client.calendarHome = client.resolveUrl(cache.calendarHome);
    if (cache.prodId) client.prodId = cache.prodId;
    return client;
  }

  public getCalendarHome(): string | null {
    return this.calendarHome;
  }

  /**
   * Exports the current client state to a cache object.
   * This can be used to restore the client state later without re-fetching the calendar home.
   * @returns A CalDAVClientCache object containing the current client state.
   */
  public exportCache(): CalDAVClientCache {
    return {
      userPrincipal: this.userPrincipal!,
      calendarHome: this.calendarHome!,
      prodId: this.prodId,
    };
  }

  /*
   * Discovery
   */

  private async tryDiscoveryRoots(): Promise<string> {
    try {
      const wk = this.absolutize("/.well-known/caldav");
      return await this.followRedirectOnce(wk);
    } catch {
      /* fall through */
    }
    const candidates = [
      "/",
      "/dav",
      "/caldav",
      "/caldav.php",
      "/remote.php/dav",
    ];
    for (const p of candidates) {
      try {
        const abs = this.absolutize(p);
        const res = await this.httpClient.request({
          method: "OPTIONS",
          url: abs,
          validateStatus: () => true,
        });
        const allow = String(res.headers["allow"] || "").toUpperCase();
        const dav = String(res.headers["dav"] || "").toLowerCase();
        const looksDav = allow.includes("PROPFIND") || dav.includes("1");
        if (res.status < 500 && looksDav) return abs;
      } catch {
        /* try next */
      }
    }
    return this.baseUrl;
  }

  private async discover(): Promise<void> {
    const discoveryRoot = await this.tryDiscoveryRoots();

    const cupXml = `
      <d:propfind xmlns:d="DAV:">
        <d:prop><d:current-user-principal/></d:prop>
      </d:propfind>`;
    const cup = await this.propfind(discoveryRoot, "0", cupXml);

    const principalHref = this.getHrefFromProp(cup, "current-user-principal");
    if (!principalHref) {
      throw new Error(
        "User principal not found: credentials rejected or server misconfigured."
      );
    }
    const principalUrl = this.absolutize(this.resolveUrl(principalHref));
    this.userPrincipal = principalUrl;

    const chsXml = `
      <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><c:calendar-home-set/></d:prop>
      </d:propfind>`;
    const chs = await this.propfind(principalUrl, "0", chsXml);

    const homeHref = this.getHrefFromProp(chs, "calendar-home-set");
    if (!homeHref)
      throw new Error("calendar-home-set not found for principal.");
    const homeUrl = this.absolutize(this.resolveUrl(homeHref));
    this.calendarHome = homeUrl;

    try {
      await this.propfind(
        homeUrl,
        "0",
        `<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>`
      );
    } catch (e) {
      throw new Error(
        `Authenticated but failed to access calendar home at ${homeUrl}: ${e}`
      );
    }
  }

  /*
   * Calendars
   */

  public async getCalendars(): Promise<Calendar[]> {
    if (!this.calendarHome) throw new Error("Calendar home not found.");

    const requestBody = `
      <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
        <d:prop>
          <d:resourcetype/>
          <d:displayname/>
          <cs:getctag/>
          <c:supported-calendar-component-set/>
          <apple:calendar-color/>
        </d:prop>
      </d:propfind>`;

    const response = await this.httpClient.request({
      method: "PROPFIND",
      url: this.calendarHome,
      data: requestBody,
      headers: { Depth: "1", "Content-Type": XML_CT },
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const calendars = await parseCalendars(response.data);
    return calendars.map((cal) => ({
      ...cal,
      url: this.resolveUrl(cal.url),
    }));
  }

  /*
   * Event CRUD Operations
   */

  /**
   * Fetches all events from a specific calendar.
   * @param calendarUrl - The URL of the calendar to fetch events from.
   * @param options - Optional parameters for fetching events.
   * @returns An array of Event objects.
   */
  public async getEvents(
    calendarUrl: string,
    options?: { start?: Date; end?: Date; all?: boolean }
  ): Promise<Event[]> {
    return this.getComponents<Event>(
      calendarUrl,
      "VEVENT",
      parseEvents,
      options
    );
  }

  /**
   * Creates a new event in the specified calendar.
   * @param calendarUrl - The URL of the calendar to create the event in.
   * @param eventData - The data for the event to create.
   * @returns The created event's metadata.
   */
  public async createEvent(
    calendarUrl: string,
    eventData: PartialBy<Event, "uid" | "href" | "etag">
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return this.createItem<Event>(
      calendarUrl,
      eventData,
      this.buildICSData.bind(this),
      "event"
    );
  }

  /**
   * Updates an existing event in the specified calendar.
   * @param calendarUrl - The URL of the calendar containing the event.
   * @param event - The event object with updated data.
   * @returns The updated event's metadata.
   */
  public async updateEvent(
    calendarUrl: string,
    event: Event
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return this.updateItem<Event>(
      calendarUrl,
      event,
      this.buildICSData.bind(this),
      "event"
    );
  }

  public async deleteEvent(
    calendarUrl: string,
    eventUid: string,
    etag?: string
  ): Promise<void> {
    return this.deleteItem(calendarUrl, eventUid, "event", etag);
  }

  /*
   * Todo CRUD Operations
   */

  /**
   * Fetches all todos from a specific calendar.
   * @param calendarUrl - The URL of the calendar to fetch todos from.
   * @param options - Optional parameters for fetching todos.
   * @returns An array of Todo objects.
   */
  public async getTodos(
    calendarUrl: string,
    options?: { start?: Date; end?: Date; all?: boolean }
  ): Promise<Todo[]> {
    return this.getComponents<Todo>(calendarUrl, "VTODO", parseTodos, {
      all: true,
      ...options,
    });
  }

  /**
   * Creates a new todo in the specified calendar.
   * @param calendarUrl - The URL of the calendar to create the todo in.
   * @param todoData - The data for the todo to create.
   * @returns The created todo's metadata.
   */
  public async createTodo(
    calendarUrl: string,
    todoData: PartialBy<Todo, "uid" | "href" | "etag">
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return this.createItem<Todo>(
      calendarUrl,
      todoData,
      this.buildTodoICSData.bind(this),
      "todo"
    );
  }

  /**
   * Updates an existing todo in the specified calendar.
   * @param calendarUrl - The URL of the calendar containing the todo.
   * @param todo - The todo object with updated data.
   * @returns The updated todo's metadata.
   */
  public async updateTodo(
    calendarUrl: string,
    todo: Todo
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return this.updateItem<Todo>(
      calendarUrl,
      todo,
      this.buildTodoICSData.bind(this),
      "todo"
    );
  }

  /**
   * Deletes a todo from the specified calendar.
   * @param calendarUrl - The URL of the calendar containing the todo.
   * @param todoUid - The UID of the todo to delete.
   * @param etag - Optional ETag for concurrency control.
   */
  public async deleteTodo(
    calendarUrl: string,
    todoUid: string,
    etag?: string
  ): Promise<void> {
    return this.deleteItem(calendarUrl, todoUid, "todo", etag);
  }

  /*
   * Synchronization
   */

  /**
   * Fetches the current ETag for a given event href.
   * Useful when the server does not return an ETag on creation (e.g. Yahoo).
   * @param href - The full CalDAV event URL (ending in .ics).
   * @returns The ETag string, or throws an error if not found.
   */
  public async getETag(href: string): Promise<string> {
    try {
      const data = await this.propfind(
        href,
        "0",
        `<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: any = data;
      const etagRaw =
        parsed?.multistatus?.response?.propstat?.prop?.getetag ??
        parsed?.multistatus?.response?.[0]?.propstat?.prop?.getetag;
      if (!etagRaw) throw new Error("ETag not found in PROPFIND response.");
      return String(etagRaw).replace(/^W\//, "");
    } catch (error) {
      throw new Error(`Failed to retrieve ETag for ${href}: ${error}`);
    }
  }

  /**
   * Fetches the current CTag for a given calendar URL.
   * @param calendarUrl - The URL of the calendar.
   * @returns The CTag string.
   */
  public async getCtag(calendarUrl: string): Promise<string> {
    const requestBody = `
      <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
        <d:prop><cs:getctag/></d:prop>
      </d:propfind>`;

    const res = await this.httpClient.request({
      method: "PROPFIND",
      url: calendarUrl,
      data: requestBody,
      headers: { Depth: "0", "Content-Type": XML_CT },
      validateStatus: (s) => s === 207,
    });

    const json = this.parser.parse(res.data);
    return json?.multistatus?.response?.propstat?.prop?.getctag;
  }

  private diffRefs(
    remoteRefs: { href: string; etag: string }[],
    localRefs: { href: string; etag: string }[]
  ): { newItems: string[]; updatedItems: string[]; deletedItems: string[] } {
    const localMap = new Map(localRefs.map((i) => [i.href, i.etag]));
    const remoteMap = new Map(remoteRefs.map((i) => [i.href, i.etag]));

    const newItems: string[] = [];
    const updatedItems: string[] = [];
    const deletedItems: string[] = [];

    for (const { href, etag } of remoteRefs) {
      if (!localMap.has(href)) newItems.push(href);
      else if (localMap.get(href) !== etag) updatedItems.push(href);
    }
    for (const { href } of localRefs) {
      if (!remoteMap.has(href)) deletedItems.push(href);
    }
    return { newItems, updatedItems, deletedItems };
  }

  /**
   * Synchronizes changes between local events and remote calendar.
   * @param calendarUrl - The URL of the calendar to sync with.
   * @param ctag - The current CTag of the calendar.
   * @param localEvents - The local events to compare against remote.
   * @returns An object containing the sync results.
   */
  public async syncChanges(
    calendarUrl: string,
    ctag: string,
    localEvents: EventRef[]
  ): Promise<SyncChangesResult> {
    const remoteCtag = await this.getCtag(calendarUrl);
    if (ctag === remoteCtag) {
      return {
        changed: false,
        newCtag: remoteCtag,
        newEvents: [],
        updatedEvents: [],
        deletedEvents: [],
      };
    }

    const remoteRefs = await this.getItemRefs(calendarUrl, "VEVENT");
    const { newItems, updatedItems, deletedItems } = this.diffRefs(
      remoteRefs,
      localEvents
    );

    return {
      changed: true,
      newCtag: remoteCtag,
      newEvents: newItems,
      updatedEvents: updatedItems,
      deletedEvents: deletedItems,
    };
  }

  /**
   * Synchronizes changes between local todos and remote calendar.
   * @param calendarUrl - The URL of the calendar to sync with.
   * @param ctag - The current CTag of the calendar.
   * @param localTodos - The local todos to compare against remote.
   * @returns An object containing the sync results.
   */
  public async syncTodoChanges(
    calendarUrl: string,
    ctag: string,
    localTodos: TodoRef[]
  ): Promise<SyncTodosResult> {
    const remoteCtag = await this.getCtag(calendarUrl);
    if (ctag === remoteCtag) {
      return {
        changed: false,
        newCtag: remoteCtag,
        newTodos: [],
        updatedTodos: [],
        deletedTodos: [],
      };
    }

    const remoteRefs = await this.getItemRefs(calendarUrl, "VTODO");
    const { newItems, updatedItems, deletedItems } = this.diffRefs(
      remoteRefs,
      localTodos
    );

    return {
      changed: true,
      newCtag: remoteCtag,
      newTodos: newItems,
      updatedTodos: updatedItems,
      deletedTodos: deletedItems,
    };
  }

  /*
   * Internal Methods
   */

  private async getComponents<T>(
    calendarUrl: string,
    component: "VEVENT" | "VTODO",
    parseFn: (xml: string) => Promise<T[]>,
    options?: { start?: Date; end?: Date; all?: boolean }
  ): Promise<T[]> {
    const now = new Date();
    const defaultEnd = new Date(now.getTime() + 3 * 7 * 24 * 60 * 60 * 1000);
    const { start = now, end = defaultEnd, all } = options || {};

    const timeRangeFilter =
      start && end && !all
        ? `<c:comp-filter name="${component}">
             <c:time-range start="${formatDate(start)}" end="${formatDate(
            end
          )}"/>
           </c:comp-filter>`
        : `<c:comp-filter name="${component}"/>`;

    const requestBody = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag/>
          <c:calendar-data/>
        </d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            ${timeRangeFilter}
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>`;

    try {
      const xml = await this.report(calendarUrl, requestBody, "1");
      return await parseFn(xml);
    } catch (error) {
      throw new Error(
        `Failed to retrieve ${component.toLowerCase()}s from the CalDAV server. ${error}`
      );
    }
  }

  private buildICSData(
    event: PartialBy<Event, "uid" | "etag" | "href">,
    uid: string
  ): string {
    const vcalendar = new ICAL.Component(["vcalendar", [], []]);
    vcalendar.addPropertyWithValue("version", "2.0");
    vcalendar.addPropertyWithValue("prodid", this.prodId);

    const vevent = new ICAL.Component("vevent");
    const e = new ICAL.Event(vevent);
    e.uid = uid;
    vevent.addPropertyWithValue(
      "dtstamp",
      ICAL.Time.fromJSDate(new Date(), true)
    );

    if (event.wholeDay) {
      const startDateStr = event.start.toISOString().split("T")[0];
      const endDateStr = event.end
        ? event.end.toISOString().split("T")[0]
        : startDateStr;

      const endExclusive = new Date(endDateStr + "T00:00:00Z");
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

      e.startDate = ICAL.Time.fromDateString(startDateStr);
      e.endDate = ICAL.Time.fromDateString(
        endExclusive.toISOString().split("T")[0]
      );
    } else {
      const start = ICAL.Time.fromJSDate(event.start, true);
      const end = ICAL.Time.fromJSDate(event.end, true);

      if (event.startTzid) {
        const prop = vevent.addPropertyWithValue("dtstart", start);
        prop.setParameter("tzid", event.startTzid);
      } else {
        e.startDate = start;
      }

      if (event.endTzid) {
        const prop = vevent.addPropertyWithValue("dtend", end);
        prop.setParameter("tzid", event.endTzid);
      } else {
        e.endDate = end;
      }
    }

    e.summary = event.summary;
    e.description = event.description || "";
    e.location = event.location || "";

    if (event.recurrenceRule) {
      const r = event.recurrenceRule;
      const rruleProps: Record<string, string | number> = {};
      if (r.freq) rruleProps.FREQ = r.freq;
      if (r.interval) rruleProps.INTERVAL = r.interval;
      if (r.count) rruleProps.COUNT = r.count;
      if (event.wholeDay && r.until) {
        rruleProps.UNTIL = ICAL.Time.fromDateString(
          r.until.toISOString().split("T")[0]
        ).toString();
      } else if (r.until) {
        rruleProps.UNTIL = ICAL.Time.fromJSDate(r.until, true).toString();
      }

      if (r.byday) rruleProps.BYDAY = r.byday.join(",");
      if (r.bymonthday) rruleProps.BYMONTHDAY = r.bymonthday.join(",");
      if (r.bymonth) rruleProps.BYMONTH = r.bymonth.join(",");
      vevent.addPropertyWithValue("rrule", rruleProps);
    }

    if (event.alarms) {
      for (const alarm of event.alarms) {
        const valarm = new ICAL.Component("valarm");
        valarm.addPropertyWithValue("trigger", alarm.trigger);
        valarm.addPropertyWithValue("action", alarm.action);

        if (alarm.action === "DISPLAY" && alarm.description) {
          valarm.addPropertyWithValue("description", alarm.description);
        } else if (alarm.action === "EMAIL") {
          if (alarm.summary)
            valarm.addPropertyWithValue("summary", alarm.summary);
          if (alarm.description)
            valarm.addPropertyWithValue("description", alarm.description);
          for (const attendee of alarm.attendees) {
            valarm.addPropertyWithValue("attendee", attendee);
          }
        }
        vevent.addSubcomponent(valarm);
      }
    }

    vcalendar.addSubcomponent(vevent);
    return vcalendar.toString();
  }

  private buildTodoICSData(
    todo: PartialBy<Todo, "uid" | "etag" | "href">,
    uid: string
  ): string {
    const vcalendar = new ICAL.Component(["vcalendar", [], []]);
    vcalendar.addPropertyWithValue("version", "2.0");
    vcalendar.addPropertyWithValue("prodid", this.prodId);

    const vtodo = new ICAL.Component("vtodo");
    vtodo.addPropertyWithValue("uid", uid);
    vtodo.addPropertyWithValue(
      "dtstamp",
      ICAL.Time.fromJSDate(new Date(), true)
    );

    if (todo.start)
      vtodo.addPropertyWithValue(
        "dtstart",
        ICAL.Time.fromJSDate(todo.start, true)
      );
    if (todo.due)
      vtodo.addPropertyWithValue("due", ICAL.Time.fromJSDate(todo.due, true));
    if (todo.completed)
      vtodo.addPropertyWithValue(
        "completed",
        ICAL.Time.fromJSDate(todo.completed, true)
      );
    vtodo.addPropertyWithValue("summary", todo.summary);
    if (todo.description)
      vtodo.addPropertyWithValue("description", todo.description);
    if (todo.location) vtodo.addPropertyWithValue("location", todo.location);
    if (todo.status) vtodo.addPropertyWithValue("status", todo.status);
    if (todo.sortOrder !== undefined)
      vtodo.addPropertyWithValue("X-APPLE-SORT-ORDER", todo.sortOrder);

    if (todo.alarms) {
      for (const alarm of todo.alarms) {
        const valarm = new ICAL.Component("valarm");
        valarm.addPropertyWithValue("trigger", alarm.trigger);
        valarm.addPropertyWithValue("action", alarm.action);
        if (alarm.action === "DISPLAY" && alarm.description) {
          valarm.addPropertyWithValue("description", alarm.description);
        } else if (alarm.action === "EMAIL") {
          if (alarm.summary)
            valarm.addPropertyWithValue("summary", alarm.summary);
          if (alarm.description)
            valarm.addPropertyWithValue("description", alarm.description);
          for (const attendee of alarm.attendees) {
            valarm.addPropertyWithValue("attendee", attendee);
          }
        }
        vtodo.addSubcomponent(valarm);
      }
    }

    vcalendar.addSubcomponent(vtodo);
    return vcalendar.toString();
  }

  private async createItem<
    T extends { uid?: string; href?: string; etag?: string }
  >(
    calendarUrl: string,
    data: PartialBy<T, "uid" | "href" | "etag">,
    buildFn: (
      data: PartialBy<T, "uid" | "href" | "etag">,
      uid: string
    ) => string,
    itemType: "event" | "todo"
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    if (!calendarUrl)
      throw new Error(`Calendar URL is required to create a ${itemType}.`);

    const base = normalizeSlashEnd(calendarUrl);
    const uid = data.uid || uuidv4();
    const href = `${base}/${uid}.ics`;
    const ics = buildFn(data, uid);

    try {
      const response = await this.mkIcsPut(
        href,
        ics,
        { "If-None-Match": "*" },
        (s) => s === 201 || s === 204
      );
      const etag = response.headers["etag"] || "";
      const newCtag = await this.getCtag(base);
      return { uid, href: `${base}/${uid}.ics`, etag, newCtag };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 412) {
        throw new Error(
          `${
            itemType[0].toUpperCase() + itemType.slice(1)
          } with the specified uid already exists.`
        );
      }
      throw new Error(`Failed to create ${itemType}: ${error}`);
    }
  }

  private async updateItem<
    T extends { uid: string; href: string; etag?: string }
  >(
    calendarUrl: string,
    item: T,
    buildFn: (item: T, uid: string) => string,
    itemType: "event" | "todo"
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    if (!item.uid || !item.href) {
      throw new Error(
        `Both 'uid' and 'href' are required to update a ${itemType}.`
      );
    }

    const base = normalizeSlashEnd(calendarUrl);
    const ics = buildFn(item, item.uid);

    const ifMatch = this.cleanEtag(item.etag);
    const extraHeaders: Record<string, string> = {};
    if (ifMatch && !this.isWeak(ifMatch)) {
      extraHeaders["If-Match"] = ifMatch;
    }

    try {
      const response = await this.mkIcsPut(item.href, ics, extraHeaders);
      const newEtag = response.headers["etag"] || "";
      const newCtag = await this.getCtag(base);
      return { uid: item.uid, href: item.href, etag: newEtag, newCtag };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 412) {
        throw new Error(
          `${
            itemType[0].toUpperCase() + itemType.slice(1)
          } with the specified uid does not match.`
        );
      }
      throw new Error(`Failed to update ${itemType}: ${error}`);
    }
  }

  private async deleteItem(
    calendarUrl: string,
    uid: string,
    itemType: "event" | "todo",
    etag?: string
  ): Promise<void> {
    const base = normalizeSlashEnd(calendarUrl);
    const href = `${base}/${uid}.ics`;
    try {
      await this.httpClient.delete(href, {
        headers: { "If-Match": etag ?? "*" },
        validateStatus: (s) => s === 204,
      });
    } catch (error) {
      throw new Error(`Failed to delete ${itemType}: ${error}`);
    }
  }

  private async getItemRefs(
    calendarUrl: string,
    component: "VEVENT" | "VTODO"
  ): Promise<{ href: string; etag: string }[]> {
    const requestBody = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag/></d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="${component}"/>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>`;

    const data = await this.report(calendarUrl, requestBody, "1");
    const jsonData = this.parser.parse(data);

    const raw = jsonData?.multistatus?.response;
    const responses = Array.isArray(raw) ? raw : raw ? [raw] : [];

    const refs: { href: string; etag: string }[] = [];
    for (const obj of responses) {
      if (!obj || typeof obj !== "object") continue;
      const href = obj["href"];
      const etag = obj?.propstat?.prop?.getetag;
      if (href && etag) refs.push({ href, etag });
    }
    return refs;
  }

  public async getEventsByHref(
    calendarUrl: string,
    hrefs: string[]
  ): Promise<Event[]> {
    return this.getItemsByHref<Event>(calendarUrl, hrefs, parseEvents);
  }

  public async getTodosByHref(
    calendarUrl: string,
    hrefs: string[]
  ): Promise<Todo[]> {
    return this.getItemsByHref<Todo>(calendarUrl, hrefs, parseTodos);
  }

  private async getItemsByHref<T>(
    calendarUrl: string,
    hrefs: string[],
    parseFn: (xml: string) => Promise<T[]>
  ): Promise<T[]> {
    if (!hrefs.length) return [];

    const filtered = hrefs.filter((h) => h.endsWith(".ics"));
    if (!filtered.length) return [];

    const requestBody = `
      <c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag/>
          <c:calendar-data/>
        </d:prop>
        ${filtered.map((h) => `<d:href>${h}</d:href>`).join("")}
      </c:calendar-multiget>`;

    const xml = await this.report(calendarUrl, requestBody, "1");
    return await parseFn(xml);
  }

  /*
   * Utility Methods
   */

  private absolutize(urlOrPath: string): string {
    try {
      return new URL(urlOrPath).toString();
    } catch {
      return new URL(urlOrPath, this.baseUrl).toString();
    }
  }

  private resolveUrl(path: string): string {
    const basePath = new URL(this.baseUrl).pathname;
    if (path.startsWith(basePath) && basePath !== "/") {
      const stripped = path.substring(basePath.length);
      return stripped.startsWith("/") ? stripped : "/" + stripped;
    }
    return path;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getHrefFromProp(parsed: any, propName: string): string | null {
    const ms = parsed?.multistatus;
    const resp = first(ms?.response);
    const pstat = first(resp?.propstat);
    const prop = pstat?.prop;
    const node = prop?.[propName];
    if (!node) return null;

    if (typeof node === "string") return node;
    if (typeof node?.href === "string") return node.href;

    const maybe = first(node);
    if (typeof maybe === "string") return maybe;
    if (maybe && typeof maybe.href === "string") return maybe.href;

    return null;
  }

  private isWeak(etag?: string): boolean {
    return !!etag && (etag.startsWith('W/"') || etag.startsWith("W/"));
  }

  private cleanEtag(etag?: string): string | undefined {
    if (!etag) return undefined;
    return etag.replace(/^W\//, "").trim();
  }

  /*
   * HTTP Methods
   */

  private async propfind(
    url: string,
    depth: "0" | "1",
    body: string,
    extra?: AxiosRequestConfig
  ): Promise<unknown> {
    const res = await this.httpClient.request({
      method: "PROPFIND",
      url,
      data: body,
      headers: {
        Depth: depth,
        Prefer: "return=minimal",
        "Content-Type": XML_CT,
      },
      validateStatus: (s) => s === 207 || s === 200,
      ...extra,
    });
    return this.parser.parse(res.data);
  }

  private async report(
    url: string,
    body: string,
    depth: "0" | "1" = "1",
    extra?: AxiosRequestConfig
  ): Promise<string> {
    const res = await this.httpClient.request({
      method: "REPORT",
      url,
      data: body,
      headers: { Depth: depth, "Content-Type": XML_CT },
      validateStatus: (s) => s >= 200 && s < 300,
      ...extra,
    });
    return res.data as string;
  }

  private async mkIcsPut(
    href: string,
    ics: string,
    headers?: Record<string, string>,
    validate?: (status: number) => boolean
  ) {
    return this.httpClient.put(href, ics, {
      headers: { "Content-Type": ICS_CT, ...(headers || {}) },
      validateStatus: validate ?? ((s) => s >= 200 && s < 300),
    });
  }

  private async followRedirectOnce(url: string): Promise<string> {
    try {
      const res = await this.httpClient.request({
        method: "GET",
        url,
        maxRedirects: 0,
        validateStatus: (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers["location"];
        if (!loc) throw new Error(`Redirect without Location from ${url}`);
        return this.absolutize(loc);
      }
      return url;
    } catch {
      return url;
    }
  }
}
