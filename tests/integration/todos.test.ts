import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.CALDAV_BASE_URL;

describe.skipIf(skip)("CalDAV – todo operations", () => {
  let client: CalDAVClient;
  let calendarUrl: string;

  const range = () => ({
    start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

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
      calendars.find((c) => c.supportedComponents.includes("VTODO"))?.url ??
      calendars[0].url;
  });

  test("create and fetch todo", async () => {
    const { uid } = await client.createTodo(calendarUrl, {
      due: new Date(),
      summary: "Integration Test Todo",
    });
    const todos = await client.getTodos(calendarUrl, range());
    const found = todos.find((t) => t.uid === uid);
    expect(found?.summary).toBe("Integration Test Todo");
    await client.deleteTodo(calendarUrl, uid);
  });

  test("duplicate uid is rejected", async () => {
    const { uid } = await client.createTodo(calendarUrl, {
      due: new Date(),
      summary: "Original",
    });
    await expect(
      client.createTodo(calendarUrl, { due: new Date(), summary: "Dup", uid }),
    ).rejects.toThrow("already exists");
    await client.deleteTodo(calendarUrl, uid);
  });

  test("sync and getTodosByHref", async () => {
    const ctag = await client.getCtag(calendarUrl);
    const { uid } = await client.createTodo(calendarUrl, {
      due: new Date(),
      summary: "Sync Test Todo",
    });
    const sync = await client.syncTodoChanges(calendarUrl, ctag, []);
    const fetched = await client.getTodosByHref(calendarUrl, sync.newTodos);
    expect(fetched.length).toBeGreaterThan(0);
    await client.deleteTodo(calendarUrl, uid);
  });

  test("getETag returns a non-empty string", async () => {
    const { uid, href } = await client.createTodo(calendarUrl, {
      due: new Date(),
      summary: "ETag Test",
    });
    const etag = await client.getETag(href);
    expect(typeof etag).toBe("string");
    expect(etag.length).toBeGreaterThan(0);
    await client.deleteTodo(calendarUrl, uid);
  });

  test("update todo", async () => {
    const { uid, href } = await client.createTodo(calendarUrl, {
      due: new Date(),
      summary: "Before Update",
    });
    const etag = await client.getETag(href);
    const res = await client.updateTodo(calendarUrl, {
      uid,
      href,
      etag,
      due: new Date(),
      summary: "After Update",
    });
    const [updated] = await client.getTodosByHref(calendarUrl, [res.href]);
    expect(updated.summary).toBe("After Update");
    await client.deleteTodo(calendarUrl, uid);
  });

  test("update todo twice with new etag each time", async () => {
    const { uid, href } = await client.createTodo(calendarUrl, {
      due: new Date(),
      summary: "First",
    });
    const etag1 = await client.getETag(href);
    const res2 = await client.updateTodo(calendarUrl, {
      uid,
      href,
      etag: etag1,
      due: new Date(),
      summary: "Second",
    });
    await new Promise((r) => setTimeout(r, 2000));
    await client.updateTodo(calendarUrl, {
      uid,
      href,
      etag: res2.etag,
      due: new Date(),
      summary: "Third",
    });
    const [final] = await client.getTodosByHref(calendarUrl, [href]);
    expect(final.summary).toBe("Third");
    await client.deleteTodo(calendarUrl, uid);
  });

  test("sort order round-trips", async () => {
    const { uid } = await client.createTodo(calendarUrl, {
      due: new Date(),
      summary: "Sort Order Test",
      sortOrder: 100,
    });
    const todos = await client.getTodos(calendarUrl, range());
    const found = todos.find((t) => t.uid === uid);
    expect(found?.sortOrder).toBe(100);
    await client.deleteTodo(calendarUrl, uid);
  });
});
