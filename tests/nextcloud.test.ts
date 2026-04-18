import { CalDAVClient } from "../src/client";
import dotenv from "dotenv";

dotenv.config();

describe("Alarm Handling", () => {
  let client: CalDAVClient;
  let todoUid: string;

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

  //Create Todo with custom fields and verify they are parsed correctly
  test("Create Todo with custom fields and verify parsing", async () => {
    const url = "/calendars/admin/test-todos/";
    const now = new Date();
    const due = new Date(now.getTime() + 3600000); // 1 hour later

    const res = await client.createTodo(url, {
      summary: "Test Todo with Custom Fields",
      due,
      customFields: {
        "percent-complete": "50",
      },
    });
    todoUid = res.uid;
    expect(res.uid).toBeDefined();

    const todos = await client.getTodos(url, {
      start: new Date(Date.now() - 86400000),
      end: new Date(Date.now() + 86400000),
    });

    const todo = todos.find((t) => t.uid === res.uid);

    expect(todo).toBeDefined();
    expect(todo!.customFields).toBeDefined();
    expect(todo!.customFields!["percent-complete"]).toBe("50");
  });

  //Update an todos custom field
  test("Update Todo custom field and verify parsing", async () => {
    const url = "/calendars/admin/test-todos/";
    const todos = await client.getTodos(url, {
      start: new Date(Date.now() - 86400000),
      end: new Date(Date.now() + 86400000),
    });
    const todo = todos.find((t) => t.uid === todoUid);
    expect(todo).toBeDefined();

    if (!todo?.customFields) {
      throw new Error("Todo not found for update test");
    }

    todo.customFields["percent-complete"] = "75";

    await client.updateTodo(url, todo);

    // Fetch again to verify update
    const updatedTodos = await client.getTodos(url, {
      start: new Date(Date.now() - 86400000),
      end: new Date(Date.now() + 86400000),
    });
    const updated = updatedTodos.find((t) => t.uid === todoUid);
    expect(updated).toBeDefined();
    expect(updated!.customFields).toBeDefined();
    expect(updated!.customFields!["percent-complete"]).toBe("75");

    // Cleanup
    await client.deleteTodo(url, todoUid);
  });
});
