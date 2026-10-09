import { describe, expect, test } from "bun:test";

import {
  addItem,
  buildPrompt,
  createList,
  listItems,
  listLists,
  markDone,
  todoList,
  todoListStore,
} from "./index.ts";
import { DATABASES } from "./test-helpers/databases.ts";

describe.each(DATABASES)("the TypeScript API on $name", database => {
  test("manages a List as the CLI does", async () => {
    const store = await todoListStore(await database.fresh(), {
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    try {
      await createList(store, "list-1", { description: "Through the API" });
      const list = todoList(store, "list-1");
      const item = await addItem(list, "New Description", { priority: "high" });
      expect(item).toEqual({
        list: "list-1",
        id: 1,
        description: "New Description",
        priority: "high",
        done: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        notes: undefined,
        section: undefined,
        doneAt: undefined,
      });
      expect(await buildPrompt(list)).toContain("#1: New Description (priority: high)");
      await markDone(list, [1]);
      expect(await listItems(list)).toEqual([]);
      expect((await listLists(store)).map(l => [l.key, l.done])).toEqual([["list-1", 1]]);
    } finally {
      await store.close();
    }
  }, 30_000);

  test("rejects an invalid List Key", async () => {
    const store = await todoListStore(await database.fresh());
    try {
      expect(() => todoList(store, "has space")).toThrow("invalid list key 'has space'");
    } finally {
      await store.close();
    }
  }, 30_000);
});
