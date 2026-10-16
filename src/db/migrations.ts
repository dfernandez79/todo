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
  "0002_item_position": {
    up: async db => {
      await db.schema
        .alterTable("todo_items")
        .addColumn("position", "integer", c => c.notNull().defaultTo(0))
        .execute();
      // Start from the display order before Positions existed, so Lists look the same.
      const rows: PositionRow[] = await db
        .selectFrom("todo_items")
        .select(["id", "list_id", "number", "section", "priority"])
        .execute();
      const byList = Map.groupBy(rows, row => row.list_id);
      for (const items of byList.values()) {
        const sorted = items.toSorted(compareLegacy);
        for (const [index, row] of sorted.entries()) {
          await db
            .updateTable("todo_items")
            .set({ position: index + 1 })
            .where("id", "=", row.id)
            .execute();
        }
      }
    },
  },
};

type PositionRow = {
  id: string;
  list_id: string;
  number: number;
  section: string | null;
  priority: string | null;
};

const collator = new Intl.Collator("en");

const LEGACY_PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** No Section first, then Sections alphabetically, then Priority (High first), then Item ID. */
const compareLegacy = (a: PositionRow, b: PositionRow): number => {
  if (a.section !== b.section) {
    if (a.section === null) return -1;
    if (b.section === null) return 1;
    const bySection = collator.compare(a.section, b.section);
    if (bySection !== 0) return bySection;
  }
  const rank = (row: PositionRow) => LEGACY_PRIORITY_RANK[row.priority ?? ""] ?? 0;
  return rank(b) - rank(a) || a.number - b.number;
};

// oxlint-disable-next-line typescript/no-explicit-any -- any database, as migrations take
const migrator = (db: Kysely<any>): Migrator =>
  new Migrator({
    db,
    provider: { getMigrations: async () => MIGRATIONS },
    migrationTableName: "todo_migration",
    migrationLockTableName: "todo_migration_lock",
  });

// oxlint-disable-next-line typescript/no-explicit-any -- any database, as migrations take
const migrate = async (db: Kysely<any>): Promise<void> => {
  const { error } = await migrator(db).migrateToLatest();
  if (error !== undefined) {
    throw new Error(`database migration failed: ${(error as Error).message ?? String(error)}`, {
      cause: error,
    });
  }
};

/** The names of the migrations not yet run. Reads only; a database without the migration table has them all pending. */
// oxlint-disable-next-line typescript/no-explicit-any -- any database, as migrations take
const pendingMigrations = async (db: Kysely<any>): Promise<string[]> => {
  const migrations = await migrator(db).getMigrations();
  return migrations.filter(m => m.executedAt === undefined).map(m => m.name);
};

export { MIGRATIONS, migrate, pendingMigrations };
