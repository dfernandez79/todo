import { randomUUID } from "node:crypto";

import { type Kysely, sql } from "kysely";

import { type Driver, connect, driverFor } from "./db/connect.ts";
import { migrate, pendingMigrations } from "./db/migrations.ts";
import type { Database } from "./db/schema.ts";

/** An open database holding todo lists. Close it when done. */
type TodoStore = {
  readonly db: Kysely<Database>;
  /** What connected to it: `sqlite`, `postgres`, or `neon-serverless`. */
  readonly driver: Driver;
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
  /** Seconds to wait to connect to PostgreSQL. Defaults to 30. SQLite ignores it. */
  connectTimeout?: number;
  /**
   * Connect to PostgreSQL with the Neon serverless driver, over WebSockets,
   * instead of postgres.js over TCP. SQLite ignores it.
   */
  useNeonServerless?: boolean;
  now?: () => Date;
};

/**
 * Opens a store: `database` is a `postgres://` or `postgresql://` URL, or a
 * SQLite file path.
 */
const todoListStore = async (database: string, options: StoreOptions = {}): Promise<TodoStore> => {
  const { connectTimeout, useNeonServerless } = options;
  const db = await connect(database, { connectTimeout, useNeonServerless });
  try {
    if (options.autoMigrate ?? true) await migrate(db);
  } catch (error) {
    await db.destroy();
    throw error;
  }
  const clock = options.now ?? (() => new Date());
  return {
    db,
    driver: driverFor(database, useNeonServerless),
    now: () => clock().toISOString(),
    newId: () => randomUUID(),
    close: () => db.destroy(),
  };
};

/** Runs the pending migrations, for a store opened with `autoMigrate: false`. */
const migrateStore = (store: TodoStore): Promise<void> => migrate(store.db);

type StoreStatus = {
  driver: Driver;
  /** The database server and its version, such as `PostgreSQL 16.15`. */
  server: string;
  /** The names of the migrations not yet run. */
  pendingMigrations: string[];
};

/** Reads the server version and the pending migrations, changing nothing. */
const storeStatus = async (store: TodoStore): Promise<StoreStatus> => {
  const { rows } =
    store.driver === "sqlite"
      ? await sql<{ version: string }>`select sqlite_version() as version`.execute(store.db)
      : await sql<{ version: string }>`select current_setting('server_version') as version`.execute(
          store.db,
        );
  const server = `${store.driver === "sqlite" ? "SQLite" : "PostgreSQL"} ${rows[0]?.version ?? "?"}`;
  return { driver: store.driver, server, pendingMigrations: await pendingMigrations(store.db) };
};

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
  type StoreStatus,
  type TodoStore,
  storeStatus,
  todoListStore,
};
