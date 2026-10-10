import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import { connect } from "./db/connect.ts";
import { migrate } from "./db/migrations.ts";
import type { Database } from "./db/schema.ts";

/** An open database holding todo lists. Close it when done. */
type TodoStore = {
  readonly db: Kysely<Database>;
  /** The current time, as ISO 8601 UTC text. */
  readonly now: () => string;
  /** A new internal row ID. */
  readonly newId: () => string;
  readonly close: () => Promise<void>;
};

/** What the operations use of a store, which a transaction can stand in for. */
type StoreContext = Pick<TodoStore, "db" | "now" | "newId">;

type StoreOptions = {
  /** Run pending migrations on open. Defaults to true. */
  autoMigrate?: boolean;
  now?: () => Date;
};

/**
 * Opens a store: `database` is a `postgres://` or `postgresql://` URL, or a
 * SQLite file path.
 */
const todoListStore = async (database: string, options: StoreOptions = {}): Promise<TodoStore> => {
  const db = await connect(database);
  try {
    if (options.autoMigrate ?? true) await migrate(db);
  } catch (error) {
    await db.destroy();
    throw error;
  }
  const clock = options.now ?? (() => new Date());
  return {
    db,
    now: () => clock().toISOString(),
    newId: () => randomUUID(),
    close: () => db.destroy(),
  };
};

/** Runs the pending migrations, for a store opened with `autoMigrate: false`. */
const migrateStore = (store: TodoStore): Promise<void> => migrate(store.db);

/** Runs `work` in one transaction, with a context bound to it. */
const inTransaction = <T>(
  context: StoreContext,
  work: (tx: StoreContext) => Promise<T>,
): Promise<T> => context.db.transaction().execute(trx => work({ ...context, db: trx }));

export {
  inTransaction,
  migrateStore,
  type StoreContext,
  type StoreOptions,
  type TodoStore,
  todoListStore,
};
