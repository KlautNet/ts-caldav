import { beforeAll, describe, expect, test } from "vitest";
import { CalDAVClient } from "../../src/client";

const skip = !process.env.NEXTCLOUD_BASE_URL;

describe.skipIf(skip)("Nextcloud CalDAV – custom fields on todos", () => {
  let client: CalDAVClient;
  let todoUid: string;
  const todoUrl = "/calendars/admin/test-todos/";

  beforeAll(async () => {
    client = await CalDAVClient.create({
      baseUrl: process.env.NEXTCLOUD_BASE_URL!,
      auth: {
        type: "basic",
        username: process.env.NEXTCLOUD_USERNAME!,
        password: process.env.NEXTCLOUD_PASSWORD!,
      },
      requestTimeout: 30000,
    });
  });

  test("create todo with custom field and verify parsing", async () => {
    const { uid } = await client.createTodo(todoUrl, {
      summary: "Test Todo with Custom Fields",
      due: new Date(Date.now() + 3_600_000),
      customFields: { "percent-complete": "50" },
    });
    todoUid = uid;

    const todos = await client.getTodos(todoUrl, {
      start: new Date(Date.now() - 86_400_000),
      end: new Date(Date.now() + 86_400_000),
    });
    const found = todos.find((t) => t.uid === uid);
    expect(found?.customFields?.["percent-complete"]).toBe("50");
  });

  test("update custom field and verify", async () => {
    const todos = await client.getTodos(todoUrl, {
      start: new Date(Date.now() - 86_400_000),
      end: new Date(Date.now() + 86_400_000),
    });
    const todo = todos.find((t) => t.uid === todoUid);
    expect(todo).toBeDefined();
    if (!todo?.customFields) throw new Error("customFields missing");

    todo.customFields["percent-complete"] = "75";
    await client.updateTodo(todoUrl, todo);

    const updated = await client.getTodos(todoUrl, {
      start: new Date(Date.now() - 86_400_000),
      end: new Date(Date.now() + 86_400_000),
    });
    expect(updated.find((t) => t.uid === todoUid)?.customFields?.["percent-complete"]).toBe("75");

    await client.deleteTodo(todoUrl, todoUid);
  });
});
