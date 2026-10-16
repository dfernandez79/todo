import { describe, expect, test } from "bun:test";

import { addItem, listItems, moveItems, todoList, todoListStore } from "../index.ts";
import { todoCli } from "../test-helpers/cli.ts";
import { NO_DATABASE, freshNeonDatabase } from "../test-helpers/databases.ts";

type Ping = { driver: string; server: string; pendingMigrations: string[] };

describe("the Neon serverless driver", () => {
  test("says where the WebSocket couldn't open", async () => {
    const refused = todoCli("postgres://nobody@127.0.0.1:1/none", {
      TODO_USE_NEON_SERVERLESS: "1",
    });
    const { code, stdout } = await refused(["db", "ping", "--json"]);
    expect(code).toBe(1);
    const { error } = JSON.parse(stdout) as { error: { code: string; message: string } };
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toStartWith(
      "could not open a WebSocket to 127.0.0.1:1 for the Neon serverless driver: ",
    );
    expect(error.message).toEndWith("reachable over HTTPS from here");
  });
});

/** Through Neon's WebSocket proxy in front of the test container; see the preload. */
describe.skipIf(NO_DATABASE)("todo on PostgreSQL with the Neon serverless driver", () => {
  test("--db-use-neon-serverless runs the commands, transactions included", async () => {
    const todo = todoCli(await freshNeonDatabase());
    const flag = ["--db-use-neon-serverless"];
    expect((await todo(["add", "One", ...flag])).code).toBe(0);
    expect((await todo(["add", "Two", "--priority=high", ...flag])).code).toBe(0);
    // Moving runs in a transaction.
    expect((await todo(["mv", "1", "2", "other", ...flag])).code).toBe(0);
    const other = await todo.json<{ items: { description: string }[] }>([
      "ls",
      "--list=other",
      ...flag,
    ]);
    expect(other.items.map(item => item.description)).toEqual(["One", "Two"]);
    expect((await todo.json<{ items: unknown[] }>(["ls", ...flag])).items).toEqual([]);
    const ping = await todo.json<Ping>(["db", "ping", ...flag]);
    expect(ping).toMatchObject({ driver: "neon-serverless", pendingMigrations: [] });
    expect(ping.server).toMatch(/^PostgreSQL \d+/);
  }, 30_000);

  test("TODO_USE_NEON_SERVERLESS=1 turns it on too, and without it the URL is unreachable", async () => {
    const database = await freshNeonDatabase();
    const neon = todoCli(database, { TODO_USE_NEON_SERVERLESS: "1" });
    expect((await neon(["add", "One"])).code).toBe(0);
    expect((await neon.json<Ping>(["db", "ping"])).driver).toBe("neon-serverless");
    // The proxied host isn't a host of this machine, so postgres.js can't connect.
    const direct = todoCli(database, { TODO_USE_NEON_SERVERLESS: "0" });
    expect((await direct(["ls", "--db-timeout=5"])).code).toBe(1);
  }, 30_000);

  test("the TypeScript API takes useNeonServerless", async () => {
    const store = await todoListStore(await freshNeonDatabase(), { useNeonServerless: true });
    try {
      expect(store.driver).toBe("neon-serverless");
      const list = todoList(store, "list-1");
      await addItem(list, "One");
      await moveItems(list, [1], "list-2");
      expect(await listItems(list)).toEqual([]);
      expect((await listItems(todoList(store, "list-2"))).map(i => i.description)).toEqual(["One"]);
    } finally {
      await store.close();
    }
  }, 30_000);

  test("gives up connecting after --db-timeout with DB_CONNECT_TIMEOUT", async () => {
    // A non-routable address, where connecting hangs instead of failing.
    const unreachable = todoCli("postgres://nobody@10.255.255.1:5432/none", {
      TODO_USE_NEON_SERVERLESS: "1",
    });
    const started = Date.now();
    const { code, stdout } = await unreachable(["ls", "--json", "--db-timeout=0.3"]);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      error: {
        code: "DB_CONNECT_TIMEOUT",
        message:
          "could not connect to the database within 0.3 seconds; raise it with --db-timeout or TODO_DATABASE_TIMEOUT",
      },
    });
  });
});
