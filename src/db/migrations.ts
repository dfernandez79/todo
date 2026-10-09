import type { Kysely } from "kysely";
import { type Migration, Migrator } from "kysely/migration";

/** Schema builder only, so one set of migrations serves PostgreSQL and SQLite. */
const MIGRATIONS: Record<string, Migration> = {
  "0001_init": {
    up: async db => {
      await db.schema
        .createTable("todo_lists")
        .addColumn("id", "text", c => c.primaryKey())
        .addColumn("key", "text", c => c.notNull().unique())
        .addColumn("description", "text")
        .addColumn("archived_at", "text")
        .addColumn("next_item_number", "integer", c => c.notNull().defaultTo(1))
        .addColumn("created_at", "text", c => c.notNull())
        .addColumn("updated_at", "text", c => c.notNull())
        .execute();
      await db.schema
        .createTable("todo_items")
        .addColumn("id", "text", c => c.primaryKey())
        .addColumn("list_id", "text", c =>
          c.notNull().references("todo_lists.id").onDelete("cascade"),
        )
        .addColumn("number", "integer", c => c.notNull())
        .addColumn("description", "text", c => c.notNull())
        .addColumn("notes", "text")
        .addColumn("section", "text")
        .addColumn("priority", "text")
        .addColumn("done_at", "text")
        .addColumn("created_at", "text", c => c.notNull())
        .addColumn("updated_at", "text", c => c.notNull())
        .addUniqueConstraint("todo_items_list_number", ["list_id", "number"])
        .execute();
    },
  },
};

// oxlint-disable-next-line typescript/no-explicit-any -- any database, as migrations take
const migrate = async (db: Kysely<any>): Promise<void> => {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => MIGRATIONS },
    migrationTableName: "todo_migration",
    migrationLockTableName: "todo_migration_lock",
  });
  const { error } = await migrator.migrateToLatest();
  if (error !== undefined) {
    throw new Error(`database migration failed: ${(error as Error).message ?? String(error)}`, {
      cause: error,
    });
  }
};

export { migrate };
