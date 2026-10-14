import { describe, expect, test } from "bun:test";

import type { Kysely } from "kysely";
import { Migrator } from "kysely/migration";

import { DATABASES } from "../test-helpers/databases.ts";
import { connect } from "./connect.ts";
import { MIGRATIONS, migrate } from "./migrations.ts";
import type { Database, ItemsTable } from "./schema.ts";

/** The tables as 0001_init made them. */
type InitDatabase = Omit<Database, "todo_items"> & { todo_items: Omit<ItemsTable, "position"> };

describe.each(DATABASES)("migrations on $name", database => {
  test("0002 gives Items Positions in the display order before Positions", async () => {
    const db = await connect(await database.fresh());
    try {
      const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => MIGRATIONS },
        migrationTableName: "todo_migration",
        migrationLockTableName: "todo_migration_lock",
      });
      const { error } = await migrator.migrateTo("0001_init");
      if (error !== undefined) throw error;

      const at = "2026-01-01T00:00:00.000Z";
      const init = db as unknown as Kysely<InitDatabase>;
      await init
        .insertInto("todo_lists")
        .values({ id: "l", key: "list-1", next_item_number: 5, created_at: at, updated_at: at })
        .execute();
      const item = (number: number, fields: { section?: string; priority?: string } = {}) => ({
        id: `i${number}`,
        list_id: "l",
        number,
        description: `Item ${number}`,
        ...fields,
        created_at: at,
        updated_at: at,
      });
      await init
        .insertInto("todo_items")
        .values([
          item(1, { section: "B" }),
          item(2, { priority: "low" }),
          item(3, { priority: "high" }),
          item(4),
        ])
        .execute();

      await migrate(db);
      const rows = await db
        .selectFrom("todo_items")
        .select(["number", "position"])
        .orderBy("position")
        .execute();
      expect(rows).toEqual([
        { number: 3, position: 1 },
        { number: 2, position: 2 },
        { number: 4, position: 3 },
        { number: 1, position: 4 },
      ]);
    } finally {
      await db.destroy();
    }
  });
});
