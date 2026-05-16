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
import { parseEvents, parseTodos } from "./utils/parser";
import HttpClient from "./http-client";
import { parseDavXml } from "./utils/dav";
import { buildEventICSData, buildTodoICSData } from "./protocol/ics-builders";
import { PartialBy } from "./protocol/types";
import { diffRefs } from "./protocol/sync";
import { discoverCalendarHome } from "./protocol/discovery";
import { getCalendars as getProtocolCalendars } from "./protocol/calendars";
import {
  getComponents as getProtocolComponents,
  getCtag as getProtocolCtag,
  getETag as getProtocolETag,
  getItemRefs as getProtocolItemRefs,
  getItemsByHref as getProtocolItemsByHref,
} from "./protocol/components";
import {
  createItem as createProtocolItem,
  deleteItem as deleteProtocolItem,
  updateItem as updateProtocolItem,
} from "./protocol/crud";

const ICS_CT = "text/calendar; charset=utf-8";
//TODO: ADD Support for bypassing TLS BACK
export class CalDAVClient {
  private httpClient: HttpClient;
  private prodId: string;

  public calendarHome: string | null;
  public userPrincipal: string | null;
  public requestTimeout: number;
  public baseUrl: string;

  private constructor(private options: CalDAVOptions) {
    this.httpClient = new HttpClient(
      options.baseUrl,
      options.auth,
      options.rejectUnauthorized ?? true,
      options.headers,
      options.requestTimeout ?? 5000,
      options.logRequests ?? false,
    );

    this.prodId = options.prodId || "-//ts-caldav.//CalDAV Client//EN";
    this.calendarHome = null;
    this.userPrincipal = null;
    this.requestTimeout = options.requestTimeout || 5000;
    this.baseUrl = options.baseUrl;
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
    cache: CalDAVClientCache,
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

  private async discover(): Promise<void> {
    const { userPrincipal, calendarHome } = await discoverCalendarHome({
      baseUrl: this.baseUrl,
      httpClient: this.httpClient,
      propfind: this.propfind.bind(this),
      absolutize: this.absolutize.bind(this),
      resolveUrl: this.resolveUrl.bind(this),
    });

    this.userPrincipal = userPrincipal;
    this.calendarHome = calendarHome;
  }

  /*
   * Calendars
   */

  public async getCalendars(): Promise<Calendar[]> {
    return getProtocolCalendars({
      calendarHome: this.calendarHome,
      httpClient: this.httpClient,
      resolveUrl: this.resolveUrl.bind(this),
    });
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
    options?: { start?: Date; end?: Date; all?: boolean },
  ): Promise<Event[]> {
    return getProtocolComponents<Event>(
      calendarUrl,
      "VEVENT",
      parseEvents,
      this.report.bind(this),
      options,
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
    eventData: PartialBy<Event, "uid" | "href" | "etag">,
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return createProtocolItem<Event>(
      calendarUrl,
      eventData,
      (event, uid) => buildEventICSData(event, uid, this.prodId),
      "event",
      this.mkIcsPut.bind(this),
      this.getCtag.bind(this),
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
    event: Event,
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return updateProtocolItem<Event>(
      calendarUrl,
      event,
      (data, uid) => buildEventICSData(data, uid, this.prodId),
      "event",
      this.mkIcsPut.bind(this),
      this.getCtag.bind(this),
      this.absolutize.bind(this),
    );
  }

  public async deleteEvent(
    calendarUrl: string,
    eventUid: string,
    etag?: string,
  ): Promise<void> {
    return deleteProtocolItem(
      calendarUrl,
      eventUid,
      "event",
      this.httpClient,
      etag,
    );
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
    options?: { start?: Date; end?: Date; all?: boolean },
  ): Promise<Todo[]> {
    return getProtocolComponents<Todo>(
      calendarUrl,
      "VTODO",
      parseTodos,
      this.report.bind(this),
      {
        all: true,
        ...options,
      },
    );
  }

  /**
   * Creates a new todo in the specified calendar.
   * @param calendarUrl - The URL of the calendar to create the todo in.
   * @param todoData - The data for the todo to create.
   * @returns The created todo's metadata.
   */
  public async createTodo(
    calendarUrl: string,
    todoData: PartialBy<Todo, "uid" | "href" | "etag">,
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return createProtocolItem<Todo>(
      calendarUrl,
      todoData,
      (todo, uid) => buildTodoICSData(todo, uid, this.prodId),
      "todo",
      this.mkIcsPut.bind(this),
      this.getCtag.bind(this),
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
    todo: Todo,
  ): Promise<{ uid: string; href: string; etag: string; newCtag: string }> {
    return updateProtocolItem<Todo>(
      calendarUrl,
      todo,
      (data, uid) => buildTodoICSData(data, uid, this.prodId),
      "todo",
      this.mkIcsPut.bind(this),
      this.getCtag.bind(this),
      this.absolutize.bind(this),
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
    etag?: string,
  ): Promise<void> {
    return deleteProtocolItem(
      calendarUrl,
      todoUid,
      "todo",
      this.httpClient,
      etag,
    );
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
    return getProtocolETag(
      href,
      this.absolutize.bind(this),
      this.propfind.bind(this),
    );
  }

  /**
   * Fetches the current CTag for a given calendar URL.
   * @param calendarUrl - The URL of the calendar.
   * @returns The CTag string.
   */
  public async getCtag(calendarUrl: string): Promise<string> {
    return getProtocolCtag(calendarUrl, this.httpClient);
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
    localEvents: EventRef[],
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

    const remoteRefs = await getProtocolItemRefs(
      calendarUrl,
      "VEVENT",
      this.report.bind(this),
    );
    const { newItems, updatedItems, deletedItems } = diffRefs(
      remoteRefs,
      localEvents,
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
    localTodos: TodoRef[],
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

    const remoteRefs = await getProtocolItemRefs(
      calendarUrl,
      "VTODO",
      this.report.bind(this),
    );
    const { newItems, updatedItems, deletedItems } = diffRefs(
      remoteRefs,
      localTodos,
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

  public async getEventsByHref(
    calendarUrl: string,
    hrefs: string[],
  ): Promise<Event[]> {
    return getProtocolItemsByHref<Event>(
      calendarUrl,
      hrefs,
      parseEvents,
      this.report.bind(this),
    );
  }

  public async getTodosByHref(
    calendarUrl: string,
    hrefs: string[],
  ): Promise<Todo[]> {
    return getProtocolItemsByHref<Todo>(
      calendarUrl,
      hrefs,
      parseTodos,
      this.report.bind(this),
    );
  }

  /*
   * Utility Methods
   */

  private absolutize(urlOrPath: string): string {
    return new URL(urlOrPath, this.baseUrl).toString();
  }

  private resolveUrl(path: string): string {
    try {
      if (path.startsWith("http")) {
        return path;
      }
      const resolved = new URL(path, this.baseUrl);

      return resolved.pathname + resolved.search;
    } catch {
      return path;
    }
  }

  /*
   * HTTP Methods
   */

  private async propfind(
    url: string,
    depth: "0" | "1",
    body: string,
  ): Promise<unknown> {
    const res = await this.httpClient.request({
      method: "PROPFIND",
      url,
      data: body,
      headers: {
        Depth: depth,
        Prefer: "return=minimal",
      },
      validateStatus: (s) => s === 207 || s === 200,
    });
    return parseDavXml(res.data);
  }

  private async report(
    url: string,
    body: string,
    depth: "0" | "1" = "1",
  ): Promise<string> {
    const res = await this.httpClient.request({
      method: "REPORT",
      url,
      data: body,
      headers: { Depth: depth },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return res.data;
  }

  private async mkIcsPut(
    href: string,
    ics: string,
    headers?: Record<string, string>,
    validate?: (status: number) => boolean,
  ) {
    return this.httpClient.put(href, ics, {
      headers: { "Content-Type": ICS_CT, ...(headers || {}) },
      validateStatus: validate ?? ((s) => s >= 200 && s < 300),
    });
  }

}
